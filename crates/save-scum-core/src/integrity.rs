use crate::{models::IntegrityReport, storage, Engine};
use anyhow::Result;
impl Engine {
    pub fn verify_library(&self) -> Result<IntegrityReport> {
        let mut report = IntegrityReport::default();
        let mut health = std::collections::HashMap::new();
        for s in self.snapshots()? {
            let mut healthy = true;
            for f in s.files {
                let valid = *health.entry((f.hash.clone(), f.size)).or_insert_with(|| {
                    match storage::blob_path(&self.root, &f.hash) {
                        Ok(path) if !path.exists() => {
                            report.missing_blobs.push(f.hash.clone());
                            false
                        }
                        Ok(_) if storage::verify(&self.root, &f.hash, f.size).is_ok() => true,
                        _ => {
                            report.corrupt_blobs.push(f.hash.clone());
                            false
                        }
                    }
                });
                healthy &= valid;
            }
            if healthy {
                report.healthy_snapshots += 1;
            }
        }
        for item in walkdir::WalkDir::new(self.root.join("blobs")) {
            let Ok(item) = item else {
                continue;
            };
            if item.file_type().is_file() {
                let hash = item
                    .path()
                    .file_stem()
                    .unwrap_or_default()
                    .to_string_lossy()
                    .into_owned();
                if !health.keys().any(|(h, _)| h == &hash) {
                    report.orphaned_blobs.push(hash);
                }
            }
        }
        report.missing_blobs.sort();
        report.missing_blobs.dedup();
        report.corrupt_blobs.sort();
        report.corrupt_blobs.dedup();
        Ok(report)
    }
}
