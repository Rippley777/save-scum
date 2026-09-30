use crate::{database, snapshots, storage, Engine};
use anyhow::{Context, Result};
use std::{fs, path::Path};
impl Engine {
    /// A journal is durable before either directory rename. Recover the original
    /// directory after a process crash between renames; otherwise pause for review.
    pub(crate) fn recover_interrupted_restores(&self) -> Result<()> {
        let mut stmt = self.db.prepare("SELECT game_id,backup FROM restores")?;
        let entries: Vec<(String, String)> = stmt
            .query_map([], |r| Ok((r.get(0)?, r.get(1)?)))?
            .collect::<std::result::Result<_, _>>()?;
        for (id, backup) in entries {
            let mut game = self.game(&id)?;
            let target = Path::new(&game.path);
            let backup = Path::new(&backup);
            anyhow::ensure!(
                backup.parent() == target.parent()
                    && backup
                        .file_name()
                        .unwrap_or_default()
                        .to_string_lossy()
                        .starts_with(".save-scum-recovery-"),
                "Invalid interrupted-restore journal. Files were not changed."
            );
            let message = if !target.exists() && backup.is_dir() {
                match fs::rename(backup,target) {
                    Ok(()) => "An interrupted restore was rolled back to your original saves. Review your history and resume monitoring when ready.".to_string(),
                    Err(e) => format!("Interrupted restore needs recovery: {e}. Original files remain at {}",backup.display()),
                }
            } else {
                format!("An interrupted restore needs review. Current files were left in place. Original files may be recovered from {} or the protected safety checkpoint.",backup.display())
            };
            game.watching = false;
            game.error = Some(message);
            database::game(&self.db, &game)?;
            // Keep the journal if the original folder is still unavailable so reconnect can retry.
            if target.is_dir() {
                self.db
                    .execute("DELETE FROM restores WHERE game_id=?1", [&id])?;
            }
        }
        Ok(())
    }
    /// The host serializes restore with capture and watcher work using its engine mutex.
    /// Stage on the save volume, preserve the original directory, then rename into place.
    pub fn preview_restore(&self, id: &str) -> Result<crate::models::RestorePreview> {
        let snapshot = self.snapshot(id)?;
        anyhow::ensure!(!snapshot.files.is_empty(), "This checkpoint contains no save files and cannot restore progress. Fix the save folder and create a new checkpoint.");
        let game = self.game(&snapshot.game_id)?;
        anyhow::ensure!(snapshot.source_path.as_ref().is_none_or(|p| p == &game.path), "This checkpoint belongs to a different save folder. Choose a checkpoint from the corrected folder.");
        let current = snapshots::scan(Path::new(&game.path), self.settings()?.ignore_temporary)?;
        self.refresh_processes()?;
        let changes = snapshots::compare(&current, &snapshot.files);
        Ok(crate::models::RestorePreview {
            snapshot_id: id.into(),
            save_path: game.path,
            file_count: snapshot.files.len(),
            current_file_count: current.len(),
            identical: changes.is_empty(),
            changes,
            game_running: self.game(&snapshot.game_id)?.running,
        })
    }
    pub fn restore_report(&self, id: &str) -> Result<crate::models::RestoreReport> {
        let preview = self.preview_restore(id)?;
        anyhow::ensure!(!preview.game_running, "Close the game before restoring. It is currently running and could overwrite restored progress.");
        let mut report = crate::models::RestoreReport {
            status: "unchanged".into(),
            snapshot_id: id.into(),
            save_path: preview.save_path,
            file_count: preview.file_count,
            changed_files: preview.changes.len(),
            safety_snapshot_id: None,
            recovery_path: None,
            restored_at: chrono::Utc::now().to_rfc3339(),
        };
        if preview.identical {
            return Ok(report);
        }
        let (_, safety, recovery) = self.restore_files(id)?;
        report.status = "restored".into();
        report.safety_snapshot_id = Some(safety);
        report.recovery_path = Some(recovery);
        Ok(report)
    }
    pub fn restore(&self, id: &str) -> Result<String> {
        let report = self.restore_report(id)?;
        Ok(if report.status == "unchanged" {
            "No changes needed. Current save files already match this checkpoint.".into()
        } else {
            format!(
                "Restored and verified {} files. Original files also remain at {}",
                report.file_count,
                report.recovery_path.unwrap_or_default()
            )
        })
    }
    fn restore_files(&self, id: &str) -> Result<(String, String, String)> {
        let snapshot = self.snapshot(id)?;
        let game = self.game(&snapshot.game_id)?;
        let target = Path::new(&game.path);
        anyhow::ensure!(
            target.is_dir(),
            "Save directory unavailable. Reconnect it before restoring."
        );
        let canonical = target.canonicalize()?;
        anyhow::ensure!(
            canonical == target
                && !canonical.starts_with(&self.root)
                && !self.root.starts_with(&canonical),
            "Save directory location changed; restore aborted"
        );
        let parent = target.parent().context("Invalid save directory")?;
        let stage = tempfile::Builder::new()
            .prefix(".save-scum-stage-")
            .tempdir_in(parent)
            .context("Cannot stage restore alongside save directory")?;
        let mut paths = std::collections::HashSet::new();
        for f in &snapshot.files {
            let relative = storage::safe_relative(&f.path)?;
            anyhow::ensure!(
                paths.insert(relative.clone()),
                "Snapshot has duplicate file paths"
            );
            storage::verify(&self.root, &f.hash, f.size)?;
            let out = stage.path().join(relative);
            fs::create_dir_all(out.parent().unwrap())?;
            let mut file = fs::OpenOptions::new()
                .write(true)
                .create_new(true)
                .open(&out)?;
            crate::compression::decompress(
                &storage::blob_path(&self.root, &f.hash)?,
                &mut file,
                f.size,
            )?;
            file.sync_all()?;
            anyhow::ensure!(
                storage::hash_file(&out)? == f.hash,
                "Staged file verification failed"
            );
            let modified = chrono::DateTime::parse_from_rfc3339(&f.modified)
                .context("Snapshot has an invalid file timestamp")?;
            filetime::set_file_mtime(
                &out,
                filetime::FileTime::from_unix_time(
                    modified.timestamp(),
                    modified.timestamp_subsec_nanos(),
                ),
            )?;
        }
        let safety = self
            .capture(&game.id, "safety", "Before restore — automatic safety copy")?
            .context("Safety snapshot was not created; restore aborted")?;
        // Preserve ignored files too, so a restore cannot destroy unrelated settings or temp files.
        for entry in walkdir::WalkDir::new(target).follow_links(false) {
            let entry = entry?;
            anyhow::ensure!(
                !entry.file_type().is_symlink(),
                "Save folder changed during restore"
            );
            if entry.file_type().is_file()
                && snapshots::ignored(entry.path(), self.settings()?.ignore_temporary)
            {
                let out = stage.path().join(entry.path().strip_prefix(target)?);
                if !out.exists() {
                    fs::create_dir_all(out.parent().unwrap())?;
                    fs::copy(entry.path(), out)?;
                }
            }
        }
        let current = snapshots::scan(target, self.settings()?.ignore_temporary)?;
        anyhow::ensure!(snapshots::same_content(&current, &safety.files), "Game is still writing saves. Close it and try again. Current files have not been replaced.");
        self.refresh_processes()?;
        anyhow::ensure!(!self.game(&game.id)?.running, "The game started during restore. Close it and retry; current files have not been replaced.");
        let backup = parent.join(format!(".save-scum-recovery-{}", uuid::Uuid::new_v4()));
        fs::set_permissions(stage.path(), fs::metadata(target)?.permissions())?;
        self.db.execute(
            "INSERT INTO restores (game_id,backup) VALUES (?1,?2)",
            rusqlite::params![game.id, backup.to_string_lossy()],
        )?;
        if let Err(error) = fs::rename(target, &backup) {
            self.db
                .execute("DELETE FROM restores WHERE game_id=?1", [&game.id])?;
            anyhow::bail!("Cannot move current save folder: {error}. Close the game and retry; current saves are untouched.");
        }
        if let Err(error) = fs::rename(stage.path(), target) {
            if let Err(rollback) = fs::rename(&backup, target) {
                anyhow::bail!("Restore failed ({error}); rollback failed ({rollback}). Your original saves are preserved at {}", backup.display());
            }
            self.db
                .execute("DELETE FROM restores WHERE game_id=?1", [&game.id])?;
            anyhow::bail!("Restore failed and was rolled back: {error}");
        }
        let verified = snapshots::scan(target, self.settings()?.ignore_temporary)
            .map(|f| snapshots::same_content(&f, &snapshot.files));
        if !matches!(verified, Ok(true)) {
            let failed = parent.join(format!(".save-scum-failed-{}", uuid::Uuid::new_v4()));
            fs::rename(target, &failed).with_context(|| {
                format!(
                    "Verification failed. Original saves are preserved at {}",
                    backup.display()
                )
            })?;
            fs::rename(&backup, target).with_context(|| {
                format!(
                    "Rollback failed. Original saves are preserved at {}",
                    backup.display()
                )
            })?;
            self.db
                .execute("DELETE FROM restores WHERE game_id=?1", [&game.id])?;
            anyhow::bail!("Restored files did not verify. Original saves were restored; attempted restore is preserved at {}", failed.display());
        }
        // Intentionally keep the physical recovery directory as a crash-safe last resort.
        // The UI reports its location; the user can remove it after validating the game.
        let tx = self.db.unchecked_transaction()?;
        let mut safety = safety;
        safety.notes = format!("Created automatically before restoring {}. Original files also remain at {}. Remove that recovery folder only after checking the restored game.",snapshot.created_at,backup.display());
        database::snapshot(&tx, &safety)?;
        tx.execute("DELETE FROM restores WHERE game_id=?1", [&game.id])?;
        tx.commit().context("Restored files verified, but recovery metadata could not be finalized. The original directory and safety checkpoint are preserved.")?;
        Ok((
            snapshot.id,
            safety.id,
            backup.to_string_lossy().into_owned(),
        ))
    }
}
