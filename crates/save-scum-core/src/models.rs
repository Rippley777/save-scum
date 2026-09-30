use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Game {
    pub id: String,
    pub name: String,
    pub path: String,
    pub steam_app_id: Option<String>,
    pub watching: bool,
    pub retention: String,
    pub last_activity: Option<String>,
    pub error: Option<String>,
    pub running: bool,
    pub executables: Vec<String>,
}
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SaveFile {
    pub path: String,
    pub hash: String,
    pub size: u64,
    pub modified: String,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    pub id: String,
    pub game_id: String,
    pub created_at: String,
    pub kind: String,
    pub label: String,
    pub notes: String,
    pub favorite: bool,
    pub protected: bool,
    pub files: Vec<SaveFile>,
    pub size: u64,
    pub changed: usize,
    #[serde(default)]
    pub source_path: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FolderFile {
    pub path: String,
    pub size: u64,
}
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FolderInspection {
    pub path: String,
    pub file_count: usize,
    pub total_bytes: u64,
    pub files: Vec<FolderFile>,
}
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RestorePreview {
    pub snapshot_id: String,
    pub save_path: String,
    pub file_count: usize,
    pub current_file_count: usize,
    pub changes: Vec<FileChange>,
    pub identical: bool,
    pub game_running: bool,
}
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RestoreReport {
    pub status: String,
    pub snapshot_id: String,
    pub save_path: String,
    pub file_count: usize,
    pub changed_files: usize,
    pub safety_snapshot_id: Option<String>,
    pub recovery_path: Option<String>,
    pub restored_at: String,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Settings {
    pub launch_at_startup: bool,
    pub minimize_to_tray: bool,
    pub notifications: bool,
    pub panic_notifications: bool,
    pub compression_level: i32,
    pub debounce_ms: u64,
    pub ignore_temporary: bool,
    pub default_retention: String,
    pub storage_limit_gb: u64,
    pub panic_game_id: Option<String>,
}
impl Default for Settings {
    fn default() -> Self {
        Self {
            launch_at_startup: false,
            minimize_to_tray: true,
            notifications: false,
            panic_notifications: true,
            compression_level: 3,
            debounce_ms: 2000,
            ignore_temporary: true,
            default_retention: "100".into(),
            storage_limit_gb: 0,
            panic_game_id: None,
        }
    }
}
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Library {
    pub games: Vec<Game>,
    pub snapshots: Vec<Snapshot>,
    pub settings: Settings,
    pub storage_bytes: u64,
    pub storage_path: String,
}
#[derive(Debug, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct IntegrityReport {
    pub healthy_snapshots: usize,
    pub missing_blobs: Vec<String>,
    pub corrupt_blobs: Vec<String>,
    pub orphaned_blobs: Vec<String>,
}
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileChange {
    pub path: String,
    pub status: String,
    pub before: Option<SaveFile>,
    pub after: Option<SaveFile>,
}
