import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const projectRoot = fileURLToPath(new URL("../", import.meta.url));
const semver =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
const cargoFiles = ["src-tauri/Cargo.toml", "crates/save-scum-core/Cargo.toml"];
const crateNames = ["save-scum", "save-scum-core"];

export async function versionFiles(root = projectRoot) {
  const files = new Map();
  for (const name of [
    "src-tauri/tauri.conf.json",
    "package.json",
    "package-lock.json",
    ...cargoFiles,
    "Cargo.lock",
  ])
    files.set(name, await readFile(resolve(root, name), "utf8"));
  return files;
}

export async function checkVersions(root = projectRoot) {
  const files = await versionFiles(root);
  const version = JSON.parse(files.get("src-tauri/tauri.conf.json")).version;
  if (!semver.test(version))
    throw new Error(
      "Tauri's canonical version must be an explicit semantic version.",
    );
  const versions = [
    ["package.json", JSON.parse(files.get("package.json")).version],
    ["package-lock.json", JSON.parse(files.get("package-lock.json")).version],
    [
      "package-lock.json packages['']",
      JSON.parse(files.get("package-lock.json")).packages[""].version,
    ],
    ...cargoFiles.map((name) => [
      name,
      files.get(name).match(/^version\s*=\s*"([^"]+)"/m)?.[1],
    ]),
    ...crateNames.map((name) => [
      `Cargo.lock ${name}`,
      files
        .get("Cargo.lock")
        .split("[[package]]")
        .find((block) => block.includes(`\nname = "${name}"\n`))
        ?.match(/^version = "([^"]+)"/m)?.[1],
    ]),
  ];
  const mismatches = versions.filter(([, value]) => value !== version);
  if (mismatches.length)
    throw new Error(
      `Version mismatch: Tauri=${version}; ${mismatches.map(([name, value]) => `${name}=${value}`).join("; ")}. Run npm run version:sync.`,
    );
  return version;
}

export async function syncVersions(root = projectRoot, requested) {
  const files = await versionFiles(root);
  const version =
    requested ?? JSON.parse(files.get("src-tauri/tauri.conf.json")).version;
  if (!semver.test(version))
    throw new Error("Supply a semantic version, for example 0.2.0.");
  const updated = new Map(files);
  for (const name of [
    "src-tauri/tauri.conf.json",
    "package.json",
    "package-lock.json",
  ]) {
    const data = JSON.parse(files.get(name));
    data.version = version;
    if (name === "package-lock.json") data.packages[""].version = version;
    updated.set(name, `${JSON.stringify(data, null, 2)}\n`);
  }
  for (const name of cargoFiles)
    updated.set(
      name,
      files
        .get(name)
        .replace(/^version\s*=\s*"[^"]+"/m, `version = "${version}"`),
    );
  updated.set(
    "Cargo.lock",
    files
      .get("Cargo.lock")
      .split("[[package]]")
      .map((block) =>
        crateNames.some((name) => block.includes(`\nname = "${name}"\n`))
          ? block.replace(/^version = "[^"]+"/m, `version = "${version}"`)
          : block,
      )
      .join("[[package]]"),
  );
  try {
    for (const [name, content] of updated)
      await writeFile(resolve(root, name), content);
    await checkVersions(root);
  } catch (error) {
    for (const [name, content] of files)
      await writeFile(resolve(root, name), content);
    throw error;
  }
  return version;
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    if (
      !["check", "sync"].includes(process.argv[2]) ||
      process.argv.length > (process.argv[2] === "sync" ? 4 : 3)
    )
      throw new Error("Usage: node scripts/version.mjs check | sync [version]");
    const version =
      process.argv[2] === "sync"
        ? await syncVersions(projectRoot, process.argv[3])
        : await checkVersions();
    console.log(`Save Scum version: ${version}`);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
