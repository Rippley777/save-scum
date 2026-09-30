use crate::Engine;
use anyhow::Result;
pub fn validate(policy: &str) -> Result<()> {
    anyhow::ensure!(
        ["100", "7d", "30d", "smart", "unlimited"].contains(&policy),
        "Unknown retention policy"
    );
    Ok(())
}
impl Engine {
    pub fn apply_retention(&self, game_id: &str) -> Result<usize> {
        let game = self.game(game_id)?;
        validate(&game.retention)?;
        if game.retention == "unlimited" {
            return Ok(0);
        }
        let snapshots: Vec<_> = self
            .snapshots()?
            .into_iter()
            .filter(|s| s.game_id == game_id)
            .collect();
        let mut buckets = std::collections::HashSet::new();
        let mut removed = 0;
        let tx = self.db.unchecked_transaction()?;
        for (i, s) in snapshots.iter().enumerate() {
            if i == 0 || s.protected || s.favorite || !s.label.is_empty() || s.kind != "automatic" {
                continue;
            }
            let time = chrono::DateTime::parse_from_rfc3339(&s.created_at)?;
            let age = chrono::Utc::now().signed_duration_since(time);
            let delete = match game.retention.as_str() {
                "100" => i >= 100,
                "7d" => age.num_days() >= 7,
                "30d" => age.num_days() >= 30,
                "smart" => {
                    if age.num_days() >= 30 {
                        true
                    } else if age.num_hours() < 24 {
                        false
                    } else {
                        let unit = if age.num_days() < 7 { 3600 } else { 86400 };
                        !buckets.insert((unit, time.timestamp() / unit))
                    }
                }
                _ => false,
            };
            if delete {
                tx.execute("DELETE FROM snapshots WHERE id=?1", [&s.id])?;
                removed += 1;
            }
        }
        tx.commit()?;
        // Remove only blobs made unreferenced by this retention pass, not unknown/questionable data.
        if removed > 0 {
            let live: std::collections::HashSet<_> = self
                .snapshots()?
                .iter()
                .flat_map(|s| s.files.iter().map(|f| f.hash.clone()))
                .collect();
            let candidates: std::collections::HashSet<_> = snapshots
                .iter()
                .flat_map(|s| s.files.iter().map(|f| f.hash.clone()))
                .collect();
            for hash in candidates.difference(&live) {
                let p = crate::storage::blob_path(&self.root, hash)?;
                if p.exists() {
                    std::fs::remove_file(p)?;
                }
            }
        }
        Ok(removed)
    }
}
