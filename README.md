# Save Scum

**Because autosave is not a backup strategy.**

A local desktop utility that watches game save folders, keeps versioned snapshots, and makes bad decisions reversible. Rust snapshot engine, Tauri 2 shell, React + TypeScript interface. No account, service, telemetry, or internet connection is required at runtime. Fonts and the included artwork are bundled locally.

## Run

Prerequisites: Node.js 20.19+ (22 recommended), npm, Rust 1.90, and the [Tauri platform prerequisites](https://v2.tauri.app/start/prerequisites/). The repository pins the Rust toolchain and includes both dependency lockfiles.

```sh
npm ci
npm run desktop
```

The desktop app starts with an empty library. Choose **Add game**, detect a known location or select a folder, and inspect the initial snapshot. All real filesystem operations happen in Rust.

To explore the interface without accessing game saves:

```sh
npm run dev
```

Open **http://127.0.0.1:1437**. Browser mode is explicitly labeled **Interactive demo**. It uses sample games and browser-local simulated snapshots. It cannot watch, restore, import, or export real files. Clear `save-scum-demo-v1` in browser local storage to reset the demo.

## Build

```sh
npm run tauri -- build
```

Build on the target operating system. On macOS, an app-only build is:

```sh
npm run tauri -- build --bundles app
open "target/release/bundle/macos/Save Scum.app"
```

The local build is not a notarized distribution release. Windows and Linux compilation/tests are configured in `.github/workflows/ci.yml`; they still need to be run on those platforms. On Linux, install WebKitGTK 4.1 and an AppIndicator library. Global shortcut and tray support depends on the desktop environment, particularly under Wayland.

## What is implemented

- Game library, local cover artwork, save paths, health, activity, running-process hints, and monitoring controls.
- Installed Steam game detection using the current user’s home directory, save-folder discovery for six games, native directory picker, platform-specific path templates, and custom definitions.
- Recursive `notify` watchers, quiet-period debouncing, bounded event buffering, change batching, ignore rules, and periodic retry/reconciliation.
- BLAKE3 content addressing, streamed Zstandard compression, file-level deduplication across games, atomic blob publication, SQLite WAL metadata, and a single-writer library lock.
- Manual checkpoints, Panic Saves, labels, notes, favorites, protected checkpoints, date/game/text search, and session grouping (90-minute activity gaps).
- File-level comparison with added, removed and modified files, sizes, and timestamps.
- Verified staged restore, a protected pre-restore checkpoint, rollback, preserved original directories, and interrupted-restore recovery.
- Per-game count/age/smart/unlimited retention, compression/debounce settings, storage limit, logical and physical storage metrics, and library integrity verification.
- Portable `.savescum` game-history and single-snapshot archives. Imports validate before metadata commit and never overwrite the live folder.
- Background tray, status indicator, global shortcuts, startup preference, minimize-to-tray, native notifications, and diagnostics export.

## Safety model

Snapshots are committed only after all referenced blobs have been written, decompressed and verified. Save files are scanned again after capture; a changing directory aborts the snapshot without committing an incomplete manifest. Unchanged automatic snapshots are suppressed. Manual and panic captures can intentionally checkpoint unchanged contents.

Restore validates and stages all requested files in a temporary sibling directory on the save volume. It then captures the current state, checks that it has not changed, durably records a recovery journal in SQLite, renames the original directory aside, and moves the staged version into place. Files are verified again after the swap. A failed replacement rolls back. A process interrupted between swaps is recovered on the next engine open where possible; monitoring is paused and the game reports the recovery outcome for review.

**Close the game before restoring.** Filesystem scanning cannot lock an uncooperative game across all platforms. Original files are therefore also retained in a `.save-scum-recovery-<uuid>` directory beside the save folder. The protected safety checkpoint's notes record this path. Remove recovery directories manually only after verifying the restored game. They are not part of the displayed compressed blob usage or automatic retention.

Symbolic links, special files, unsafe relative paths, overlapping monitored roots, and overlap between saves and snapshot storage are rejected. Archives accept only expected regular-file entries, reject duplicates/traversal, validate file hashes, and remap identifiers. Existing archive/diagnostics destinations are not overwritten.

Retention always keeps the newest snapshot, manual and safety checkpoints, panic saves, favorites, protected snapshots, and snapshots with labels. Only eligible automatic snapshots expire. Blob cleanup deletes only files made unreferenced by that retention pass. Integrity verification reports questionable/orphaned data without deleting it.

The storage limit blocks a snapshot commit after exceeding the configured compressed-blob budget. A failed capture can leave unreferenced blobs, which are reported by verification; this is a soft capacity guard, not a filesystem quota. Keep free disk space for staging and pre-restore recovery copies.

## Storage and configuration

By default the library is under Tauri's platform application-data directory for `app.savescum.desktop`, shown in Settings → Storage. On macOS this is normally `~/Library/Application Support/app.savescum.desktop`.

```text
library.sqlite3          SQLite metadata, settings and recovery journal
library.sqlite3-wal      SQLite write-ahead log (while open)
engine.lock              Prevents competing library writers
blobs/ab/<blake3>.zst    Compressed, content-addressed files
game-definitions.json   Optional user-maintained discovery definitions
```

To choose a different snapshot location before starting:

```sh
SAVE_SCUM_DATA_DIR="/path/to/snapshot-library" npm run desktop
```

On PowerShell, use `$env:SAVE_SCUM_DATA_DIR = 'D:\SaveScum'` before launching. A new path opens a separate library; it does not migrate an existing one. To move a library, quit the application, copy the entire directory, and relaunch with the new location.

Known definitions live in [`data/games.json`](data/games.json). Add an array of definitions to `game-definitions.json` in the library directory to extend discovery. Templates support `~`, `%USERPROFILE%`, `%LOCALAPPDATA%`, `%APPDATA%`, `%PROGRAMFILES(X86)%`, and glob wildcards.

```json
[
  {
    "name": "My Game",
    "steamAppId": "123456",
    "executables": ["MyGame.exe", "my-game"],
    "paths": {
      "windows": ["%APPDATA%/MyGame/Saves"],
      "linux": ["~/.local/share/my-game/saves"],
      "macos": ["~/Library/Application Support/MyGame/Saves"]
    }
  }
]
```

**Add game → Detect installed games** searches `~/Library/Application Support/Steam/steamapps/common` on macOS, resolving `~` from the current login user’s home directory. It scans immediate game folders and reads adjacent `appmanifest_*.acf` files for names and Steam app IDs. Default Steam locations are also searched on Linux and Windows.

Known save-folder templates are searched alongside installed games. An installed game whose save location is unknown is labeled **Installed on Steam · Choose save folder**; selecting it fills the name and Steam ID, then requires choosing its actual save directory. Install directories are never automatically registered as save folders. Custom Steam library locations and unsupported save locations can be added manually. Bundled executable names provide best-effort activity detection; it is never required for snapshots.

## Shortcuts

| Action                             | Shortcut             |
| ---------------------------------- | -------------------- |
| Create checkpoint for panic target | Ctrl + Shift + S     |
| Panic save                         | Ctrl + Shift + F12   |
| Show app                           | Ctrl + Shift + Space |
| Search in app                      | Cmd/Ctrl + K         |
| Settings in app                    | Cmd/Ctrl + ,         |

Global shortcuts are fixed in this version. A registration conflict is reported in the interface; tray and UI actions remain available. The Panic Save target can be explicitly configured or selected from monitored games by running-process status and latest save activity.

## Project structure

```text
crates/save-scum-core/   GUI-independent engine and integration tests
  src/
    watcher.rs          Watch lifecycle, debouncing, batching and retries
    snapshots.rs        Consistent capture, manifests and comparison
    restore.rs          Staging, safety snapshot, swap, rollback and journal
    storage.rs          Safe paths, blobs, hashing and usage
    compression.rs      Streamed Zstandard encoding/decoding
    database.rs         SQLite schema and persistence
    games.rs            Registration and process detection
    scanner.rs          Platform-specific discovery definitions
    retention.rs        Policies and conservative blob reclamation
    integrity.rs        Hash verification and orphan reporting
    archive.rs          Validated portable import/export
src-tauri/              Native commands, tray, notifications and global shortcuts
src/                    React interface, shared types and isolated browser demo
data/                   Community-extensible game location definitions
tests/                  Playwright user-flow tests
```

The frontend uses a typed Rust `dispatch` request enum with a tagged `action`. Background changes emit `library-changed`; failures emit `engine-error`. Heavy native operations run on blocking worker threads. A single engine mutex serializes snapshots and restores; the main UI thread does not wait on that lock when closing or using tray controls.

## Verify

```sh
cargo test --locked -p save-scum-core
cargo clippy --workspace --all-targets -- -D warnings
npm run build
npx playwright install chromium
npm run test:ui
```

The integration suite covers deduplication, changed/added/deleted files, temporary files, reversible restore, corruption rejection, missing/orphaned blobs, portable archives, malicious paths, retention protection, unavailable folders, exclusive locking, symlink rejection, live watcher batching, settings validation, and two interrupted-restore cases. Browser tests exercise library filters, persisted settings, checkpoints, notes, favorites, restore, panic, comparison, adding games, integrity reports, onboarding, keyboard focus, and narrow layouts.

## Current boundaries

This is a functional first version, not a claim of exhaustive crash or hardware-failure testing. Automated fault coverage does not simulate every disk-full, drive-disconnect, permission or locked-file combination. Errors are surfaced, capture commits are withheld, and original restore directories are preserved.

Large libraries are currently loaded into the UI as complete manifests; timeline virtualization and indexed search are future improvements. Snapshots stream individual blobs but scan the save directory twice, and the periodic fallback checks active games once per minute. Network filesystems have their own locking/rename behavior and have not been validated. Snapshot storage migration and configurable hotkey bindings are not yet in the UI.

No cloud sync, authentication, Steam account integration, save-format parsing, or remote infrastructure is included.

## Asset attribution

DM Sans and Manrope are distributed under the SIL Open Font License; their license files are included in `public/fonts`. Lucide icons use the ISC license. The six bundled game covers are publisher artwork retrieved from the Steam content CDN; rights remain with the respective publishers. See [`docs/assets.md`](docs/assets.md) for the source URLs.

If a game loads unchanged progress after restoring, check the **Save files** path in its history. This must be the game's existing save directory, not a folder created for backups. Use **Fix save folder** or **Change save folder**, then **Detect save folder** and review the file count before applying it. On macOS, Backpack Hero is detected at `~/Library/Application Support/TheJaspel/Backpack Hero`. Save Scum stores checkpoints in its separate backup vault.

Empty folders and empty checkpoints are rejected. Changing the save folder preserves history and creates a new checkpoint; checkpoints from the old folder cannot overwrite the corrected folder. The restore dialog previews file changes, requires confirming the game is closed, blocks detected running games, and keeps the verified result and recovery path visible. An identical checkpoint reports that no changes are needed. Previously recorded empty checkpoints contain no progress to recover.

## License

[MIT NON-AI License](LICENSE). This custom, source-available license permits use, modification, and redistribution subject to its terms, but **prohibits all AI/ML use of the code**, including training, inference, AI integrations, and supplying the code to AI coding tools, unless separately authorized in writing by the applicable copyright holder(s). It is not the standard MIT License or an OSI-approved open-source license.

Third-party components and assets retain their own licenses. Previously granted licenses are not retroactively revoked. See the license file for the full terms.

## House Edge browser analytics

The browser version includes House Edge page/view tracking, anonymous sessions, errors, and Web Vitals. Native Tauri sessions are always excluded, even when analytics environment variables are set. Named views are mapped to fixed paths; project names, file contents, and search text are not used as page names.

Create a House Edge project with key `save-scum` and allow this site's exact origin. Set `VITE_HOUSE_EDGE_KEY` to its **browser ingestion key** and `VITE_HOUSE_EDGE_ENDPOINT` to your collector URL ending in `/api/collect`, using `.env.local` or your build environment. `.env.example` lists the settings. Rebuild and redeploy the browser version, then check Live Activity for `page_view` and `session_start` after about five seconds.

Tracking is off when the key or endpoint is missing, and development requires `VITE_HOUSE_EDGE_TRACK_DEVELOPMENT=true`. Do Not Track is respected. The SDK is installed from the checked-in `vendor/house-edge-analytics-0.1.1.tgz`, so independent builds need no sibling House Edge checkout. Commit the tarball with its package manifest and lockfile.
