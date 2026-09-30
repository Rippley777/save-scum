pub mod archive;
pub mod compression;
pub mod database;
pub mod games;
pub mod integrity;
pub mod models;
pub mod restore;
pub mod retention;
pub mod scanner;
pub mod snapshots;
pub mod storage;
pub mod watcher;
use anyhow::{Context, Result};
use models::*;
use std::path::{Path, PathBuf};

pub struct Engine {
    pub root: PathBuf,
    pub(crate) db: rusqlite::Connection,
    _lock: std::fs::File,
}
impl Engine {
    pub fn open(root: impl AsRef<Path>) -> Result<Self> {
        std::fs::create_dir_all(root.as_ref())
            .context("Cannot create snapshot storage directory")?;
        let root = root.as_ref().canonicalize()?;
        let lock = std::fs::OpenOptions::new()
            .create(true)
            .truncate(false)
            .read(true)
            .write(true)
            .open(root.join("engine.lock"))?;
        fs2::FileExt::try_lock_exclusive(&lock)
            .context("This snapshot library is already open in another Save Scum process")?;
        let db = database::open(&root.join("library.sqlite3"))?;
        let engine = Self {
            root,
            db,
            _lock: lock,
        };
        engine.recover_interrupted_restores()?;
        Ok(engine)
    }
    pub fn games(&self) -> Result<Vec<Game>> {
        database::list(&self.db, "games")
    }
    pub fn snapshots(&self) -> Result<Vec<Snapshot>> {
        database::list(&self.db, "snapshots")
    }
    pub fn game(&self, id: &str) -> Result<Game> {
        self.games()?
            .into_iter()
            .find(|g| g.id == id)
            .context("Game not found")
    }
    pub fn snapshot(&self, id: &str) -> Result<Snapshot> {
        self.snapshots()?
            .into_iter()
            .find(|s| s.id == id)
            .context("Snapshot not found")
    }
    pub fn settings(&self) -> Result<Settings> {
        database::settings(&self.db)
    }
    pub fn save_settings(&self, s: &Settings) -> Result<()> {
        anyhow::ensure!(
            (1..=19).contains(&s.compression_level) && (500..=30000).contains(&s.debounce_ms),
            "Invalid compression level or debounce interval"
        );
        retention::validate(&s.default_retention)?;
        database::save_settings(&self.db, s)
    }
    pub fn library(&self) -> Result<Library> {
        let mut games = self.games()?;
        let snapshots = self.snapshots()?;
        for g in &mut games {
            if !Path::new(&g.path).is_dir() {
                g.error = Some("Save directory unavailable".into());
            } else if !snapshots.iter().any(|s| {
                s.game_id == g.id
                    && !s.files.is_empty()
                    && s.source_path.as_deref().is_none_or(|p| p == g.path)
            }) {
                g.error = Some("No save files backed up. Choose the folder containing the game's existing save files. Empty checkpoints cannot restore progress.".into());
            }
        }
        Ok(Library {
            games,
            snapshots,
            settings: self.settings()?,
            storage_bytes: storage::usage(&self.root),
            storage_path: self.root.to_string_lossy().into_owned(),
        })
    }
    pub fn patch_snapshot(
        &self,
        id: &str,
        label: String,
        notes: String,
        favorite: bool,
        protected: bool,
    ) -> Result<()> {
        let mut s = self.snapshot(id)?;
        s.label = label;
        s.notes = notes;
        s.favorite = favorite;
        s.protected = protected;
        database::snapshot(&self.db, &s)
    }
    pub fn set_monitoring(&self, id: &str, watching: bool) -> Result<()> {
        let mut g = self.game(id)?;
        g.watching = watching;
        database::game(&self.db, &g)
    }
    pub fn set_retention(&self, id: &str, policy: &str) -> Result<()> {
        retention::validate(policy)?;
        let mut g = self.game(id)?;
        g.retention = policy.into();
        database::game(&self.db, &g)
    }
    pub fn record_error(&self, id: &str, error: String) {
        if let Ok(mut g) = self.game(id) {
            g.error = Some(error);
            let _ = database::game(&self.db, &g);
        }
    }
    pub fn panic_target(&self) -> Result<Game> {
        if let Some(id) = self.settings()?.panic_game_id {
            return self.game(&id);
        }
        let mut games = self.games()?;
        games.retain(|g| g.watching);
        games.sort_by(|a, b| b.last_activity.cmp(&a.last_activity));
        games
            .iter()
            .find(|g| g.running)
            .cloned()
            .or_else(|| games.into_iter().next())
            .context("Add a monitored game first")
    }
}
