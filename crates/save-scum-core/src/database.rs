use anyhow::Result;
use rusqlite::{params, Connection};
use serde::{de::DeserializeOwned, Serialize};
use std::path::Path;

pub fn open(path: &Path) -> Result<Connection> {
    let db = Connection::open(path)?;
    db.busy_timeout(std::time::Duration::from_secs(5))?;
    db.execute_batch("PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;
        CREATE TABLE IF NOT EXISTS games (id TEXT PRIMARY KEY, data TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS snapshots (id TEXT PRIMARY KEY, game_id TEXT NOT NULL, created_at TEXT NOT NULL, data TEXT NOT NULL);
        CREATE INDEX IF NOT EXISTS snapshots_game ON snapshots(game_id,created_at);
        CREATE TABLE IF NOT EXISTS settings (id TEXT PRIMARY KEY, data TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS restores (game_id TEXT PRIMARY KEY, backup TEXT NOT NULL);")?;
    let check: String = db.query_row("PRAGMA quick_check", [], |r| r.get(0))?;
    anyhow::ensure!(
        check == "ok",
        "Metadata database failed its integrity check: {check}. Original data has been preserved."
    );
    Ok(db)
}
pub fn list<T: DeserializeOwned>(db: &Connection, table: &str) -> Result<Vec<T>> {
    let sql = match table {
        "games" => "SELECT data FROM games ORDER BY rowid",
        "snapshots" => "SELECT data FROM snapshots ORDER BY created_at DESC",
        _ => anyhow::bail!("Invalid table"),
    };
    let mut stmt = db.prepare(sql)?;
    let rows = stmt.query_map([], |r| r.get::<_, String>(0))?;
    rows.map(|r| Ok(serde_json::from_str(&r?)?)).collect()
}
pub fn game(db: &Connection, value: &crate::models::Game) -> Result<()> {
    db.execute(
        "INSERT OR REPLACE INTO games VALUES (?1,?2)",
        params![value.id, serde_json::to_string(value)?],
    )?;
    Ok(())
}
pub fn snapshot(db: &Connection, value: &crate::models::Snapshot) -> Result<()> {
    db.execute(
        "INSERT OR REPLACE INTO snapshots VALUES (?1,?2,?3,?4)",
        params![
            value.id,
            value.game_id,
            value.created_at,
            serde_json::to_string(value)?
        ],
    )?;
    Ok(())
}
pub fn settings(db: &Connection) -> Result<crate::models::Settings> {
    use rusqlite::OptionalExtension;
    let data: Option<String> = db
        .query_row("SELECT data FROM settings WHERE id='global'", [], |r| {
            r.get(0)
        })
        .optional()?;
    Ok(match data {
        Some(s) => serde_json::from_str(&s)?,
        None => Default::default(),
    })
}
pub fn save_settings<T: Serialize>(db: &Connection, value: &T) -> Result<()> {
    db.execute(
        "INSERT OR REPLACE INTO settings VALUES ('global',?1)",
        [serde_json::to_string(value)?],
    )?;
    Ok(())
}
