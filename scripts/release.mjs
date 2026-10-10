import { randomUUID } from "node:crypto";
import { cp, mkdir, open, readFile, readdir, rm } from "node:fs/promises";
import { join, resolve, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { execFileSync } from "node:child_process";
import { checkVersions, projectRoot } from "./version.mjs";
import {
  acquireLock,
  archiveTree,
  atomicJson,
  exists,
  promote,
  recoverLock,
  recoverPromotion,
} from "./release-store.mjs";
import {
  allTargets,
  buildTarget,
  command,
  selectTargets,
  verifyManifest,
  writeManifest,
} from "./release-artifacts.mjs";

export function gitMetadata(root) {
  const git = (...args) =>
    execFileSync("git", ["-C", root, ...args], { encoding: "utf8" }).trim();
  return {
    gitCommit: git("rev-parse", "HEAD"),
    gitDirty: Boolean(git("status", "--porcelain")),
  };
}

async function archiveExisting(root, builds) {
  const archives = [];
  const current = await archiveTree(join(builds, "current"), builds);
  if (current) archives.push(current);
  // Keep pre-pipeline Tauri bundles too. Release builds never write over these paths.
  const legacyRoots = [join(root, "target"), join(root, "src-tauri/target")];
  for (const base of legacyRoots) {
    if (!(await exists(base))) continue;
    for (const target of [
      "",
      ...(await readdir(base, { withFileTypes: true }))
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name),
    ]) {
      const folder = join(base, target, "release/bundle");
      if (!(await exists(folder))) continue;
      const archived = await archiveTree(
        folder,
        builds,
        `legacy-${target || "native"}`,
      );
      if (archived) archives.push(archived);
    }
  }
  return archives;
}

export async function release({
  root = projectRoot,
  keys,
  imports,
  archiveOnly = false,
  builder = buildTarget,
  promotion = promote,
}) {
  const builds = join(root, "builds");
  const unlock = await acquireLock(builds);
  let log, logPath;
  try {
    await recoverPromotion(builds);
    const version = await checkVersions(root);
    const git = gitMetadata(root);
    const id = `${new Date().toISOString().replace(/[:.]/g, "-")}-${randomUUID().slice(0, 8)}`;
    await mkdir(join(builds, "logs"), { recursive: true });
    logPath = join(builds, "logs", `${id}.log`);
    log = await open(logPath, "wx");
    let archives;
    try {
      archives = await archiveExisting(root, builds);
    } catch (error) {
      throw new Error(
        `Could not archive previous build. Release aborted; existing builds have NOT been modified. ${error.message}`,
      );
    }
    console.log(
      archives.length
        ? `Verified archives:\n${archives.join("\n")}`
        : "No previous build artifacts to archive.",
    );
    await log.write(`Verified archives: ${JSON.stringify(archives)}\n`);
    if (archiveOnly) {
      await atomicJson(join(builds, "archive-state.json"), {
        archivedAt: new Date().toISOString(),
        archives: archives.map((path) => relative(builds, path)),
      });
      return { archives };
    }
    const staged = join(builds, "staging", id);
    const work = join(builds, "work", id);
    await mkdir(staged, { recursive: true });
    await mkdir(work, { recursive: true });
    const artifacts = [],
      binaries = [];
    if (imports) {
      const importedTargets = new Set();
      for (const name of (await readdir(imports)).sort()) {
        const directory = join(imports, name);
        const manifest = await verifyManifest(directory, {
          version,
          commit: git.gitCommit,
        });
        for (const key of manifest.targets) {
          if (!keys.includes(key) || importedTargets.has(key))
            throw new Error(`Unexpected/duplicate imported target: ${key}`);
          importedTargets.add(key);
        }
        for (const artifact of manifest.artifacts) {
          const dest = join(staged, artifact.file);
          await mkdir(join(dest, ".."), { recursive: true });
          await cp(join(directory, artifact.file), dest, {
            force: false,
            errorOnExist: true,
          });
          artifacts.push(artifact);
        }
        binaries.push(...manifest.binaries);
      }
      if ([...importedTargets].sort().join() !== [...keys].sort().join())
        throw new Error(
          `Incomplete CI build: expected ${keys.join(", ")}; received ${[...importedTargets].join(", ")}.`,
        );
    } else {
      for (const key of keys) {
        try {
          const built = await builder({
            root,
            work,
            staged,
            version,
            key,
            log,
          });
          artifacts.push(...built.artifacts);
          binaries.push(built.binary);
        } catch (error) {
          throw new Error(`${key} build failed. Reason: ${error.message}`);
        }
      }
    }
    if (
      (await checkVersions(root)) !== version ||
      gitMetadata(root).gitCommit !== git.gitCommit
    )
      throw new Error(
        "Application version or Git commit changed during the build. Release aborted before promotion.",
      );
    const manifest = {
      schemaVersion: 1,
      product: "Save Scum",
      version,
      builtAt: new Date().toISOString(),
      ...git,
      scope: imports ? "full-ci" : "local",
      targets: keys,
      signing:
        "Development artifacts: unsigned or ad-hoc signed; not notarized",
      artifacts,
      binaries,
    };
    await writeManifest(staged, manifest);
    await verifyManifest(staged, {
      version,
      commit: git.gitCommit,
      required: keys,
    });
    await promotion(builds, staged, manifest);
    console.log(
      `\nSAVE SCUM RELEASE\nVersion: v${version}\nCommit: ${git.gitCommit}${git.gitDirty ? " (uncommitted changes)" : ""}\nBuilt: ${manifest.builtAt}\n${keys.map((key) => `✓ ${key}`).join("\n")}\nArtifacts: ${artifacts.length}\nSigning: ${manifest.signing}\nPrevious builds archived: ${archives.length}\nCurrent: ${join(builds, "current")}\nLog: ${logPath}`,
    );
    await log
      .write(`SUCCESS ${JSON.stringify(manifest)}\n`)
      .catch((error) =>
        console.warn(
          `Release committed, but final log write failed: ${error.message}`,
        ),
      );
    await rm(work, { recursive: true, force: true }).catch((error) =>
      console.warn(`Build workspace retained: ${error.message}`),
    );
    return manifest;
  } catch (error) {
    if (log) await log.write(`FAILED: ${error.stack}\n`);
    throw new Error(
      `${error.message}\nPrevious archives remain intact. Failed staging/work directories are retained.${logPath ? `\nLog: ${logPath}` : ""}`,
      { cause: error },
    );
  } finally {
    if (log) await log.close();
    await unlock();
  }
}

async function main() {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      platform: { type: "string" },
      arch: { type: "string" },
      from: { type: "string" },
      ref: { type: "string" },
    },
  });
  const mode = positionals[0] ?? "local";
  if (positionals.length > 1) throw new Error("Unexpected release arguments.");
  if (mode === "recover") {
    await recoverLock(join(projectRoot, "builds"));
    const unlock = await acquireLock(join(projectRoot, "builds"));
    try {
      await recoverPromotion(join(projectRoot, "builds"));
    } finally {
      await unlock();
    }
    console.log(
      "Interrupted promotion recovered. Existing archives and failed staging retained.",
    );
  } else if (mode === "dispatch") {
    await checkVersions();
    const ref =
      values.ref ??
      execFileSync("git", ["branch", "--show-current"], {
        cwd: projectRoot,
        encoding: "utf8",
      }).trim();
    if (!ref)
      throw new Error(
        "Detached HEAD: use npm run release:ci -- --ref <pushed-branch-or-tag>.",
      );
    if (gitMetadata(projectRoot).gitDirty)
      throw new Error(
        "Commit and push your changes before dispatching CI; CI builds the pushed ref.",
      );
    await command(
      "gh",
      ["workflow", "run", "build-release.yml", "--ref", ref],
      { cwd: projectRoot },
    );
    console.log(
      `Full release workflow requested for ${ref}. Follow it with gh run list --workflow build-release.yml. Nothing is published automatically.`,
    );
  } else if (mode === "archive") await release({ archiveOnly: true });
  else if (mode === "assemble") {
    if (!values.from)
      throw new Error(
        "assemble requires --from <downloaded-target-artifacts-directory>.",
      );
    await release({ imports: resolve(values.from), keys: allTargets });
  } else if (mode === "local")
    await release({ keys: selectTargets(values.platform, values.arch) });
  else throw new Error(`Unknown release command: ${mode}`);
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main().catch((error) => {
    console.error(`✗ ${error.message}`);
    process.exitCode = 1;
  });
}
