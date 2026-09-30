use save_scum_core::{snapshots, storage, Engine};
use std::{
    fs,
    path::PathBuf,
    sync::{Arc, Mutex},
    time::Duration,
};

struct Fixture {
    engine: Engine,
    saves: PathBuf,
    _temp: tempfile::TempDir,
    id: String,
}
impl Fixture {
    fn new() -> Self {
        let temp = tempfile::tempdir().unwrap();
        let saves = temp.path().join("saves");
        fs::create_dir(&saves).unwrap();
        fs::write(saves.join("player.sav"), b"level one").unwrap();
        let saves = saves.canonicalize().unwrap();
        let engine = Engine::open(temp.path().join("library")).unwrap();
        let game = engine
            .add_game("Test Game".into(), saves.to_str().unwrap().into(), None)
            .unwrap();
        Self {
            engine,
            saves,
            _temp: temp,
            id: game.id,
        }
    }
}

#[test]
fn captures_deduplicate_and_survive_reopening() {
    let f = Fixture::new();
    let initial = f.engine.snapshots().unwrap();
    assert_eq!(initial.len(), 1);
    assert!(f.engine.capture(&f.id, "automatic", "").unwrap().is_none());
    let usage = storage::usage(&f.engine.root);
    f.engine.capture(&f.id, "manual", "Before boss").unwrap();
    assert_eq!(storage::usage(&f.engine.root), usage);
    assert_eq!(f.engine.verify_library().unwrap().healthy_snapshots, 2);
    let root = f.engine.root.clone();
    drop(f.engine);
    let reopened = Engine::open(root).unwrap();
    assert_eq!(reopened.snapshots().unwrap().len(), 2);
}
#[test]
fn detects_modified_added_and_removed_files() {
    let f = Fixture::new();
    let a = f.engine.snapshots().unwrap().remove(0);
    fs::write(f.saves.join("player.sav"), b"level two").unwrap();
    fs::write(f.saves.join("world.sav"), b"world").unwrap();
    let b = f.engine.capture(&f.id, "automatic", "").unwrap().unwrap();
    let changes = snapshots::compare(&a.files, &b.files);
    assert_eq!(changes.len(), 2);
    assert_eq!(b.changed, 2);
    assert_eq!(changes[0].status, "modified");
    assert_eq!(changes[1].status, "added");
    fs::remove_file(f.saves.join("world.sav")).unwrap();
    let c = f.engine.capture(&f.id, "automatic", "").unwrap().unwrap();
    assert_eq!(snapshots::compare(&b.files, &c.files)[0].status, "removed");
}
#[test]
fn temporary_files_do_not_make_snapshots() {
    let f = Fixture::new();
    for file in ["working.tmp", "working.part", "working.lock", ".DS_Store"] {
        fs::write(f.saves.join(file), "ignore").unwrap();
    }
    assert!(f.engine.capture(&f.id, "automatic", "").unwrap().is_none());
    let mut settings = f.engine.settings().unwrap();
    settings.ignore_temporary = false;
    f.engine.save_settings(&settings).unwrap();
    assert_eq!(
        f.engine
            .capture(&f.id, "automatic", "")
            .unwrap()
            .unwrap()
            .files
            .len(),
        4
    );
}
#[test]
fn restore_is_exact_and_preserves_current_state() {
    let f = Fixture::new();
    let original = f.engine.snapshots().unwrap().remove(0);
    fs::write(f.saves.join("player.sav"), b"level two").unwrap();
    fs::write(f.saves.join("new.sav"), b"new slot").unwrap();
    fs::write(f.saves.join("write.tmp"), b"pending").unwrap();
    let result = f.engine.restore(&original.id).unwrap();
    assert!(result.contains("Original files also remain"));
    assert_eq!(fs::read(f.saves.join("player.sav")).unwrap(), b"level one");
    assert!(!f.saves.join("new.sav").exists());
    assert_eq!(fs::read(f.saves.join("write.tmp")).unwrap(), b"pending");
    let safety = f
        .engine
        .snapshots()
        .unwrap()
        .into_iter()
        .find(|s| s.kind == "safety")
        .unwrap();
    assert!(safety.protected);
    assert_eq!(safety.files.len(), 2);
    f.engine.restore(&safety.id).unwrap();
    assert_eq!(fs::read(f.saves.join("player.sav")).unwrap(), b"level two");
    assert_eq!(fs::read(f.saves.join("new.sav")).unwrap(), b"new slot");
}
#[test]
fn corrupt_blob_aborts_restore_before_any_live_changes() {
    let f = Fixture::new();
    let s = f.engine.snapshots().unwrap().remove(0);
    fs::write(f.saves.join("player.sav"), b"valuable new state").unwrap();
    fs::write(
        storage::blob_path(&f.engine.root, &s.files[0].hash).unwrap(),
        b"corrupt",
    )
    .unwrap();
    assert!(f.engine.restore(&s.id).is_err());
    assert_eq!(
        fs::read(f.saves.join("player.sav")).unwrap(),
        b"valuable new state"
    );
    assert_eq!(f.engine.snapshots().unwrap().len(), 1);
    let report = f.engine.verify_library().unwrap();
    assert_eq!(report.corrupt_blobs.len(), 1);
    assert_eq!(report.healthy_snapshots, 0);
}
#[test]
fn integrity_distinguishes_missing_and_orphaned_blobs() {
    let f = Fixture::new();
    let s = f.engine.snapshots().unwrap().remove(0);
    fs::remove_file(storage::blob_path(&f.engine.root, &s.files[0].hash).unwrap()).unwrap();
    let orphan = storage::blob_path(&f.engine.root, &"a".repeat(64)).unwrap();
    fs::create_dir_all(orphan.parent().unwrap()).unwrap();
    fs::write(&orphan, "questionable").unwrap();
    let report = f.engine.verify_library().unwrap();
    assert_eq!(report.missing_blobs.len(), 1);
    assert_eq!(report.orphaned_blobs.len(), 1);
    assert!(orphan.exists());
}
#[test]
fn archives_round_trip_without_touching_live_saves() {
    let f = Fixture::new();
    f.engine.capture(&f.id, "panic", "").unwrap();
    let archive = f._temp.path().join("history.savescum");
    f.engine.export_archive(&f.id, None, &archive).unwrap();
    assert!(f.engine.export_archive(&f.id, None, &archive).is_err());
    let other = Engine::open(f._temp.path().join("other-library")).unwrap();
    let target = f._temp.path().join("other-saves");
    fs::create_dir(&target).unwrap();
    fs::write(target.join("untouched.sav"), "live state").unwrap();
    let id = other.import_archive(&archive, &target).unwrap();
    assert_eq!(other.snapshots().unwrap().len(), 2);
    assert!(!other.game(&id).unwrap().watching);
    assert_eq!(
        fs::read_to_string(target.join("untouched.sav")).unwrap(),
        "live state"
    );
    assert_eq!(other.verify_library().unwrap().healthy_snapshots, 2);
    let initial = other
        .snapshots()
        .unwrap()
        .into_iter()
        .find(|s| s.kind == "automatic")
        .unwrap();
    other.restore(&initial.id).unwrap();
    assert_eq!(fs::read(target.join("player.sav")).unwrap(), b"level one");
}
#[test]
fn archive_path_traversal_is_rejected_without_metadata_changes() {
    let f = Fixture::new();
    let mut snapshot = f.engine.snapshots().unwrap().remove(0);
    snapshot.files[0].path = "../escape.sav".into();
    let manifest=serde_json::to_vec(&serde_json::json!({"version":1,"game":f.engine.game(&f.id).unwrap(),"snapshots":[snapshot]})).unwrap();
    let archive = f._temp.path().join("malicious.savescum");
    let mut builder = tar::Builder::new(fs::File::create(&archive).unwrap());
    let mut header = tar::Header::new_gnu();
    header.set_mode(0o600);
    header.set_size(manifest.len() as u64);
    header.set_cksum();
    builder
        .append_data(&mut header, "manifest.json", &manifest[..])
        .unwrap();
    builder.finish().unwrap();
    drop(builder);
    let target = f._temp.path().join("destination");
    fs::create_dir(&target).unwrap();
    assert!(f.engine.import_archive(&archive, &target).is_err());
    assert_eq!(f.engine.games().unwrap().len(), 1);
    assert!(!f._temp.path().join("escape.sav").exists());
}
#[test]
fn retention_preserves_named_favorite_manual_and_protected_snapshots() {
    let f = Fixture::new();
    let protected = f.engine.capture(&f.id, "automatic", "").unwrap();
    assert!(protected.is_none());
    let a = f
        .engine
        .capture(&f.id, "manual", "Keep me")
        .unwrap()
        .unwrap();
    for i in 0..105 {
        fs::write(f.saves.join("player.sav"), format!("level {i}")).unwrap();
        f.engine.capture(&f.id, "automatic", "").unwrap();
    }
    let snaps = f.engine.snapshots().unwrap();
    let old = &snaps[102];
    f.engine
        .patch_snapshot(&old.id, String::new(), String::new(), false, true)
        .unwrap();
    let fav = &snaps[103];
    f.engine
        .patch_snapshot(&fav.id, String::new(), String::new(), true, false)
        .unwrap();
    assert!(f.engine.apply_retention(&f.id).unwrap() > 0);
    assert!(f.engine.snapshot(&a.id).is_ok());
    assert!(f.engine.snapshot(&old.id).is_ok());
    assert!(f.engine.snapshot(&fav.id).is_ok());
    assert_eq!(
        f.engine.verify_library().unwrap().healthy_snapshots,
        f.engine.snapshots().unwrap().len()
    );
}
#[test]
fn unavailable_directory_and_overlapping_roots_are_reported() {
    let f = Fixture::new();
    assert!(f
        .engine
        .add_game("Duplicate".into(), f.saves.to_str().unwrap().into(), None)
        .is_err());
    assert!(f
        .engine
        .add_game(
            "Library".into(),
            f.engine.root.to_str().unwrap().into(),
            None
        )
        .is_err());
    fs::remove_dir_all(&f.saves).unwrap();
    assert!(f.engine.capture(&f.id, "manual", "").is_err());
    assert!(f.engine.library().unwrap().games[0].error.is_some());
    assert_eq!(f.engine.snapshots().unwrap().len(), 1);
}
#[test]
fn single_writer_lock_prevents_competing_engines() {
    let f = Fixture::new();
    assert!(Engine::open(&f.engine.root).is_err());
}
#[test]
fn unsafe_paths_and_hashes_are_rejected() {
    for path in ["../save", "/absolute", "C:/save", "a/../b", "a\\b", ""] {
        assert!(storage::safe_relative(path).is_err(), "{path}");
    }
    assert!(storage::safe_relative("slots/slot 1.sav").is_ok());
    assert!(storage::blob_path(std::path::Path::new("."), "../bad").is_err());
}
#[cfg(unix)]
#[test]
fn symlinks_cannot_escape_the_save_root() {
    let f = Fixture::new();
    std::os::unix::fs::symlink(
        f.engine.root.join("library.sqlite3"),
        f.saves.join("external.sav"),
    )
    .unwrap();
    assert!(f.engine.capture(&f.id, "manual", "").is_err());
    assert_eq!(f.engine.snapshots().unwrap().len(), 1);
}
#[test]
fn watcher_batches_many_file_writes_into_one_snapshot() {
    let f = Fixture::new();
    let mut settings = f.engine.settings().unwrap();
    settings.debounce_ms = 500;
    f.engine.save_settings(&settings).unwrap();
    let engine = Arc::new(Mutex::new(f.engine));
    let (tx, rx) = std::sync::mpsc::channel();
    let worker = save_scum_core::watcher::start(engine.clone(), move |r| {
        let _ = tx.send(r);
    });
    std::thread::sleep(Duration::from_millis(900));
    for i in 0..14 {
        fs::write(f.saves.join(format!("slot-{i}.sav")), format!("save {i}")).unwrap();
        std::thread::sleep(Duration::from_millis(30));
    }
    let result = rx
        .recv_timeout(Duration::from_secs(10))
        .expect("Watcher should capture writes");
    assert!(result.is_ok(), "{result:?}");
    std::thread::sleep(Duration::from_millis(1500));
    {
        let core = engine.lock().unwrap();
        assert_eq!(core.snapshots().unwrap().len(), 2);
        assert_eq!(core.snapshots().unwrap()[0].files.len(), 15);
    }
    drop(worker);
    drop(engine);
}

#[test]
fn interrupted_restore_recovers_original_directory_and_pauses_monitoring() {
    let f = Fixture::new();
    let root = f.engine.root.clone();
    let backup = f.saves.parent().unwrap().join(".save-scum-recovery-test");
    f.engine.capture(&f.id, "safety", "Before restore").unwrap();
    let db = rusqlite::Connection::open(root.join("library.sqlite3")).unwrap();
    db.execute(
        "INSERT INTO restores (game_id,backup) VALUES (?1,?2)",
        rusqlite::params![f.id, backup.to_string_lossy()],
    )
    .unwrap();
    fs::rename(&f.saves, &backup).unwrap();
    drop(db);
    drop(f.engine);
    let reopened = Engine::open(root).unwrap();
    assert_eq!(fs::read(f.saves.join("player.sav")).unwrap(), b"level one");
    let game = reopened.game(&f.id).unwrap();
    assert!(!game.watching);
    assert!(game.error.unwrap().contains("rolled back"));
}

#[test]
fn interrupted_restore_with_present_target_preserves_both_directories_for_review() {
    let f = Fixture::new();
    let root = f.engine.root.clone();
    let backup = f.saves.parent().unwrap().join(".save-scum-recovery-test");
    fs::create_dir(&backup).unwrap();
    fs::write(backup.join("player.sav"), "original").unwrap();
    let db = rusqlite::Connection::open(root.join("library.sqlite3")).unwrap();
    db.execute(
        "INSERT INTO restores (game_id,backup) VALUES (?1,?2)",
        rusqlite::params![f.id, backup.to_string_lossy()],
    )
    .unwrap();
    drop(db);
    drop(f.engine);
    let reopened = Engine::open(root).unwrap();
    assert!(!reopened.game(&f.id).unwrap().watching);
    assert_eq!(
        fs::read_to_string(backup.join("player.sav")).unwrap(),
        "original"
    );
    assert_eq!(fs::read(f.saves.join("player.sav")).unwrap(), b"level one");
}

#[test]
fn invalid_settings_do_not_replace_good_configuration() {
    let f = Fixture::new();
    let mut settings = f.engine.settings().unwrap();
    settings.debounce_ms = 0;
    assert!(f.engine.save_settings(&settings).is_err());
    assert_eq!(f.engine.settings().unwrap().debounce_ms, 2000);
}

#[test]
fn steam_scan_reads_manifests_without_treating_installations_as_saves() {
    let temp = tempfile::tempdir().unwrap();
    let common = temp.path().join("steamapps/common");
    fs::create_dir_all(common.join("Jackbox3")).unwrap();
    fs::create_dir(common.join("Manually installed game")).unwrap();
    fs::create_dir(common.join("Steam Controller Configs")).unwrap();
    fs::create_dir(common.join(".hidden")).unwrap();
    fs::write(common.join("not-a-game.txt"), "ignore").unwrap();
    fs::write(
        common.parent().unwrap().join("appmanifest_434170.acf"),
        r#""AppState"
{
    "appid" "434170"
    "name" "The Jackbox Party Pack 3"
    "installdir" "Jackbox3"
}"#,
    )
    .unwrap();
    let games = save_scum_core::scanner::discover_steam_installs(&common).unwrap();
    assert_eq!(games.len(), 2);
    let jackbox = games
        .iter()
        .find(|g| g.steam_app_id.as_deref() == Some("434170"))
        .unwrap();
    assert_eq!(jackbox.name, "The Jackbox Party Pack 3");
    assert_eq!(jackbox.source, "steamInstall");
    assert!(jackbox.path.is_none());
    assert_eq!(
        jackbox.install_path.as_deref(),
        common.join("Jackbox3").to_str()
    );
}

#[test]
fn steam_scan_handles_missing_directory_and_unicode_manifest_names() {
    let temp = tempfile::tempdir().unwrap();
    assert!(
        save_scum_core::scanner::discover_steam_installs(&temp.path().join("missing"))
            .unwrap()
            .is_empty()
    );
    let common = temp.path().join("common");
    fs::create_dir_all(common.join("Café Quest")).unwrap();
    fs::write(
        temp.path().join("appmanifest_42.acf"),
        r#""AppState"
{
    "appid" "42"
    "name" "Café \"Quest\""
    "installdir" "Café Quest"
}"#,
    )
    .unwrap();
    let games = save_scum_core::scanner::discover_steam_installs(&common).unwrap();
    assert_eq!(games[0].name, "Café \"Quest\"");
}

#[cfg(target_os = "macos")]
#[test]
fn macos_steam_location_uses_the_supplied_user_home() {
    let home = std::path::Path::new("/Users/a-different-player");
    assert_eq!(
        save_scum_core::scanner::steam_common_directories(home),
        vec![home.join("Library/Application Support/Steam/steamapps/common")]
    );
}

#[test]
fn empty_folder_cannot_be_registered_or_captured() {
    let f = Fixture::new();
    let empty = f._temp.path().join("empty");
    fs::create_dir(&empty).unwrap();
    assert_eq!(
        f.engine
            .inspect_folder(empty.to_str().unwrap(), None)
            .unwrap()
            .file_count,
        0
    );
    assert!(f
        .engine
        .add_game("Empty".into(), empty.to_str().unwrap().into(), None)
        .unwrap_err()
        .to_string()
        .contains("No save files"));
    fs::remove_file(f.saves.join("player.sav")).unwrap();
    assert!(f.engine.capture(&f.id, "manual", "").is_err());
}

#[test]
fn empty_legacy_checkpoint_cannot_replace_live_progress() {
    let f = Fixture::new();
    let mut snapshot = f.engine.snapshots().unwrap().remove(0);
    snapshot.files.clear();
    snapshot.size = 0;
    let db = rusqlite::Connection::open(f.engine.root.join("library.sqlite3")).unwrap();
    save_scum_core::database::snapshot(&db, &snapshot).unwrap();
    assert!(f
        .engine
        .restore(&snapshot.id)
        .unwrap_err()
        .to_string()
        .contains("no save files"));
    assert_eq!(fs::read(f.saves.join("player.sav")).unwrap(), b"level one");
    assert_eq!(f.engine.snapshots().unwrap().len(), 1);
}

#[test]
fn unchanged_restore_reports_no_changes_without_safety_copy() {
    let f = Fixture::new();
    let snapshot = f.engine.snapshots().unwrap().remove(0);
    let preview = f.engine.preview_restore(&snapshot.id).unwrap();
    assert!(preview.identical);
    let report = f.engine.restore_report(&snapshot.id).unwrap();
    assert_eq!(report.status, "unchanged");
    assert!(report.safety_snapshot_id.is_none());
    assert_eq!(f.engine.snapshots().unwrap().len(), 1);
}

#[test]
fn changing_save_folder_keeps_old_history_from_overwriting_new_progress() {
    let f = Fixture::new();
    let old = f.engine.snapshots().unwrap().remove(0);
    let corrected = f._temp.path().join("real-saves");
    fs::create_dir(&corrected).unwrap();
    fs::write(corrected.join("bphRun0.sav"), b"actual progress").unwrap();
    let game = f
        .engine
        .change_save_folder(&f.id, corrected.to_str().unwrap())
        .unwrap();
    assert_eq!(
        game.path,
        corrected.canonicalize().unwrap().to_str().unwrap()
    );
    assert!(f
        .engine
        .restore(&old.id)
        .unwrap_err()
        .to_string()
        .contains("different save folder"));
    assert_eq!(
        fs::read(corrected.join("bphRun0.sav")).unwrap(),
        b"actual progress"
    );
    assert_eq!(fs::read(f.saves.join("player.sav")).unwrap(), b"level one");
    let new = f
        .engine
        .snapshots()
        .unwrap()
        .into_iter()
        .find(|s| s.id != old.id)
        .unwrap();
    fs::write(corrected.join("bphRun0.sav"), b"later progress").unwrap();
    let preview = f.engine.preview_restore(&new.id).unwrap();
    assert_eq!(preview.changes.len(), 1);
    let report = f.engine.restore_report(&new.id).unwrap();
    assert_eq!(report.status, "restored");
    assert_eq!(report.changed_files, 1);
    assert!(report.recovery_path.is_some());
    assert_eq!(
        fs::read(corrected.join("bphRun0.sav")).unwrap(),
        b"actual progress"
    );
}

#[test]
fn detected_running_game_blocks_restore_before_live_changes() {
    let f = Fixture::new();
    let snapshot = f.engine.snapshots().unwrap().remove(0);
    let system = sysinfo::System::new_all();
    let process = system
        .process(sysinfo::Pid::from_u32(std::process::id()))
        .unwrap();
    let mut game = f.engine.game(&f.id).unwrap();
    game.executables = vec![process.name().to_string_lossy().into_owned()];
    let db = rusqlite::Connection::open(f.engine.root.join("library.sqlite3")).unwrap();
    save_scum_core::database::game(&db, &game).unwrap();
    fs::write(f.saves.join("player.sav"), b"new progress").unwrap();
    assert!(f.engine.preview_restore(&snapshot.id).unwrap().game_running);
    assert!(f
        .engine
        .restore_report(&snapshot.id)
        .unwrap_err()
        .to_string()
        .contains("Close the game"));
    assert_eq!(
        fs::read(f.saves.join("player.sav")).unwrap(),
        b"new progress"
    );
    assert_eq!(f.engine.snapshots().unwrap().len(), 1);
}
