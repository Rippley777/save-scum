use crate::Engine;
use notify::{RecursiveMode, Watcher};
use std::{
    collections::{HashMap, HashSet},
    path::PathBuf,
    sync::{
        atomic::{AtomicBool, Ordering},
        mpsc, Arc, Mutex,
    },
    time::{Duration, Instant},
};

pub struct WatchService {
    stop: Arc<AtomicBool>,
    thread: Option<std::thread::JoinHandle<()>>,
}
impl Drop for WatchService {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::Relaxed);
        if let Some(thread) = self.thread.take() {
            let _ = thread.join();
        }
    }
}

/// One serialized worker, bounded event batches, quiet-period debounce, and periodic retry.
/// Only save directories are watched recursively. Parents are watched non-recursively
/// to detect restored/reconnected directories without scanning unrelated games or home folders.
pub fn start(
    engine: Arc<Mutex<Engine>>,
    on_change: impl Fn(Result<String, String>) + Send + 'static,
) -> WatchService {
    let stop = Arc::new(AtomicBool::new(false));
    let worker_stop = stop.clone();
    let thread = std::thread::spawn(move || {
        let (tx, rx) = mpsc::sync_channel(4096);
        let overflow = Arc::new(AtomicBool::new(false));
        let event_overflow = overflow.clone();
        let watcher = notify::recommended_watcher(move |event| {
            if tx.try_send(event).is_err() {
                event_overflow.store(true, Ordering::Relaxed);
            }
        });
        let mut watcher = match watcher {
            Ok(w) => w,
            Err(e) => {
                on_change(Err(format!("Filesystem watcher could not start: {e}")));
                return;
            }
        };
        let mut watched = HashMap::<PathBuf, bool>::new();
        let mut active = HashSet::new();
        let mut pending = HashMap::<String, Instant>::new();
        let mut poll = Instant::now() - Duration::from_secs(60);
        while !worker_stop.load(Ordering::Relaxed) {
            let event = rx.recv_timeout(Duration::from_millis(250));
            let mut events = Vec::new();
            let mut paths = Vec::new();
            let mut results = Vec::new();
            match event {
                Ok(event) => events.push(event),
                Err(mpsc::RecvTimeoutError::Disconnected) => break,
                _ => {}
            }
            events.extend(rx.try_iter().take(4096));
            for event in events {
                match event {
                    Ok(event) if !matches!(event.kind, notify::EventKind::Access(_)) => {
                        paths.extend(event.paths)
                    }
                    Err(e) => results.push(Err(format!("Filesystem watcher: {e}"))),
                    _ => {}
                }
            }
            let periodic = poll.elapsed() >= Duration::from_secs(60)
                || overflow.swap(false, Ordering::Relaxed);
            let Ok(core) = engine.lock() else {
                on_change(Err(
                    "Snapshot worker lock failed; restart the application".into()
                ));
                break;
            };
            let games = match core.games() {
                Ok(g) => g,
                Err(e) => {
                    drop(core);
                    on_change(Err(e.to_string()));
                    continue;
                }
            };
            let mut desired = HashMap::<PathBuf, bool>::new();
            let now_active: HashSet<_> = games
                .iter()
                .filter(|g| g.watching)
                .map(|g| g.id.clone())
                .collect();
            pending.retain(|id, _| now_active.contains(id));
            for g in games.iter().filter(|g| g.watching) {
                let root = PathBuf::from(&g.path);
                if root.is_dir() {
                    desired.insert(root.clone(), true);
                }
                if let Some(parent) = root.parent().filter(|p| p.is_dir()) {
                    desired.entry(parent.to_owned()).or_insert(false);
                }
                if !active.contains(&g.id) || paths.iter().any(|p| p.starts_with(&root)) {
                    pending.insert(g.id.clone(), Instant::now());
                }
                if periodic {
                    pending.entry(g.id.clone()).or_insert(Instant::now());
                }
            }
            active = now_active;
            // Reattach after rename, external volume reconnect, or a periodic health check.
            let stale: Vec<_> = watched
                .iter()
                .filter(|(p, mode)| {
                    desired.get(*p) != Some(mode)
                        || periodic
                        || paths.iter().any(|changed| changed == *p)
                })
                .map(|(p, _)| p.clone())
                .collect();
            for path in stale {
                let _ = watcher.unwatch(&path);
                watched.remove(&path);
            }
            for (path, recursive) in desired {
                if watched.contains_key(&path) {
                    continue;
                }
                match watcher.watch(
                    &path,
                    if recursive {
                        RecursiveMode::Recursive
                    } else {
                        RecursiveMode::NonRecursive
                    },
                ) {
                    Ok(()) => {
                        watched.insert(path, recursive);
                    }
                    Err(e) => {
                        let message = format!(
                            "Cannot monitor {}: {e}. Periodic capture will retry.",
                            path.display()
                        );
                        for game in games
                            .iter()
                            .filter(|g| PathBuf::from(&g.path).starts_with(&path))
                        {
                            core.record_error(&game.id, message.clone());
                        }
                        results.push(Err(message));
                    }
                }
            }
            if periodic {
                if let Err(e) = core.refresh_processes() {
                    results.push(Err(e.to_string()));
                }
                poll = Instant::now();
            }
            let debounce = core.settings().map(|s| s.debounce_ms).unwrap_or(2000);
            let ready: Vec<_> = pending
                .iter()
                .filter(|(_, at)| at.elapsed() >= Duration::from_millis(debounce))
                .map(|(id, _)| id.clone())
                .collect();
            for id in ready {
                pending.remove(&id);
                match core.capture(&id, "automatic", "") {
                    Ok(Some(s)) => {
                        if let Err(e) = core.apply_retention(&id) {
                            core.record_error(&id, e.to_string());
                            results.push(Err(e.to_string()));
                        }
                        results.push(Ok(s.id));
                    }
                    Ok(None) => {}
                    Err(e) => {
                        let message = format!("{e:#}");
                        core.record_error(&id, message.clone());
                        results.push(Err(message));
                    }
                }
            }
            drop(core); // Callbacks may query the library; never call them while holding its lock.
            for result in results {
                on_change(result);
            }
        }
    });
    WatchService {
        stop,
        thread: Some(thread),
    }
}
