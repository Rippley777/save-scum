#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
use save_scum_core::{models::Settings, Engine};
use serde::Deserialize;
use serde_json::{json, Value};
use std::{
    path::Path,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
};
use tauri::{Emitter, Manager};
use tauri_plugin_autostart::ManagerExt;
use tauri_plugin_notification::NotificationExt;

struct AppState(Arc<Mutex<Engine>>);
struct Preferences {
    minimize_to_tray: AtomicBool,
    warnings: Mutex<Vec<String>>,
}
struct TrayStatus(tauri::menu::MenuItem<tauri::Wry>);
#[derive(Deserialize)]
#[serde(
    tag = "action",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
enum Request {
    Library,
    AddGame {
        name: String,
        path: String,
        steam_app_id: Option<String>,
    },
    InspectFolder {
        path: String,
        game_id: Option<String>,
    },
    ChangeSaveFolder {
        game_id: String,
        path: String,
    },
    PreviewRestore {
        id: String,
    },
    Capture {
        game_id: Option<String>,
        kind: String,
        label: String,
    },
    Restore {
        id: String,
    },
    PatchSnapshot {
        id: String,
        label: String,
        notes: String,
        favorite: bool,
        protected: bool,
    },
    Monitoring {
        game_id: Option<String>,
        watching: bool,
    },
    ToggleMonitoring,
    Retention {
        game_id: String,
        policy: String,
    },
    SaveSettings {
        settings: Settings,
    },
    Verify,
    Discover,
    Compare {
        before: String,
        after: String,
    },
    Export {
        game_id: String,
        snapshot_id: Option<String>,
        path: String,
    },
    Import {
        path: String,
        target: String,
    },
    Diagnostics {
        path: String,
    },
}
fn execute(core: &Engine, request: Request, app: &tauri::AppHandle) -> anyhow::Result<Value> {
    match request {
        Request::Library => {
            let mut value = serde_json::to_value(core.library()?)?;
            value["warnings"] = json!(*app
                .state::<Preferences>()
                .warnings
                .lock()
                .map_err(|e| anyhow::anyhow!(e.to_string()))?);
            Ok(value)
        }
        Request::AddGame {
            name,
            path,
            steam_app_id,
        } => Ok(serde_json::to_value(core.add_game(
            name,
            path,
            steam_app_id,
        )?)?),
        Request::Capture {
            game_id,
            kind,
            label,
        } => {
            let game = match game_id {
                Some(id) => core.game(&id)?,
                None => core.panic_target()?,
            };
            let result = core.capture(&game.id, &kind, &label)?;
            let settings = core.settings()?;
            if (kind == "panic" && settings.panic_notifications)
                || (kind != "panic" && settings.notifications)
            {
                if let Err(e) = app
                    .notification()
                    .builder()
                    .title("Save Scum")
                    .body(format!(
                        "{} created for {}.",
                        if kind == "panic" {
                            "Panic snapshot"
                        } else {
                            "Checkpoint"
                        },
                        game.name
                    ))
                    .show()
                {
                    eprintln!("Notification failed: {e}");
                }
            }
            Ok(serde_json::to_value(result)?)
        }
        Request::InspectFolder { path, game_id } => Ok(serde_json::to_value(
            core.inspect_folder(&path, game_id.as_deref())?,
        )?),
        Request::ChangeSaveFolder { game_id, path } => Ok(serde_json::to_value(
            core.change_save_folder(&game_id, &path)?,
        )?),
        Request::PreviewRestore { id } => Ok(serde_json::to_value(core.preview_restore(&id)?)?),
        Request::Restore { id } => Ok(serde_json::to_value(core.restore_report(&id)?)?),
        Request::PatchSnapshot {
            id,
            label,
            notes,
            favorite,
            protected,
        } => {
            core.patch_snapshot(&id, label, notes, favorite, protected)?;
            Ok(Value::Null)
        }
        Request::Monitoring { game_id, watching } => {
            if let Some(id) = game_id {
                core.set_monitoring(&id, watching)?;
            } else {
                for g in core.games()? {
                    core.set_monitoring(&g.id, watching)?;
                }
            }
            Ok(Value::Null)
        }
        Request::ToggleMonitoring => {
            let games = core.games()?;
            let watching = !games.iter().any(|g| g.watching);
            for game in games {
                core.set_monitoring(&game.id, watching)?;
            }
            Ok(Value::Null)
        }
        Request::Retention { game_id, policy } => {
            core.set_retention(&game_id, &policy)?;
            Ok(json!(core.apply_retention(&game_id)?))
        }
        Request::SaveSettings { settings } => {
            let old = core.settings()?;
            core.save_settings(&settings)?;
            let result = if settings.launch_at_startup != old.launch_at_startup {
                if settings.launch_at_startup {
                    app.autolaunch().enable()
                } else {
                    app.autolaunch().disable()
                }
            } else {
                Ok(())
            };
            if let Err(e) = result {
                core.save_settings(&old)?;
                anyhow::bail!("Could not update launch-at-startup setting: {e}");
            }
            app.state::<Preferences>()
                .minimize_to_tray
                .store(settings.minimize_to_tray, Ordering::Relaxed);
            Ok(Value::Null)
        }
        Request::Verify => Ok(serde_json::to_value(core.verify_library()?)?),
        Request::Discover => Ok(serde_json::to_value(save_scum_core::scanner::discover(
            Some(&core.root.join("game-definitions.json")),
        )?)?),
        Request::Compare { before, after } => {
            let a = core.snapshot(&before)?;
            let b = core.snapshot(&after)?;
            anyhow::ensure!(
                a.game_id == b.game_id,
                "Choose snapshots from the same game"
            );
            Ok(serde_json::to_value(save_scum_core::snapshots::compare(
                &a.files, &b.files,
            ))?)
        }
        Request::Export {
            game_id,
            snapshot_id,
            path,
        } => {
            core.export_archive(&game_id, snapshot_id.as_deref(), Path::new(&path))?;
            Ok(Value::Null)
        }
        Request::Import { path, target } => Ok(json!(
            core.import_archive(Path::new(&path), Path::new(&target))?
        )),
        Request::Diagnostics { path } => {
            use std::io::Write;
            let report = json!({"version":env!("CARGO_PKG_VERSION"),"os":std::env::consts::OS,"gameCount":core.games()?.len(),"snapshotCount":core.snapshots()?.len(),"storageBytes":save_scum_core::storage::usage(&core.root),"health":core.verify_library()?});
            let mut file = std::fs::OpenOptions::new()
                .write(true)
                .create_new(true)
                .open(path)?;
            file.write_all(serde_json::to_string_pretty(&report)?.as_bytes())?;
            file.sync_all()?;
            Ok(Value::Null)
        }
    }
}
#[tauri::command]
async fn dispatch(
    request: Request,
    state: tauri::State<'_, AppState>,
    app: tauri::AppHandle,
) -> Result<Value, String> {
    let engine = state.0.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let core = engine
            .lock()
            .map_err(|_| "Snapshot engine lock failed; restart Save Scum".to_string())?;
        let result = execute(&core, request, &app).map_err(|e| format!("{e:#}"));
        drop(core);
        update_tray(&app);
        result
    })
    .await
    .map_err(|e| e.to_string())?
}
fn update_tray(app: &tauri::AppHandle) {
    let state = app.state::<AppState>();
    let Ok(core) = state.0.try_lock() else {
        return;
    };
    let Ok(games) = core.games() else {
        return;
    };
    let count = games.iter().filter(|g| g.watching).count();
    let error = games
        .iter()
        .any(|g| g.error.is_some() || !Path::new(&g.path).is_dir());
    let latest = core
        .snapshots()
        .ok()
        .and_then(|s| s.into_iter().next())
        .map(|s| s.created_at)
        .unwrap_or_else(|| "None yet".into());
    drop(core);
    let text = if error {
        "Needs attention".to_string()
    } else if count == 0 {
        "Monitoring paused".to_string()
    } else {
        format!("Watching {count} games")
    };
    if let Some(tray) = app.tray_by_id("main") {
        let _ = tray.set_tooltip(Some(format!("Save Scum · {text}\nLast snapshot: {latest}")));
        if let Some(original) = app.default_window_icon() {
            let mut rgba = original.rgba().to_vec();
            let width = original.width();
            let height = original.height();
            let radius = (width / 6).max(2) as i32;
            let cx = width as i32 - radius - 1;
            let cy = height as i32 - radius - 1;
            let color = if error {
                [233, 132, 103, 255]
            } else if count == 0 {
                [140, 145, 134, 255]
            } else {
                [145, 211, 92, 255]
            };
            for y in 0..height as i32 {
                for x in 0..width as i32 {
                    if (x - cx) * (x - cx) + (y - cy) * (y - cy) <= radius * radius {
                        let i = ((y as u32 * width + x as u32) * 4) as usize;
                        rgba[i..i + 4].copy_from_slice(&color);
                    }
                }
            }
            let _ = tray.set_icon(Some(tauri::image::Image::new_owned(rgba, width, height)));
        }
    }
    if let Some(item) = app.try_state::<TrayStatus>() {
        let _ = item.0.set_text(format!("{text} · Last snapshot: {latest}"));
    }
}
fn show(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}
fn background(app: &tauri::AppHandle, request: Request) {
    let app = app.clone();
    let engine = app.state::<AppState>().0.clone();
    std::thread::spawn(move || {
        let result = engine
            .lock()
            .map_err(|_| "Snapshot engine lock failed".to_string())
            .and_then(|core| execute(&core, request, &app).map_err(|e| format!("{e:#}")));
        if let Err(e) = result {
            eprintln!("Save Scum: {e}");
            let _ = app.emit("engine-error", e);
            show(&app);
        }
        update_tray(&app);
        let _ = app.emit("library-changed", ());
    });
}
fn main() {
    use tauri_plugin_global_shortcut::{
        Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState,
    };
    let panic = Shortcut::new(Some(Modifiers::CONTROL | Modifiers::SHIFT), Code::F12);
    let checkpoint = Shortcut::new(Some(Modifiers::CONTROL | Modifiers::SHIFT), Code::KeyS);
    let open = Shortcut::new(Some(Modifiers::CONTROL | Modifiers::SHIFT), Code::Space);
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_autostart::Builder::new().build())
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(move |app, shortcut, event| {
                    if event.state() != ShortcutState::Pressed {
                        return;
                    }
                    if shortcut == &open {
                        show(app);
                    } else {
                        background(
                            app,
                            Request::Capture {
                                game_id: None,
                                kind: if shortcut == &panic {
                                    "panic"
                                } else {
                                    "manual"
                                }
                                .into(),
                                label: String::new(),
                            },
                        );
                    }
                })
                .build(),
        )
        .setup(move |app| {
            let root = std::env::var_os("SAVE_SCUM_DATA_DIR")
                .map(std::path::PathBuf::from)
                .unwrap_or(app.path().app_data_dir()?);
            let core = match Engine::open(root) { Ok(core) => core, Err(error) => {
                use tauri_plugin_dialog::DialogExt;
                app.dialog().message(format!("Save Scum could not open the snapshot library. Your saves have not been changed.\n\n{error:#}")).title("Save Scum — Library unavailable").blocking_show();
                return Err(error.into());
            } };
            app.manage(Preferences { minimize_to_tray: AtomicBool::new(core.settings()?.minimize_to_tray), warnings: Mutex::new(Vec::new()) });
            let engine = Arc::new(Mutex::new(core));
            app.manage(AppState(engine.clone()));
            for shortcut in [panic, checkpoint, open] {
                if let Err(e) = app.global_shortcut().register(shortcut) {
                    eprintln!("Could not register shortcut: {e}");
                    if let Ok(mut warnings) = app.state::<Preferences>().warnings.lock() { warnings.push(format!("Global shortcut registration failed: {e}. Use the UI or system tray instead.")); }
                }
            }
            use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
            let title = MenuItem::with_id(
                app,
                "status",
                "Save Scum · Local protection",
                false,
                None::<&str>,
            )?;
            let manual =
                MenuItem::with_id(app, "checkpoint", "Create Checkpoint", true, None::<&str>)?;
            let panic_item = MenuItem::with_id(app, "panic", "Panic Save", true, None::<&str>)?;
            let pause = MenuItem::with_id(
                app,
                "pause",
                "Pause / Resume Monitoring",
                true,
                None::<&str>,
            )?;
            let open_item = MenuItem::with_id(app, "open", "Open Save Scum", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
            let separator = PredefinedMenuItem::separator(app)?;
            let menu = Menu::with_items(
                app,
                &[
                    &title,
                    &separator,
                    &manual,
                    &panic_item,
                    &pause,
                    &open_item,
                    &quit,
                ],
            )?;
            app.manage(TrayStatus(title.clone()));
            let icon = app
                .default_window_icon()
                .cloned()
                .expect("bundled app icon");
            tauri::tray::TrayIconBuilder::with_id("main")
                .icon(icon)
                .tooltip("Save Scum · Monitoring")
                .menu(&menu)
                .on_menu_event(|app, event| match event.id().as_ref() {
                    "open" => show(app),
                    "quit" => app.exit(0),
                    "panic" | "checkpoint" => background(
                        app,
                        Request::Capture {
                            game_id: None,
                            kind: if event.id().as_ref() == "panic" {
                                "panic"
                            } else {
                                "manual"
                            }
                            .into(),
                            label: String::new(),
                        },
                    ),
                    "pause" => background(app,Request::ToggleMonitoring),
                    _ => {}
                })
                .build(app)?;
            let handle = app.handle().clone();
            let worker = save_scum_core::watcher::start(engine, move |result| {
                match result {
                Ok(id) => {
                    if let Ok(core) = handle.state::<AppState>().0.lock() {
                        if core.settings().map(|s|s.notifications).unwrap_or(false) {
                            if let Ok(snapshot) = core.snapshot(&id) {
                                if let Ok(game) = core.game(&snapshot.game_id) {
                                    if let Err(e) = handle.notification().builder().title("Save Scum").body(format!("Snapshot created for {}.",game.name)).show() { eprintln!("Notification failed: {e}"); }
                                }
                            }
                        }
                    }
                    let _ = handle.emit("library-changed", ());
                }
                Err(error) => {
                    eprintln!("{error}");
                    let _ = handle.emit("engine-error", error);
                    if let Some(tray) = handle.tray_by_id("main") {
                        let _ = tray.set_tooltip(Some("Save Scum · Needs attention"));
                    }
                }
                }
                update_tray(&handle);
            });
            app.manage(worker);
            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                let hide = window.state::<Preferences>().minimize_to_tray.load(Ordering::Relaxed);
                if hide {
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
        })
        .invoke_handler(tauri::generate_handler![dispatch])
        .run(tauri::generate_context!())
        .expect("Save Scum could not start; no saves have been modified");
}
