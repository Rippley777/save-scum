use crate::{database, models::*, storage, Engine};
use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};
use std::{collections::HashSet, fs, path::Path};
#[derive(Serialize, Deserialize)]
struct Manifest {
    version: u32,
    game: Game,
    snapshots: Vec<Snapshot>,
}
impl Engine {
    pub fn export_archive(
        &self,
        game_id: &str,
        snapshot_id: Option<&str>,
        destination: &Path,
    ) -> Result<()> {
        let game = self.game(game_id)?;
        let snapshots: Vec<_> = self
            .snapshots()?
            .into_iter()
            .filter(|s| s.game_id == game_id && snapshot_id.map(|id| id == s.id).unwrap_or(true))
            .collect();
        anyhow::ensure!(!snapshots.is_empty(), "No snapshots selected for export");
        let manifest = serde_json::to_vec(&Manifest {
            version: 1,
            game,
            snapshots: snapshots.clone(),
        })?;
        let parent = destination.parent().context("Invalid export directory")?;
        let temp = tempfile::NamedTempFile::new_in(parent)?;
        let mut builder = tar::Builder::new(temp.reopen()?);
        let mut header = tar::Header::new_gnu();
        header.set_size(manifest.len() as u64);
        header.set_mode(0o600);
        header.set_cksum();
        builder.append_data(&mut header, "manifest.json", &manifest[..])?;
        let mut seen = HashSet::new();
        for s in snapshots {
            for f in s.files {
                if seen.insert(f.hash.clone()) {
                    storage::verify(&self.root, &f.hash, f.size)?;
                    builder.append_path_with_name(
                        storage::blob_path(&self.root, &f.hash)?,
                        format!("blobs/{}.zst", f.hash),
                    )?;
                }
            }
        }
        builder.finish()?;
        drop(builder);
        temp.as_file().sync_all()?;
        temp.persist_noclobber(destination)
            .map_err(|e| e.error)
            .context(
                "Export destination already exists or cannot be written; choose a new filename",
            )?;
        Ok(())
    }
    pub fn import_archive(&self, source: &Path, target: &Path) -> Result<String> {
        let stage = tempfile::tempdir_in(&self.root)?;
        let mut archive = tar::Archive::new(fs::File::open(source)?);
        let mut seen = HashSet::new();
        let mut total = 0u64;
        for entry in archive.entries()? {
            let mut entry = entry?;
            anyhow::ensure!(
                entry.header().entry_type().is_file(),
                "Archive must contain only regular files"
            );
            total = total
                .checked_add(entry.size())
                .context("Archive size overflow")?;
            anyhow::ensure!(
                total <= 100 * 1024 * 1024 * 1024,
                "Archive exceeds the 100 GB import limit"
            );
            let name = entry
                .path()?
                .to_str()
                .context("Invalid archive filename")?
                .to_owned();
            let relative = storage::safe_relative(&name)?;
            anyhow::ensure!(seen.insert(name.clone()), "Duplicate archive entry");
            if name != "manifest.json" {
                let hash = name
                    .strip_prefix("blobs/")
                    .and_then(|n| n.strip_suffix(".zst"))
                    .context("Unexpected archive entry")?;
                storage::blob_path(&self.root, hash)?;
            } else {
                anyhow::ensure!(entry.size() <= 64 * 1024 * 1024, "Manifest is too large");
            }
            let out = stage.path().join(relative);
            fs::create_dir_all(out.parent().unwrap())?;
            let mut file = fs::OpenOptions::new()
                .create_new(true)
                .write(true)
                .open(out)?;
            std::io::copy(&mut entry, &mut file)?;
        }
        let mut manifest: Manifest =
            serde_json::from_slice(&fs::read(stage.path().join("manifest.json"))?)?;
        anyhow::ensure!(
            manifest.version == 1 && !manifest.snapshots.is_empty(),
            "Unsupported or empty Save Scum archive"
        );
        let target = target
            .canonicalize()
            .context("Select an existing save directory for imported history")?;
        anyhow::ensure!(
            target.is_dir()
                && target.parent().is_some()
                && !target.starts_with(&self.root)
                && !self.root.starts_with(&target),
            "Unsafe import save directory"
        );
        for g in self.games()? {
            anyhow::ensure!(
                !target.starts_with(&g.path) && !Path::new(&g.path).starts_with(&target),
                "Import into a folder that is not already monitored"
            );
        }
        // Validate every referenced blob and filename before committing any metadata.
        for s in &manifest.snapshots {
            chrono::DateTime::parse_from_rfc3339(&s.created_at)?;
            anyhow::ensure!(
                ["automatic", "manual", "panic", "safety"].contains(&s.kind.as_str()),
                "Unknown snapshot kind in archive"
            );
            let mut paths = HashSet::new();
            for f in &s.files {
                chrono::DateTime::parse_from_rfc3339(&f.modified)?;
                storage::safe_relative(&f.path)?;
                anyhow::ensure!(paths.insert(&f.path), "Duplicate snapshot filename");
                storage::blob_path(&self.root, &f.hash)?;
                storage::verify_path(
                    &stage.path().join(format!("blobs/{}.zst", f.hash)),
                    &f.hash,
                    f.size,
                )?;
            }
        }
        manifest.game.id = uuid::Uuid::new_v4().to_string();
        manifest.game.path = target.to_string_lossy().into_owned();
        manifest.game.watching = false;
        manifest.game.running = false;
        manifest.game.error = None;
        crate::retention::validate(&manifest.game.retention)?;
        let tx = self.db.unchecked_transaction()?;
        database::game(&tx, &manifest.game)?;
        for mut s in manifest.snapshots {
            s.id = uuid::Uuid::new_v4().to_string();
            s.game_id = manifest.game.id.clone();
            s.source_path = Some(manifest.game.path.clone());
            s.size = s.files.iter().try_fold(0u64, |acc, f| {
                acc.checked_add(f.size).context("Snapshot size overflow")
            })?;
            for f in &s.files {
                let dest = storage::blob_path(&self.root, &f.hash)?;
                if !dest.exists() {
                    fs::create_dir_all(dest.parent().unwrap())?;
                    let mut blob = tempfile::NamedTempFile::new_in(dest.parent().unwrap())?;
                    std::io::copy(
                        &mut fs::File::open(stage.path().join(format!("blobs/{}.zst", f.hash)))?,
                        &mut blob,
                    )?;
                    blob.as_file().sync_all()?;
                    blob.persist_noclobber(dest).map_err(|e| e.error)?;
                } else {
                    storage::verify(&self.root, &f.hash, f.size)?;
                }
            }
            database::snapshot(&tx, &s)?;
        }
        tx.commit()?;
        Ok(manifest.game.id)
    }
}
