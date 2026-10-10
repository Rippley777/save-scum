# Building Save Scum

Save Scum uses **Tauri 2**, React/TypeScript/Vite, npm, and Rust 1.90.0.
The Rust workspace contains `crates/save-scum-core` (the default workspace member)
and `src-tauri` (the desktop executable). SQLite and Zstandard are built through
the existing Rust dependencies; system WebView, tray, and notification dependencies
are platform specific. Neither cloud authentication nor another application is
needed to build the desktop app.

## Local development build

Install Node.js 20.19+ (22 recommended), npm, the pinned Rust toolchain, and
[Tauri's platform prerequisites](https://v2.tauri.app/start/prerequisites/).

- **Windows:** Visual Studio C++ Build Tools, Windows SDK, and WebView2.
- **macOS:** Xcode Command Line Tools (`xcode-select --install`). Installer generation
  requires macOS. Intel and ARM64 Rust targets are supported by the existing stack.
- **Linux:** GCC/build tools, WebKitGTK 4.1, AppIndicator, SVG tooling, patchelf,
  and the packaging prerequisites below. Use an x86-64 GNU/Linux host.

For Ubuntu 22.04:

```sh
sudo apt-get update
sudo apt-get install -y build-essential curl wget file libssl-dev \
  libwebkit2gtk-4.1-dev libappindicator3-dev librsvg2-dev patchelf libfuse2 rpm
```

```sh
npm ci
npm run desktop       # native development app
npm run dev           # browser demo
npm run build         # frontend only, dist/
npm run build:desktop # conventional Tauri build, target/release/bundle/
```

`build:desktop` keeps Tauri's existing `targets: all` packaging convention and
checks version consistency. Existing direct `npm run tauri -- build` commands
still work. Conventional Tauri builds do not run the release archive protocol;
use `release:local` when preserving history matters.

## Local release build

```sh
npm run release       # alias of release:local; current host and architecture
```

The release command archives existing builds **before** running Rust or frontend
builds. It builds in an isolated Cargo target directory, requires every expected
installer, checks executable architecture and packaging signatures, verifies
checksums and metadata, then promotes staging to `builds/current`.
Lockfiles are enforced with Cargo `--locked`; use `npm ci` before releasing.
No dependency installation or version bump happens implicitly.

Host-specific aliases follow exactly the same archive and staging protocol:

```sh
npm run build:windows  # Windows x86-64 host: MSI, NSIS setup EXE, EXE, ZIP
npm run build:linux    # Linux x86-64 host: AppImage, DEB, RPM, tar.gz
npm run build:mac      # macOS: native architecture DMG and compressed .app
```

Each command rejects an incompatible host with an actionable explanation. A
local invocation replaces the active build set with **only the targets it built**;
the entire previous set, including other platforms, stays in the archive. Its
manifest uses `scope: "local"` and lists exactly those targets.

On either supported Mac architecture:

```sh
npm run build:mac -- --arch arm64
npm run build:mac -- --arch x86_64
npm run build:mac -- --arch universal
npm run build:mac -- --arch all
```

`--arch all` builds ARM64, Intel, then Universal 2 in the same transaction. Tauri
uses both Rust targets and `lipo` for Universal 2. The helper installs required
Rust targets with `rustup target add`; it needs access to the Rust distribution
server if they are not already installed. The Universal build keeps both
individual builds. A failure in any required target prevents promotion.

macOS `.app` bundles are distributed as `.app.tar.gz` to retain executable
permissions and framework symbolic links during workflow upload/download.
Extract with `tar -xzf <file>.app.tar.gz`. Windows ZIP/EXE builds require the
WebView2 runtime; the MSI/NSIS installers handle Tauri's WebView2 setup. Linux's
raw executable tarball requires compatible system GTK/WebKit libraries; use
AppImage or the package installer for normal distribution. Downloads of
AppImages from GitHub Actions require `chmod +x <file>.AppImage`.

## Full cross-platform release

The manual **Build Save Scum release** workflow (`.github/workflows/build-release.yml`)
produces all five targets:

| Platform | Architecture | Rust target                             | Runner           | Distributables                    |
| -------- | ------------ | --------------------------------------- | ---------------- | --------------------------------- |
| Windows  | x86_64       | `x86_64-pc-windows-msvc`                | `windows-2022`   | MSI, NSIS EXE, portable EXE + ZIP |
| Linux    | x86_64       | `x86_64-unknown-linux-gnu`              | `ubuntu-22.04`   | AppImage, DEB, RPM, tar.gz        |
| macOS    | arm64        | `aarch64-apple-darwin`                  | `macos-15`       | DMG, .app.tar.gz                  |
| macOS    | x86_64       | `x86_64-apple-darwin`                   | `macos-15-intel` | DMG, .app.tar.gz                  |
| macOS    | Universal 2  | `universal-apple-darwin` (Tauri target) | `macos-15`       | DMG, .app.tar.gz                  |

The macOS labels are listed in the current
[GitHub runner catalog](https://github.com/actions/runner-images). Ubuntu 22.04
is the existing project's desktop baseline and a
[Tauri-supported AppImage build baseline](https://v2.tauri.app/distribute/appimage/).
Building on newer Linux distributions can increase the required glibc version.
Runner labels and hosted environments should be reviewed as GitHub retires images.

Commit and push the implementation first. Start the workflow in GitHub's Actions
UI, or install/authenticate the GitHub CLI and run:

```sh
npm run release:ci                      # current pushed branch
npm run release:ci -- --ref main         # specified pushed ref
gh run list --workflow build-release.yml
```

The command dispatches CI; it does not wait for completion or publish anything.
It refuses uncommitted changes because CI builds the pushed ref. The workflow
can also be dispatched for a pushed version tag using GitHub's UI or CLI.

The preparation job restores the newest retained successful build from this
workflow on the same branch (or across refs for a tag build), copies it to a verified timestamped archive, and
uploads `release-baseline` **before the native matrix starts**. Download or
archive failures abort all builds. On a first run (or after prior artifacts
expire), there is no prior CI set; this is explicitly reported. GitHub runners
are ephemeral and cannot access local `builds/current`.

Individual build jobs produce `target-*` artifacts. The Universal job runs after
the individual matrix succeeds. Only after all five targets succeed does the
assembly job validate version, source commit, exact target/format completeness,
file size, executable architecture, and SHA-256 hashes, and publish the workflow
artifact **`save-scum-release`**. Partial target artifacts aid diagnosis; they are
never labeled as a complete release. Failure logs are uploaded separately.

`save-scum-build-history` retains the verified previous build; `release-baseline`
is still available if subsequent builds fail. Actions artifacts use 90-day
retention (subject to repository settings), unlike unlimited local history.
Download them to permanent storage before expiration when long-term CI history
is required. Old successful workflow artifacts are never overwritten.

For a future GitHub Release, attach files from the downloaded `save-scum-release`
artifact along with `manifest.json` and `SHA256SUMS`. Keep the platform folders
when verifying the supplied checksums. This workflow grants no write permission,
creates releases, publishes assets, or deploys the website.

## Build history and failure recovery

```text
builds/
  current/
    windows/x86_64/
    linux/x86_64/
    macos/arm64/
    macos/x86_64/
    macos/universal/
    manifest.json
    SHA256SUMS
  archive/
    v0.1.0_2026-10-03_00-05-32-123_UTC_current_<unique-id>/
    <timestamp>_legacy-native_<unique-id>/
  staging/<run-id>/
  work/<run-id>/target/
  logs/<run-id>.log
  release-manifest.json
```

Archive names use UTC timestamps with milliseconds and a random suffix. A known
previous version is included only when its manifest provides one. An exclusive
directory creation prevents overwriting an existing archive.

Archives preserve installers, executables, bundles, platform folders, checksum
files, manifests, permissions, symbolic links, and empty directories. Every copy
is checked against inventories of both source and destination, including SHA-256
hashes, sizes, link targets, and permissions. Source changes during archival
abort the release. `archive-metadata.json` records archive time, original paths,
file sizes, and checksums even for legacy builds without a manifest. Existing
metadata is retained; a unique metadata filename is used if necessary.

The helper also archives old Tauri bundle directories under `target/` and
`src-tauri/target/`, including target-triple subdirectories. These legacy output
directories stay untouched. Only the helper's isolated Cargo workspace is
removed after success; failed work and staging remain for diagnosis. Staging
uses a fresh unique directory rather than deleting a failed prior attempt.

`builds/current` is never built into. Promotion uses same-volume directory
renames with a durable journal, rollback on errors, and a root manifest update.
Windows and POSIX do not provide the same portable atomic directory exchange;
there can be a brief gap between the two renames. The previous directory and
verified archive are retained until promotion commits. An interrupted promotion
is rolled back before the next release. Its unpublished new directory is retained
under `.interrupted-*` or `.failed-*` for inspection.

If a process crashes, its exclusive lock blocks competing releases. Once that
process has exited:

```sh
npm run release:recover
```

Recovery checks that the recorded PID is dead on the same host before clearing
the lock. It refuses a live PID, another host, or unreadable ownership metadata;
inspect `builds/.release-lock/owner.json` manually in those cases. Do not remove
a live release's lock. A normal build error releases its lock automatically,
leaves current unchanged, and prints the failed target and log path.

No automatic archive deletion or retention policy is implemented locally.
Archiving is isolated in `archiveTree` so a separately authorized future retention
tool can operate on verified archive metadata. The whole `builds/` directory is
gitignored; binary history never belongs in source control. Ensure sufficient
disk space for copying the old release and compiling both new Mac architectures.

## Version, metadata, and checksums

`src-tauri/tauri.conf.json` is the authoritative desktop version. The release
helper rejects mismatches in both crates, `package.json`, `package-lock.json`
(including its root package), and the workspace packages in `Cargo.lock`.
The independently deployed website has its own package version.

```sh
npm run version:check
npm run version:sync              # copy the canonical Tauri version everywhere
npm run version:sync -- 0.2.0     # explicitly set the next desktop version
```

Synchronization updates the existing JSON/TOML files and lockfile package entries
without upgrading dependencies. Commit all affected version files together.

Artifacts use `SaveScum-v{version}-{platform}-{architecture}`; NSIS adds
`-setup.exe`, and compressed app bundles use `.app.tar.gz`.
`manifest.json` records the actual version, full Git commit, dirty working-tree
flag, UTC build time, release scope, exact targets, signing status, artifact paths,
sizes, SHA-256 hashes, and executable architecture/hash evidence. Assembly checks
the executables inside compressed Mac/Linux archives rather than trusting target
labels alone. Archive member inspection is bounded to 256 MiB per executable.
MSI/NSIS/DMG architecture derives from Tauri's explicitly targeted, inspected
application executable; NSIS's installer stub can itself be 32-bit.

Every distributable has one `SHA256SUMS` line with a path relative to current:

```sh
cd builds/current
shasum -a 256 -c SHA256SUMS     # macOS
sha256sum -c SHA256SUMS        # Linux
```

On Windows, compare `Get-FileHash -Algorithm SHA256 <artifact>` with the matching
manifest or checksum entry. `builds/release-manifest.json` mirrors the active
manifest and is updated during promotion.

## Signing

Release helper outputs are **development distributions**, explicitly labeled in
the manifest and summary. Windows artifacts are unsigned. macOS uses an ad-hoc
signature (`-`) for ARM64 execution, requiring no certificates. An ad-hoc
signature is not a trusted Developer ID signature or notarization.

Gatekeeper may warn about downloaded development apps. Review the artifact and
use macOS's per-app approval in Privacy & Security when appropriate; do not
disable Gatekeeper globally. See
[Tauri's signing and notarization guidance](https://v2.tauri.app/distribute/sign/macos/).

Production distribution should add Windows Authenticode signing and macOS
Developer ID signing, hardened runtime, and notarization. Add those as an explicit
build mode **before hashing/verification and promotion**, using GitHub Actions
secrets and Tauri's native signing configuration. The helper deliberately removes
Apple/updater signing credentials from its development build environment and
forces ad-hoc macOS signing so ambient credentials cannot change signing behavior.
No certificates or secrets are required or stored by the current workflow.

## Verification

```sh
cargo fmt --all -- --check
npm run lint:release
npm run version:check
npm run typecheck
npm run test:release
cargo test --locked -p save-scum-core
cargo clippy --locked --workspace --all-targets -- -D warnings
npm run build
npm run test:ui
```

`npm run format:release` formats only release tooling/configuration/documentation;
it does not reformat application source. `lint:release` combines formatting checks
and JavaScript syntax checks; the repository has no existing ESLint setup.
The release tests exercise preservation, exclusive locks, version synchronization,
wrong architectures, missing/invalid artifacts, hash tampering, incomplete CI
sets, promotion failures, and interruption recovery. Native installer creation
is verified by real local releases and by the full CI matrix.
