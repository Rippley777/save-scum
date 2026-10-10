import assert from "node:assert/strict";
import { test } from "node:test";
import {
  cp,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import { tmpdir, hostname } from "node:os";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { projectRoot, checkVersions, syncVersions } from "./version.mjs";
import { release, gitMetadata } from "./release.mjs";
import {
  archiveTree,
  inventory,
  promote,
  acquireLock,
  recoverLock,
  recoverPromotion,
  atomicJson,
} from "./release-store.mjs";
import {
  allTargets,
  artifactName,
  selectTargets,
  targets,
  verifyExecutable,
  validateArtifact,
  verifyManifest,
  writeManifest,
} from "./release-artifacts.mjs";

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), "save-scum-release-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  for (const name of [
    "package.json",
    "package-lock.json",
    "Cargo.lock",
    "src-tauri/tauri.conf.json",
    "src-tauri/Cargo.toml",
    "crates/save-scum-core/Cargo.toml",
  ]) {
    await mkdir(join(root, name, ".."), { recursive: true });
    await cp(join(projectRoot, name), join(root, name));
  }
  execFileSync("git", ["init", "--quiet", root]);
  execFileSync("git", [
    "-C",
    root,
    "-c",
    "user.name=Release Test",
    "-c",
    "user.email=release@example.invalid",
    "commit",
    "--allow-empty",
    "-qm",
    "fixture",
  ]);
  const builds = join(root, "builds");
  await mkdir(join(builds, "current"), { recursive: true });
  await writeFile(
    join(builds, "current", "previous.bin"),
    "known good release",
  );
  return { root, builds };
}

function executable(platform = "windows", arch = "x86_64") {
  const data = Buffer.alloc(512);
  if (platform === "windows") {
    data.write("MZ");
    data.writeUInt32LE(128, 60);
    data.write("PE\0\0", 128);
    data.writeUInt16LE(0x8664, 132);
    data.writeUInt16LE(0x20b, 152);
  } else if (platform === "linux") {
    Buffer.from([0x7f, 0x45, 0x4c, 0x46, 2, 1]).copy(data);
    data.writeUInt16LE(62, 18);
  } else if (arch === "universal") {
    data.writeUInt32BE(0xcafebabe, 0);
    data.writeUInt32BE(2, 4);
    data.writeUInt32BE(0x1000007, 8);
    data.writeUInt32BE(0x100000c, 28);
  } else {
    data.writeUInt32LE(0xfeedfacf, 0);
    data.writeUInt32LE(arch === "arm64" ? 0x100000c : 0x1000007, 4);
  }
  return data;
}

// Packaging signatures are fixtures only; production artifacts come exclusively from Tauri.
async function windowsBuilder({ staged, version, key }) {
  const target = targets[key];
  const data = executable();
  const artifacts = [];
  await mkdir(join(staged, "windows/x86_64"), { recursive: true });
  for (const extension of target.extensions) {
    const bytes =
      extension === ".msi"
        ? Buffer.from("d0cf11e0a1b11ae10000", "hex")
        : extension === ".zip"
          ? Buffer.from("504b03040000", "hex")
          : data;
    const file = `windows/x86_64/${artifactName(version, target, extension)}`;
    await writeFile(join(staged, file), bytes);
    artifacts.push({
      platform: "windows",
      arch: "x86_64",
      extension,
      file,
      ...(await validateArtifact(join(staged, file), target, extension)),
      signing: "unsigned",
    });
  }
  return {
    artifacts,
    binary: {
      target: key,
      platform: "windows",
      architectures: ["x86_64"],
      sha256: createHash("sha256").update(data).digest("hex"),
      archiveMember: "save-scum",
    },
  };
}

test("archive preserves files, metadata, empty directories, and verifies hashes; collisions never overwrite", async (t) => {
  const { builds } = await fixture(t);
  const current = join(builds, "current");
  await mkdir(join(current, "macos/Save Scum.app/empty"), { recursive: true });
  await writeFile(join(current, "manifest.json"), '{"version":"0.0.9"}');
  if (process.platform !== "win32")
    await symlink("previous.bin", join(current, "link"));
  const before = await inventory(current);
  const date = new Date("2026-10-03T00:05:32.123Z");
  const first = await archiveTree(current, builds, "current", date);
  const second = await archiveTree(current, builds, "current", date);
  assert.notEqual(first, second);
  assert.match(first, /v0\.0\.9_2026-10-03_00-05-32-123_UTC/);
  assert.deepEqual(await inventory(current), before);
  assert.deepEqual(
    (await inventory(first)).filter(
      (entry) => entry.file !== "archive-metadata.json",
    ),
    before,
  );
  assert.equal(
    JSON.parse(await readFile(join(first, "archive-metadata.json"))).verified,
    true,
  );
});

test("archival failure aborts before builder and leaves current untouched", async (t) => {
  const { root, builds } = await fixture(t);
  await writeFile(join(builds, "archive"), "not a directory");
  let started = false;
  await assert.rejects(
    release({
      root,
      keys: ["windows-x86_64"],
      builder: async () => {
        started = true;
      },
    }),
    /Could not archive previous build/,
  );
  assert.equal(started, false);
  assert.equal(
    await readFile(join(builds, "current/previous.bin"), "utf8"),
    "known good release",
  );
});

test("a corrupted archive copy is never marked verified and preserves the source", async (t) => {
  const { builds } = await fixture(t);
  const current = join(builds, "current");
  await assert.rejects(
    archiveTree(current, builds, "current", new Date(), {
      copyTree: async (source, destination, options) => {
        await cp(source, destination, options);
        await writeFile(join(destination, "previous.bin"), "corrupted copy");
      },
    }),
    /Archive verification failed/,
  );
  assert.equal(
    await readFile(join(current, "previous.bin"), "utf8"),
    "known good release",
  );
  const [archive] = await readdir(join(builds, "archive"));
  await assert.rejects(
    readFile(join(builds, "archive", archive, "archive-metadata.json")),
    { code: "ENOENT" },
  );
});

test("build failure retains previous current, verified archive, and useful logs", async (t) => {
  const { root, builds } = await fixture(t);
  await assert.rejects(
    release({
      root,
      keys: ["windows-x86_64"],
      builder: async () => {
        throw new Error("bundler missing");
      },
    }),
    /windows-x86_64 build failed.*bundler missing/s,
  );
  assert.equal(
    await readFile(join(builds, "current/previous.bin"), "utf8"),
    "known good release",
  );
  assert.equal((await readdir(join(builds, "archive"))).length, 1);
  const logs = await readdir(join(builds, "logs"));
  assert.match(
    await readFile(join(builds, "logs", logs[0]), "utf8"),
    /FAILED:.*bundler missing/s,
  );
});

test("a later target failure never promotes the successful first target", async (t) => {
  const { root, builds } = await fixture(t);
  await assert.rejects(
    release({
      root,
      keys: ["windows-x86_64", "linux-x86_64"],
      builder: async (args) => {
        if (args.key === "linux-x86_64")
          throw new Error("Linux packaging failed");
        return windowsBuilder(args);
      },
    }),
    /linux-x86_64 build failed/,
  );
  assert.equal(
    await readFile(join(builds, "current/previous.bin"), "utf8"),
    "known good release",
  );
  const [staging] = await readdir(join(builds, "staging"));
  assert.equal(
    (await readdir(join(builds, "staging", staging, "windows/x86_64"))).length,
    4,
  );
});

test("a version change during compilation aborts before promotion", async (t) => {
  const { root, builds } = await fixture(t);
  await assert.rejects(
    release({
      root,
      keys: ["windows-x86_64"],
      builder: async (args) => {
        const built = await windowsBuilder(args);
        await syncVersions(root, "0.2.0");
        return built;
      },
    }),
    /version or Git commit changed/,
  );
  assert.equal(
    await readFile(join(builds, "current/previous.bin"), "utf8"),
    "known good release",
  );
});

test("successful release promotes a complete checksummed set using actual version and commit", async (t) => {
  const { root, builds } = await fixture(t);
  // Legacy bundles also survive; target contains non-directories in real Cargo builds.
  await mkdir(join(root, "target/release/bundle/macos"), { recursive: true });
  await writeFile(join(root, "target/.rustc_info.json"), "{}");
  await writeFile(join(root, "target/release/bundle/macos/old.dmg"), "legacy");
  const result = await release({
    root,
    keys: ["windows-x86_64"],
    builder: windowsBuilder,
  });
  assert.equal(result.version, await checkVersions(root));
  assert.equal(result.gitCommit, gitMetadata(root).gitCommit);
  assert.equal(result.artifacts.length, 4);
  assert.equal((await readdir(join(builds, "archive"))).length, 2);
  assert.equal(
    await readFile(join(root, "target/release/bundle/macos/old.dmg"), "utf8"),
    "legacy",
  );
  assert.deepEqual(
    JSON.parse(await readFile(join(builds, "release-manifest.json"))),
    result,
  );
  assert.equal(
    (await readFile(join(builds, "current/SHA256SUMS"), "utf8"))
      .trim()
      .split("\n").length,
    4,
  );
});

test("failure during directory swap or index write rolls back current and index", async (t) => {
  for (const failAt of ["rename", "index"]) {
    const { builds } = await fixture(t);
    const staged = join(builds, "staged");
    await mkdir(staged);
    await writeFile(join(staged, "new.bin"), "new release");
    await writeFile(join(builds, "release-manifest.json"), "old index");
    const { rename } = await import("node:fs/promises");
    let count = 0;
    await assert.rejects(
      promote(
        builds,
        staged,
        {},
        {
          renameDirectory: async (...args) => {
            if (failAt === "rename" && ++count === 2)
              throw new Error("swap failed");
            await rename(...args);
          },
          writeJson:
            failAt === "index"
              ? async () => {
                  throw new Error("index failed");
                }
              : atomicJson,
        },
      ),
      /failed/,
    );
    assert.equal(
      await readFile(join(builds, "current/previous.bin"), "utf8"),
      "known good release",
    );
    assert.equal(
      await readFile(join(builds, "release-manifest.json"), "utf8"),
      "old index",
    );
  }
});

test("interrupted promotion recovers old build and never discards the interrupted build", async (t) => {
  const { builds } = await fixture(t);
  const { rename } = await import("node:fs/promises");
  await rename(join(builds, "current"), join(builds, ".previous-abc123"));
  await mkdir(join(builds, "current"));
  await writeFile(join(builds, "current/new.bin"), "interrupted");
  await atomicJson(join(builds, ".promotion.json"), {
    previous: ".previous-abc123",
    hadCurrent: true,
  });
  await recoverPromotion(builds);
  assert.equal(
    await readFile(join(builds, "current/previous.bin"), "utf8"),
    "known good release",
  );
  assert.equal(
    (await readdir(builds)).filter((name) => name.startsWith(".interrupted-"))
      .length,
    1,
  );
});

test("concurrent release and recovery of live lock are rejected", async (t) => {
  const { builds } = await fixture(t);
  const unlock = await acquireLock(builds);
  await assert.rejects(acquireLock(builds), /Another release/);
  await assert.rejects(recoverLock(builds), /still running/);
  await unlock();
  await mkdir(join(builds, ".release-lock"));
  await atomicJson(join(builds, ".release-lock/owner.json"), {
    pid: 2147483647,
    host: hostname(),
  });
  await recoverLock(builds);
});

test("foreign hosts and unsupported architectures return actionable errors", () => {
  assert.throws(
    () => selectTargets("macos", "arm64", "win32", "x64"),
    /requires a macos build host/,
  );
  assert.throws(
    () => selectTargets("windows", "x86_64", "darwin", "arm64"),
    /GitHub Actions/,
  );
  assert.throws(
    () => selectTargets("linux", "x86_64", "linux", "arm64"),
    /x86-64 host/,
  );
  assert.throws(
    () => selectTargets("linux", "arm64", "linux", "arm64"),
    /Unsupported target/,
  );
  assert.deepEqual(selectTargets("macos", "all", "darwin", "arm64"), [
    "macos-arm64",
    "macos-x86_64",
    "macos-universal",
  ]);
});

test("binary inspection rejects wrong OS, wrong architecture, and incomplete Universal 2", () => {
  for (const [key, target] of Object.entries(targets)) {
    assert.equal(
      verifyExecutable(executable(target.platform, target.arch), target)
        .platform,
      target.platform,
      key,
    );
  }
  assert.throws(
    () =>
      verifyExecutable(executable("macos", "x86_64"), targets["macos-arm64"]),
    /Wrong executable/,
  );
  assert.throws(
    () => verifyExecutable(executable("linux"), targets["windows-x86_64"]),
    /Wrong executable/,
  );
  assert.throws(
    () =>
      verifyExecutable(
        executable("macos", "arm64"),
        targets["macos-universal"],
      ),
    /Wrong executable/,
  );
  assert.throws(
    () => verifyExecutable(Buffer.from("fake.exe"), targets["windows-x86_64"]),
    /truncated/,
  );
});

test("version mismatches block builds; synchronization updates both lockfiles and crates", async (t) => {
  const { root } = await fixture(t);
  const json = JSON.parse(await readFile(join(root, "package.json")));
  json.version = "0.0.1";
  await writeFile(join(root, "package.json"), JSON.stringify(json));
  await assert.rejects(checkVersions(root), /Version mismatch/);
  await syncVersions(root, "0.2.3");
  assert.equal(await checkVersions(root), "0.2.3");
});

test("CI assembly rejects incomplete matrix; imported artifacts must match hashes and source commit", async (t) => {
  const { root, builds } = await fixture(t);
  const incoming = join(builds, "incoming/target-windows-x86_64");
  const version = await checkVersions(root);
  const result = await windowsBuilder({
    staged: incoming,
    version,
    key: "windows-x86_64",
  });
  const manifest = {
    schemaVersion: 1,
    product: "Save Scum",
    version,
    gitCommit: gitMetadata(root).gitCommit,
    targets: ["windows-x86_64"],
    artifacts: result.artifacts,
    binaries: [result.binary],
  };
  await writeManifest(incoming, manifest);
  await assert.rejects(
    release({
      root,
      keys: ["windows-x86_64", "linux-x86_64"],
      imports: join(builds, "incoming"),
    }),
    /Incomplete CI build/,
  );
  assert.equal(
    await readFile(join(builds, "current/previous.bin"), "utf8"),
    "known good release",
  );
  await assert.rejects(
    verifyManifest(incoming, { version, commit: "wrong" }),
    /commit mismatch/,
  );
  await writeFile(
    join(
      incoming,
      result.artifacts.find((artifact) => artifact.extension === ".msi").file,
    ),
    Buffer.from("d0cf11e0a1b11ae19999", "hex"),
  );
  await assert.rejects(
    verifyManifest(incoming, { version, commit: manifest.gitCommit }),
    /checksum\/size mismatch/,
  );
});

test("zero-byte, mislabeled packaging, and unsafe manifest paths are rejected", async (t) => {
  const { root, builds } = await fixture(t);
  const path = join(builds, "bad.msi");
  await writeFile(path, "");
  await assert.rejects(
    validateArtifact(path, targets["windows-x86_64"], ".msi"),
    /empty/,
  );
  await writeFile(path, "a renamed binary");
  await assert.rejects(
    validateArtifact(path, targets["windows-x86_64"], ".msi"),
    /Invalid/,
  );
  const version = await checkVersions(root);
  const incoming = join(builds, "incoming");
  const result = await windowsBuilder({
    staged: incoming,
    version,
    key: "windows-x86_64",
  });
  result.artifacts[0].file = "../outside.msi";
  await writeManifest(incoming, {
    schemaVersion: 1,
    product: "Save Scum",
    version,
    gitCommit: "commit",
    targets: ["windows-x86_64"],
    artifacts: result.artifacts,
    binaries: [result.binary],
  });
  await assert.rejects(
    verifyManifest(incoming, { version, commit: "commit" }),
    /unsafe artifact path/,
  );
});

test("full CI assembly verifies all five targets including executable members of archives", async (t) => {
  const { root, builds } = await fixture(t);
  const version = await checkVersions(root);
  const commit = gitMetadata(root).gitCommit;
  const incoming = join(builds, "incoming");
  for (const key of allTargets) {
    const directory = join(incoming, `target-${key}`);
    const target = targets[key];
    let result;
    if (target.platform === "windows")
      result = await windowsBuilder({ staged: directory, version, key });
    else {
      const data = executable(target.platform, target.arch);
      const member =
        target.platform === "macos"
          ? "Save Scum.app/Contents/MacOS/save-scum"
          : "save-scum";
      const source = join(builds, "test-package", key);
      await mkdir(join(source, member, ".."), { recursive: true });
      await writeFile(join(source, member), data);
      await mkdir(join(directory, target.platform, target.arch), {
        recursive: true,
      });
      const artifacts = [];
      for (const extension of target.extensions) {
        const file = `${target.platform}/${target.arch}/${artifactName(version, target, extension)}`;
        const destination = join(directory, file);
        if (extension.endsWith(".tar.gz"))
          execFileSync("tar", [
            "-czf",
            destination,
            "-C",
            source,
            target.platform === "macos" ? "Save Scum.app" : "save-scum",
          ]);
        else {
          const bytes =
            extension === ".dmg"
              ? Buffer.alloc(512)
              : extension === ".deb"
                ? Buffer.from("!<arch>\n")
                : extension === ".rpm"
                  ? Buffer.from("edabeedb0000", "hex")
                  : data;
          if (extension === ".dmg") bytes.write("koly");
          await writeFile(destination, bytes);
        }
        artifacts.push({
          platform: target.platform,
          arch: target.arch,
          extension,
          file,
          ...(await validateArtifact(destination, target, extension)),
        });
      }
      result = {
        artifacts,
        binary: {
          target: key,
          platform: target.platform,
          architectures:
            target.arch === "universal" ? ["arm64", "x86_64"] : [target.arch],
          sha256: createHash("sha256").update(data).digest("hex"),
          archiveMember: member,
        },
      };
    }
    await writeManifest(directory, {
      schemaVersion: 1,
      product: "Save Scum",
      version,
      gitCommit: commit,
      targets: [key],
      artifacts: result.artifacts,
      binaries: [result.binary],
    });
  }
  const result = await release({ root, keys: allTargets, imports: incoming });
  assert.equal(result.scope, "full-ci");
  assert.equal(result.artifacts.length, 14);
  assert.deepEqual(result.targets, allTargets);
  assert.equal((await readdir(join(builds, "archive"))).length, 1);
});
