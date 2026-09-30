use crate::{
    database,
    models::{FolderFile, FolderInspection, Game},
    Engine,
};
use anyhow::{Context, Result};
use std::path::Path;
impl Engine {
    pub fn inspect_folder(&self, path: &str, game_id: Option<&str>) -> Result<FolderInspection> {
        anyhow::ensure!(!path.trim().is_empty(), "Choose a save folder first");
        let input = Path::new(path);
        let expanded = if let Ok(relative) = input.strip_prefix("~") {
            directories::UserDirs::new()
                .context("Could not find your home directory")?
                .home_dir()
                .join(relative)
        } else {
            input.to_owned()
        };
        let root = expanded
            .canonicalize()
            .context("Save folder cannot be found or accessed")?;
        anyhow::ensure!(
            root.is_dir() && root.parent().is_some(),
            "Choose a game save folder, not a drive root"
        );
        anyhow::ensure!(!self.root.starts_with(&root) && !root.starts_with(&self.root),"Save and backup storage folders must not overlap. Choose the game's save folder; Save Scum manages backup storage separately.");
        anyhow::ensure!(root.parent().and_then(|p|p.file_name()).is_none_or(|n|n != "common") || root.parent().and_then(|p|p.parent()).and_then(|p|p.file_name()).is_none_or(|n|n != "steamapps"),"This is a Steam installation folder. Choose the folder containing the game's save files instead.");
        for game in self.games()? {
            if Some(game.id.as_str()) == game_id {
                continue;
            }
            let old = Path::new(&game.path);
            anyhow::ensure!(
                !old.starts_with(&root) && !root.starts_with(old),
                "This folder overlaps another monitored game"
            );
        }
        let ignore = self.settings()?.ignore_temporary;
        let mut inspection = FolderInspection {
            path: root.to_string_lossy().into_owned(),
            file_count: 0,
            total_bytes: 0,
            files: Vec::new(),
        };
        for item in walkdir::WalkDir::new(&root).follow_links(false) {
            let item = item.context("Cannot read the selected folder")?;
            anyhow::ensure!(
                !item.file_type().is_symlink(),
                "Save folders containing symbolic links are not supported"
            );
            if item.file_type().is_dir() || crate::snapshots::ignored(item.path(), ignore) {
                continue;
            }
            anyhow::ensure!(
                item.file_type().is_file(),
                "Special files cannot be backed up"
            );
            let relative = item
                .path()
                .strip_prefix(&root)?
                .to_str()
                .context("Save filenames must be valid UTF-8")?
                .replace('\\', "/");
            crate::storage::safe_relative(&relative)?;
            let size = item.metadata()?.len();
            inspection.file_count += 1;
            inspection.total_bytes = inspection
                .total_bytes
                .checked_add(size)
                .context("Save folder is too large")?;
            if inspection.files.len() < 8 {
                inspection.files.push(FolderFile {
                    path: relative,
                    size,
                });
            }
        }
        Ok(inspection)
    }

    pub fn change_save_folder(&self, game_id: &str, path: &str) -> Result<Game> {
        let inspection = self.inspect_folder(path, Some(game_id))?;
        anyhow::ensure!(
            inspection.file_count > 0,
            "No save files found. Choose the folder containing your existing game saves."
        );
        let mut game = self.game(game_id)?;
        if inspection.path == game.path {
            return Ok(game);
        }
        // Bind old manifests to the old folder before changing the restore destination.
        // This also migrates legacy manifests which did not record their source path.
        let tx = self.db.unchecked_transaction()?;
        for mut snapshot in self
            .snapshots()?
            .into_iter()
            .filter(|s| s.game_id == game_id)
        {
            if snapshot.source_path.is_none() {
                snapshot.source_path = Some(game.path.clone());
                database::snapshot(&tx, &snapshot)?;
            }
        }
        game.path = inspection.path;
        game.executables =
            crate::scanner::load_definitions(Some(&self.root.join("game-definitions.json")))?
                .into_iter()
                .find(|d| d.name.eq_ignore_ascii_case(&game.name))
                .map(|d| d.executables)
                .unwrap_or(game.executables);
        game.error = None;
        game.last_activity = None;
        database::game(&tx, &game)?;
        tx.commit()?;
        if let Err(error) = self.capture(
            game_id,
            "manual",
            "First checkpoint in corrected save folder",
        ) {
            self.record_error(
                game_id,
                format!("Save folder updated, but the first checkpoint failed: {error:#}"),
            );
            return Err(error.context(
                "Save folder updated; no live files were changed. Retry creating a checkpoint",
            ));
        }
        self.game(game_id)
    }
    pub fn add_game(
        &self,
        name: String,
        path: String,
        steam_app_id: Option<String>,
    ) -> Result<Game> {
        anyhow::ensure!(!name.trim().is_empty(), "Give your game a name");
        let inspection = self.inspect_folder(&path, None)?;
        anyhow::ensure!(inspection.file_count > 0, "No save files found. Choose the folder where the game already saves your progress, not an empty folder for backups.");
        let path = std::path::PathBuf::from(&inspection.path);
        let definitions =
            crate::scanner::load_definitions(Some(&self.root.join("game-definitions.json")))?;
        let executables = definitions
            .into_iter()
            .find(|d| d.name.eq_ignore_ascii_case(name.trim()))
            .map(|d| d.executables)
            .unwrap_or_default();
        let game = Game {
            id: uuid::Uuid::new_v4().to_string(),
            name: name.trim().into(),
            path: path.to_string_lossy().into_owned(),
            steam_app_id,
            watching: true,
            retention: self.settings()?.default_retention,
            last_activity: None,
            error: None,
            running: false,
            executables,
        };
        // Ensure the folder is readable before registering it.
        crate::snapshots::scan(&path, self.settings()?.ignore_temporary)?;
        database::game(&self.db, &game)?;
        if let Err(error) = self.capture(&game.id, "automatic", "") {
            self.record_error(&game.id, format!("Initial snapshot failed: {error:#}"));
        }
        self.game(&game.id)
    }
    pub fn refresh_processes(&self) -> Result<()> {
        let mut system = sysinfo::System::new();
        system.refresh_processes(sysinfo::ProcessesToUpdate::All, true);
        for mut game in self.games()? {
            game.running = system.processes().values().any(|p| {
                game.executables
                    .iter()
                    .any(|e| p.name().to_string_lossy().eq_ignore_ascii_case(e))
            });
            database::game(&self.db, &game)?;
        }
        Ok(())
    }
}
