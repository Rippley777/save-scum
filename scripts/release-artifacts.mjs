import {
  open,
  lstat,
  mkdir,
  copyFile,
  readFile,
  readdir,
  writeFile,
} from "node:fs/promises";
import { join, basename } from "node:path";
import { spawn } from "node:child_process";
import { atomicJson, sha256 } from "./release-store.mjs";

export const targets = {
  "windows-x86_64": {
    platform: "windows",
    arch: "x86_64",
    host: "win32",
    triple: "x86_64-pc-windows-msvc",
    bundles: "msi,nsis",
    extensions: [".msi", "-setup.exe", ".exe", ".zip"],
  },
  "linux-x86_64": {
    platform: "linux",
    arch: "x86_64",
    host: "linux",
    triple: "x86_64-unknown-linux-gnu",
    bundles: "appimage,deb,rpm",
    extensions: [".AppImage", ".deb", ".rpm", ".tar.gz"],
  },
  "macos-arm64": {
    platform: "macos",
    arch: "arm64",
    host: "darwin",
    triple: "aarch64-apple-darwin",
    bundles: "app,dmg",
    extensions: [".dmg", ".app.tar.gz"],
  },
  "macos-x86_64": {
    platform: "macos",
    arch: "x86_64",
    host: "darwin",
    triple: "x86_64-apple-darwin",
    bundles: "app,dmg",
    extensions: [".dmg", ".app.tar.gz"],
  },
  "macos-universal": {
    platform: "macos",
    arch: "universal",
    host: "darwin",
    triple: "universal-apple-darwin",
    bundles: "app,dmg",
    extensions: [".dmg", ".app.tar.gz"],
  },
};
export const allTargets = Object.keys(targets);
export const artifactName = (version, target, extension) =>
  `SaveScum-v${version}-${target.platform}-${target.arch}${extension}`;

export function selectTargets(
  platform,
  arch,
  host = process.platform,
  hostArch = process.arch,
) {
  const selectedPlatform =
    platform ?? { darwin: "macos", win32: "windows", linux: "linux" }[host];
  const selectedArch = arch ?? { arm64: "arm64", x64: "x86_64" }[hostArch];
  const keys =
    selectedPlatform === "macos" && selectedArch === "all"
      ? allTargets.filter((key) => key.startsWith("macos-"))
      : [`${selectedPlatform}-${selectedArch}`];
  for (const key of keys) {
    const target = targets[key];
    if (!target)
      throw new Error(
        `Unsupported target ${key}. Supported targets: ${allTargets.join(", ")}.`,
      );
    if (host !== target.host)
      throw new Error(
        `${target.platform} installer generation requires a ${target.platform} build host. Run this command there or use npm run release:ci (GitHub Actions).`,
      );
    if (selectedPlatform !== "macos" && hostArch !== "x64")
      throw new Error(
        `${key} requires an x86-64 host. Use GitHub Actions for this target.`,
      );
  }
  return keys;
}

export async function command(
  program,
  args,
  { cwd, env = process.env, log, capture = false } = {},
) {
  if (log) await log.write(`\n> ${program} ${args.join(" ")}\n`);
  return new Promise((resolve, reject) => {
    const child = spawn(program, args, {
      cwd,
      env,
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const chunks = [];
    let size = 0;
    child.stdout.on("data", (chunk) => {
      if (capture) {
        size += chunk.length;
        if (size > 256 * 1024 * 1024) child.kill();
        else chunks.push(chunk);
      } else {
        process.stdout.write(chunk);
        if (log) log.write(chunk);
      }
    });
    child.stderr.on("data", (chunk) => {
      process.stderr.write(chunk);
      if (log) log.write(chunk);
    });
    child.on("error", (error) =>
      reject(
        new Error(
          `Could not run ${program}: ${error.message}. Install the platform prerequisites listed in docs/BUILDING.md.`,
        ),
      ),
    );
    child.on("close", (code, signal) =>
      code === 0
        ? resolve(Buffer.concat(chunks))
        : reject(
            new Error(
              `${program} exited ${code ?? signal}. See the release log for details.`,
            ),
          ),
    );
  });
}

export function executableArchitectures(data) {
  if (data.length < 64) throw new Error("Executable is truncated.");
  if (data.subarray(0, 4).equals(Buffer.from([0x7f, 0x45, 0x4c, 0x46]))) {
    if (data[4] !== 2 || data[5] !== 1 || data.readUInt16LE(18) !== 62)
      throw new Error("Expected little-endian Linux ELF64 x86-64 executable.");
    return { platform: "linux", architectures: ["x86_64"] };
  }
  if (data.subarray(0, 2).toString() === "MZ") {
    const offset = data.readUInt32LE(60);
    if (
      offset + 26 > data.length ||
      data.subarray(offset, offset + 4).toString("binary") !== "PE\0\0" ||
      data.readUInt16LE(offset + 24) !== 0x20b
    )
      throw new Error("Expected Windows PE32+ executable.");
    if (data.readUInt16LE(offset + 4) !== 0x8664)
      throw new Error("Expected Windows x86-64 executable.");
    return { platform: "windows", architectures: ["x86_64"] };
  }
  const cpu = (id) => ({ 0x1000007: "x86_64", 0x100000c: "arm64" })[id];
  if (data.readUInt32LE(0) === 0xfeedfacf) {
    const arch = cpu(data.readUInt32LE(4));
    if (!arch) throw new Error("Unsupported Mach-O architecture.");
    return { platform: "macos", architectures: [arch] };
  }
  const magic = data.readUInt32BE(0);
  if (magic === 0xcafebabe || magic === 0xcafebabf) {
    const count = data.readUInt32BE(4);
    const stride = magic === 0xcafebabf ? 32 : 20;
    if (count !== 2 || 8 + count * stride > data.length)
      throw new Error("Expected two Universal 2 slices.");
    const architectures = Array.from({ length: count }, (_, i) =>
      cpu(data.readUInt32BE(8 + i * stride)),
    ).sort();
    if (architectures.join(",") !== "arm64,x86_64")
      throw new Error("Universal 2 must contain ARM64 and Intel slices.");
    return { platform: "macos", architectures };
  }
  throw new Error("Unrecognized executable format.");
}

export function verifyExecutable(data, target) {
  const actual = executableArchitectures(data);
  const expected =
    target.arch === "universal" ? ["arm64", "x86_64"] : [target.arch];
  if (
    actual.platform !== target.platform ||
    actual.architectures.join(",") !== expected.join(",")
  )
    throw new Error(
      `Wrong executable platform/architecture: expected ${target.platform} ${target.arch}, got ${actual.platform} ${actual.architectures.join(",")}.`,
    );
  return actual;
}

async function header(path, length = 4096) {
  const file = await open(path, "r");
  try {
    const buffer = Buffer.alloc(length);
    const { bytesRead } = await file.read(buffer, 0, length, 0);
    return buffer.subarray(0, bytesRead);
  } finally {
    await file.close();
  }
}

export async function validateArtifact(path, target, extension) {
  const stat = await lstat(path);
  if (!stat.isFile() || stat.size === 0)
    throw new Error(`Missing, empty, or non-file artifact: ${path}`);
  const bytes = await header(path);
  let valid = false;
  if (extension === ".exe" || extension === ".AppImage") {
    verifyExecutable(bytes, target);
    valid = true;
  } else if (extension === "-setup.exe")
    valid = bytes.subarray(0, 2).toString() === "MZ";
  else if (extension === ".msi")
    valid = bytes.subarray(0, 8).toString("hex") === "d0cf11e0a1b11ae1";
  else if (extension === ".deb")
    valid = bytes.subarray(0, 8).toString() === "!<arch>\n";
  else if (extension === ".rpm")
    valid = bytes.subarray(0, 4).toString("hex") === "edabeedb";
  else if (extension === ".zip")
    valid = bytes.subarray(0, 4).toString("hex") === "504b0304";
  else if (extension.endsWith(".tar.gz"))
    valid = bytes.subarray(0, 2).toString("hex") === "1f8b";
  else if (extension === ".dmg" && stat.size >= 512) {
    const file = await open(path, "r");
    try {
      const trailer = Buffer.alloc(4);
      await file.read(trailer, 0, 4, stat.size - 512);
      valid = trailer.toString() === "koly";
    } finally {
      await file.close();
    }
  }
  if (!valid) throw new Error(`Invalid ${extension} packaging format: ${path}`);
  return { size: stat.size, sha256: await sha256(path) };
}

async function oneBundle(dir, extension) {
  const names = (await readdir(dir)).filter((name) => name.endsWith(extension));
  if (names.length !== 1)
    throw new Error(
      `Expected exactly one fresh ${extension} in ${dir}; found ${names.length}.`,
    );
  return join(dir, names[0]);
}

export async function buildTarget({ root, work, staged, version, key, log }) {
  const target = targets[key];
  console.log(
    `\nBuilding ${target.platform} ${target.arch} (${target.triple}) — unsigned development distribution`,
  );
  const cli = join(root, "node_modules/@tauri-apps/cli/tauri.js");
  const rustTargets =
    target.arch === "universal"
      ? ["aarch64-apple-darwin", "x86_64-apple-darwin"]
      : [target.triple];
  await command("rustup", ["target", "add", ...rustTargets], {
    cwd: root,
    log,
  });
  const cargoTarget = join(work, "target");
  const env = { ...process.env, CARGO_TARGET_DIR: cargoTarget, CI: "true" };
  // Ad-hoc signing permits ARM64 execution without a certificate. It is not Developer ID signing.
  const config = {
    bundle: {
      ...(target.platform === "macos"
        ? { macOS: { signingIdentity: "-" } }
        : {}),
    },
  };
  for (const name of [
    "APPLE_SIGNING_IDENTITY",
    "APPLE_CERTIFICATE",
    "APPLE_CERTIFICATE_PASSWORD",
    "APPLE_ID",
    "APPLE_PASSWORD",
    "APPLE_TEAM_ID",
    "APPLE_API_ISSUER",
    "APPLE_API_KEY",
    "APPLE_API_KEY_PATH",
    "TAURI_SIGNING_PRIVATE_KEY",
    "TAURI_SIGNING_PRIVATE_KEY_PASSWORD",
  ])
    delete env[name];
  if (target.platform === "linux") env.APPIMAGE_EXTRACT_AND_RUN = "1";
  await command(
    process.execPath,
    [
      cli,
      "build",
      "--verbose",
      "--ci",
      "--target",
      target.triple,
      "--bundles",
      target.bundles,
      "--config",
      JSON.stringify(config),
      "--",
      "--locked",
    ],
    { cwd: root, env, log },
  );
  const output = join(cargoTarget, target.triple, "release");
  const bundle = join(output, "bundle");
  const destination = join(staged, target.platform, target.arch);
  await mkdir(destination, { recursive: true });
  const app = join(bundle, "macos", "Save Scum.app");
  const executable =
    target.platform === "macos"
      ? join(app, "Contents/MacOS/save-scum")
      : join(
          output,
          target.platform === "windows" ? "save-scum.exe" : "save-scum",
        );
  const architecture = verifyExecutable(await header(executable), target);
  const binaryHash = await sha256(executable);
  const dest = (extension) =>
    join(destination, artifactName(version, target, extension));
  if (target.platform === "windows") {
    await copyFile(await oneBundle(join(bundle, "msi"), ".msi"), dest(".msi"));
    await copyFile(
      await oneBundle(join(bundle, "nsis"), ".exe"),
      dest("-setup.exe"),
    );
    await copyFile(executable, dest(".exe"));
    // Windows runners ship bsdtar, which creates real ZIP archives.
    await command(
      "tar",
      ["-a", "-cf", dest(".zip"), "-C", output, "save-scum.exe"],
      { log },
    );
  } else if (target.platform === "linux") {
    for (const [folder, extension] of [
      ["appimage", ".AppImage"],
      ["deb", ".deb"],
      ["rpm", ".rpm"],
    ])
      await copyFile(
        await oneBundle(join(bundle, folder), extension),
        dest(extension),
      );
    const debArch = (
      await command("dpkg-deb", ["-f", dest(".deb"), "Architecture"], {
        log,
        capture: true,
      })
    )
      .toString()
      .trim();
    if (debArch !== "amd64")
      throw new Error(`Expected Debian amd64; found ${debArch}.`);
    await command("tar", ["-czf", dest(".tar.gz"), "-C", output, "save-scum"], {
      log,
    });
  } else {
    const plistVersion = (
      await command(
        "/usr/libexec/PlistBuddy",
        [
          "-c",
          "Print :CFBundleShortVersionString",
          join(app, "Contents/Info.plist"),
        ],
        { log, capture: true },
      )
    )
      .toString()
      .trim();
    if (plistVersion !== version)
      throw new Error(
        `App bundle version ${plistVersion} does not match ${version}.`,
      );
    await copyFile(await oneBundle(join(bundle, "dmg"), ".dmg"), dest(".dmg"));
    await command("hdiutil", ["verify", dest(".dmg")], { log });
    await command(
      "tar",
      ["-czf", dest(".app.tar.gz"), "-C", join(bundle, "macos"), basename(app)],
      { log },
    );
  }
  const artifacts = [];
  for (const extension of target.extensions) {
    const path = dest(extension);
    artifacts.push({
      platform: target.platform,
      arch: target.arch,
      extension,
      file: `${target.platform}/${target.arch}/${basename(path)}`,
      ...(await validateArtifact(path, target, extension)),
      signing:
        target.platform === "macos" ? "ad-hoc; not notarized" : "unsigned",
    });
  }
  return {
    artifacts,
    binary: {
      target: key,
      ...architecture,
      sha256: binaryHash,
      archiveMember:
        target.platform === "macos"
          ? "Save Scum.app/Contents/MacOS/save-scum"
          : "save-scum",
    },
  };
}

export async function writeManifest(directory, manifest) {
  manifest.artifacts.sort((a, b) => a.file.localeCompare(b.file));
  await writeFile(
    join(directory, "SHA256SUMS"),
    manifest.artifacts
      .map((artifact) => `${artifact.sha256}  ${artifact.file}\n`)
      .join(""),
  );
  await atomicJson(join(directory, "manifest.json"), manifest);
}

export async function verifyManifest(
  directory,
  { version, commit, required } = {},
) {
  const manifest = JSON.parse(
    await readFile(join(directory, "manifest.json"), "utf8"),
  );
  if (
    manifest.schemaVersion !== 1 ||
    manifest.product !== "Save Scum" ||
    manifest.version !== version ||
    manifest.gitCommit !== commit ||
    !Array.isArray(manifest.targets) ||
    !Array.isArray(manifest.artifacts) ||
    !Array.isArray(manifest.binaries)
  )
    throw new Error(
      `Invalid release metadata or version/commit mismatch: ${directory}`,
    );
  if (
    required &&
    [...manifest.targets].sort().join() !== [...required].sort().join()
  )
    throw new Error(
      `Incomplete target set in ${directory}; expected ${required.join(", ")}.`,
    );
  const expectedFiles = new Set();
  for (const key of manifest.targets) {
    const target = targets[key];
    if (!target) throw new Error(`Unknown manifest target: ${key}`);
    for (const extension of target.extensions)
      expectedFiles.add(
        `${target.platform}/${target.arch}/${artifactName(version, target, extension)}`,
      );
  }
  if (
    new Set(manifest.targets).size !== manifest.targets.length ||
    manifest.artifacts.length !== expectedFiles.size
  )
    throw new Error("Duplicate targets or incorrect artifact count.");
  for (const artifact of manifest.artifacts) {
    if (!expectedFiles.delete(artifact.file))
      throw new Error(
        `Duplicate, unexpected, or unsafe artifact path: ${artifact.file}`,
      );
    const target = targets[`${artifact.platform}-${artifact.arch}`];
    if (
      !target ||
      !manifest.targets.includes(`${artifact.platform}-${artifact.arch}`) ||
      artifact.file !==
        `${target.platform}/${target.arch}/${artifactName(version, target, artifact.extension)}` ||
      !target.extensions.includes(artifact.extension)
    )
      throw new Error(`Artifact does not match target: ${artifact.file}`);
    const actual = await validateArtifact(
      join(directory, artifact.file),
      target,
      artifact.extension,
    );
    if (actual.size !== artifact.size || actual.sha256 !== artifact.sha256)
      throw new Error(`Artifact checksum/size mismatch: ${artifact.file}`);
  }
  if (expectedFiles.size)
    throw new Error(
      `Missing release artifacts: ${[...expectedFiles].join(", ")}`,
    );
  const checksums = await readFile(join(directory, "SHA256SUMS"), "utf8");
  if (
    checksums !==
    [...manifest.artifacts]
      .sort((a, b) => a.file.localeCompare(b.file))
      .map((artifact) => `${artifact.sha256}  ${artifact.file}\n`)
      .join("")
  )
    throw new Error(`SHA256SUMS mismatch: ${directory}`);
  if (manifest.binaries.length !== manifest.targets.length)
    throw new Error("Missing executable architecture evidence.");
  for (const key of manifest.targets) {
    const target = targets[key];
    const evidence = manifest.binaries.filter(
      (binary) => binary.target === key,
    );
    if (evidence.length !== 1)
      throw new Error(`Missing/duplicate architecture evidence for ${key}.`);
    const binary = evidence[0];
    let data;
    if (target.platform === "windows")
      data = await readFile(
        join(
          directory,
          target.platform,
          target.arch,
          artifactName(version, target, ".exe"),
        ),
      );
    else {
      const member =
        target.platform === "macos"
          ? "Save Scum.app/Contents/MacOS/save-scum"
          : "save-scum";
      if (binary.archiveMember !== member)
        throw new Error(`Incorrect executable archive member for ${key}.`);
      data = await command(
        "tar",
        [
          "-xOf",
          join(
            directory,
            target.platform,
            target.arch,
            artifactName(
              version,
              target,
              target.platform === "macos" ? ".app.tar.gz" : ".tar.gz",
            ),
          ),
          member,
        ],
        { capture: true },
      );
    }
    const actual = verifyExecutable(data, target);
    const { createHash } = await import("node:crypto");
    if (
      binary.sha256 !== createHash("sha256").update(data).digest("hex") ||
      binary.platform !== actual.platform ||
      binary.architectures.join() !== actual.architectures.join()
    )
      throw new Error(
        `Executable architecture/hash evidence mismatch for ${key}.`,
      );
  }
  return manifest;
}
