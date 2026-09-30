use crate::{database, models::*, storage, Engine};
use anyhow::{Context, Result};
use std::{collections::BTreeMap, path::Path};
pub fn ignored(path: &Path, ignore_temporary: bool) -> bool {
    let name = path.file_name().unwrap_or_default().to_string_lossy();
    name == ".DS_Store"
        || name == "Thumbs.db"
        || (ignore_temporary
            && (name.starts_with(".~")
                || name.ends_with('~')
                || ["tmp", "temp", "swp", "lock", "part"].iter().any(|ext| {
                    path.extension()
                        .map(|x| x.eq_ignore_ascii_case(ext))
                        .unwrap_or(false)
                })))
}
pub fn scan(root: &Path, ignore_temporary: bool) -> Result<Vec<SaveFile>> {
    anyhow::ensure!(
        root.is_dir(),
        "Save directory unavailable: {}",
        root.display()
    );
    let mut files = Vec::new();
    for item in walkdir::WalkDir::new(root).follow_links(false) {
        let item = item.context("Could not enumerate save files")?;
        anyhow::ensure!(
            !item.file_type().is_symlink(),
            "Symbolic links in save folders are not supported: {}",
            item.path().display()
        );
        if item.file_type().is_dir() || ignored(item.path(), ignore_temporary) {
            continue;
        }
        anyhow::ensure!(
            item.file_type().is_file(),
            "Special files cannot be backed up"
        );
        let relative = item
            .path()
            .strip_prefix(root)?
            .to_str()
            .context("Save filenames must be valid UTF-8")?
            .replace('\\', "/");
        storage::safe_relative(&relative)?;
        let before = item.metadata()?;
        let hash = storage::hash_file(item.path())?;
        let after = std::fs::metadata(item.path())?;
        anyhow::ensure!(
            before.len() == after.len() && before.modified()? == after.modified()?,
            "Save files are still changing; waiting for writes to finish"
        );
        files.push(SaveFile {
            path: relative,
            hash,
            size: after.len(),
            modified: chrono::DateTime::<chrono::Utc>::from(after.modified()?).to_rfc3339(),
        });
    }
    files.sort_by(|a, b| a.path.cmp(&b.path));
    Ok(files)
}
pub fn same_content(a: &[SaveFile], b: &[SaveFile]) -> bool {
    a.len() == b.len()
        && a.iter()
            .zip(b)
            .all(|(a, b)| a.path == b.path && a.hash == b.hash && a.size == b.size)
}
pub fn compare(a: &[SaveFile], b: &[SaveFile]) -> Vec<FileChange> {
    let old: BTreeMap<_, _> = a.iter().map(|f| (&f.path, f)).collect();
    let new: BTreeMap<_, _> = b.iter().map(|f| (&f.path, f)).collect();
    let mut changes = Vec::new();
    for (path, file) in &new {
        let before = old.get(path);
        if before.map(|f| &f.hash) == Some(&file.hash) {
            continue;
        }
        changes.push(FileChange {
            path: (*path).clone(),
            status: if before.is_some() {
                "modified"
            } else {
                "added"
            }
            .into(),
            before: before.map(|f| (*f).clone()),
            after: Some((*file).clone()),
        });
    }
    for (path, file) in old {
        if !new.contains_key(path) {
            changes.push(FileChange {
                path: path.clone(),
                status: "removed".into(),
                before: Some(file.clone()),
                after: None,
            });
        }
    }
    changes
}
impl Engine {
    pub fn capture(&self, game_id: &str, kind: &str, label: &str) -> Result<Option<Snapshot>> {
        anyhow::ensure!(
            ["automatic", "manual", "panic", "safety"].contains(&kind),
            "Invalid snapshot type"
        );
        let mut game = self.game(game_id)?;
        let settings = self.settings()?;
        let root = Path::new(&game.path);
        let files = scan(root, settings.ignore_temporary)?;
        anyhow::ensure!(kind == "safety" || !files.is_empty(),"No save files found in {}. Select the game's existing save folder, not an empty folder for backups. No checkpoint was created.",root.display());
        let snapshots = self.snapshots()?;
        let previous = snapshots.iter().find(|s| s.game_id == game_id);
        if kind == "automatic"
            && previous
                .map(|s| same_content(&s.files, &files))
                .unwrap_or(false)
        {
            game.error = None;
            database::game(&self.db, &game)?;
            return Ok(None);
        }
        let changed = previous
            .map(|s| compare(&s.files, &files).len())
            .unwrap_or(files.len());
        let size = files.iter().map(|f| f.size).sum();
        for f in &files {
            storage::store(
                &self.root,
                &root.join(&f.path),
                &f.hash,
                f.size,
                settings.compression_level,
            )?;
        }
        let check = scan(root, settings.ignore_temporary)?;
        anyhow::ensure!(same_content(&files,&check), "Save files changed during capture. No incomplete snapshot was committed; retry after writes stop.");
        if settings.storage_limit_gb > 0 {
            anyhow::ensure!(storage::usage(&self.root) <= settings.storage_limit_gb.saturating_mul(1_073_741_824), "Storage limit reached. Increase the limit or prune history; existing saves are safe.");
        }
        let now = chrono::Utc::now().to_rfc3339();
        let snapshot = Snapshot {
            id: uuid::Uuid::new_v4().to_string(),
            game_id: game_id.into(),
            created_at: now.clone(),
            kind: kind.into(),
            label: if kind == "panic" {
                "PANIC SAVE".into()
            } else {
                label.into()
            },
            notes: String::new(),
            favorite: false,
            protected: kind == "panic" || kind == "safety",
            files,
            size,
            changed,
            source_path: Some(game.path.clone()),
        };
        let tx = self.db.unchecked_transaction()?;
        database::snapshot(&tx, &snapshot)?;
        game.last_activity = Some(now);
        game.error = None;
        database::game(&tx, &game)?;
        tx.commit()?;
        Ok(Some(snapshot))
    }
}
