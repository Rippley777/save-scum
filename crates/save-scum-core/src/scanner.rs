use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};
use std::{
    collections::HashMap,
    path::{Path, PathBuf},
};
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Definition {
    pub name: String,
    pub steam_app_id: Option<String>,
    pub paths: HashMap<String, Vec<String>>,
    #[serde(default)]
    pub executables: Vec<String>,
}
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Discovered {
    pub name: String,
    pub steam_app_id: Option<String>,
    pub path: Option<String>,
    pub install_path: Option<String>,
    pub source: String,
}
pub fn definitions() -> Result<Vec<Definition>> {
    Ok(serde_json::from_str(include_str!(
        "../../../data/games.json"
    ))?)
}
pub fn load_definitions(extra: Option<&Path>) -> Result<Vec<Definition>> {
    let mut defs = definitions()?;
    if let Some(path) = extra {
        if path.exists() {
            defs.extend(serde_json::from_slice::<Vec<Definition>>(&std::fs::read(
                path,
            )?)?);
        }
    }
    Ok(defs)
}
pub fn discover(extra: Option<&Path>) -> Result<Vec<Discovered>> {
    let defs = load_definitions(extra)?;
    let platform = if cfg!(target_os = "windows") {
        "windows"
    } else if cfg!(target_os = "macos") {
        "macos"
    } else {
        "linux"
    };
    let user_dirs = directories::UserDirs::new()
        .context("Could not locate the current user's home directory")?;
    let home = user_dirs.home_dir().to_string_lossy().into_owned();
    let mut found = Vec::new();
    let mut seen = std::collections::HashSet::new();
    for def in defs {
        for pattern in def.paths.get(platform).into_iter().flatten() {
            let mut expanded = pattern.replace('~', &home);
            for variable in [
                "USERPROFILE",
                "LOCALAPPDATA",
                "APPDATA",
                "PROGRAMFILES(X86)",
            ] {
                if let Ok(value) = std::env::var(variable) {
                    expanded = expanded.replace(&format!("%{variable}%"), &value);
                }
            }
            for path in glob::glob(&expanded)?.flatten() {
                if path.is_dir() && seen.insert(path.canonicalize()?) {
                    found.push(Discovered {
                        name: def.name.clone(),
                        steam_app_id: def.steam_app_id.clone(),
                        path: Some(path.to_string_lossy().into_owned()),
                        install_path: None,
                        source: "saveFolder".into(),
                    });
                }
            }
        }
    }
    for common in steam_common_directories(user_dirs.home_dir()) {
        for game in discover_steam_installs(&common)? {
            if !found.iter().any(|existing| {
                existing.name.eq_ignore_ascii_case(&game.name)
                    || (existing.steam_app_id.is_some()
                        && existing.steam_app_id == game.steam_app_id)
            }) {
                found.push(game);
            }
        }
    }
    found.sort_by_cached_key(|g| g.name.to_lowercase());
    Ok(found)
}

/// Resolve the login user's home directory, never a hardcoded /Users/<name> path.
pub fn steam_common_directories(home: &Path) -> Vec<PathBuf> {
    if cfg!(target_os = "macos") {
        vec![home.join("Library/Application Support/Steam/steamapps/common")]
    } else if cfg!(target_os = "windows") {
        ["PROGRAMFILES(X86)", "PROGRAMFILES"]
            .into_iter()
            .filter_map(std::env::var_os)
            .map(|root| PathBuf::from(root).join("Steam/steamapps/common"))
            .collect()
    } else {
        vec![
            home.join(".local/share/Steam/steamapps/common"),
            home.join(".steam/steam/steamapps/common"),
            home.join(".var/app/com.valvesoftware.Steam/.local/share/Steam/steamapps/common"),
        ]
    }
}

/// Scan immediate game directories only; install directories are not save targets.
pub fn discover_steam_installs(common: &Path) -> Result<Vec<Discovered>> {
    if !common.try_exists()? {
        return Ok(Vec::new());
    }
    let mut manifests = HashMap::new();
    if let Some(steamapps) = common.parent() {
        for entry in std::fs::read_dir(steamapps)
            .with_context(|| format!("Cannot read Steam library {}", steamapps.display()))?
        {
            let entry = entry?;
            let filename = entry.file_name();
            let filename = filename.to_string_lossy();
            if !filename.starts_with("appmanifest_")
                || !filename.ends_with(".acf")
                || !entry.file_type()?.is_file()
            {
                continue;
            }
            // A manifest is small text metadata; never read game binaries or save contents here.
            anyhow::ensure!(
                entry.metadata()?.len() <= 1024 * 1024,
                "Steam manifest is unexpectedly large: {}",
                entry.path().display()
            );
            let text = std::fs::read_to_string(entry.path()).with_context(|| {
                format!("Cannot read Steam manifest {}", entry.path().display())
            })?;
            let Some(directory) = manifest_value(&text, "installdir") else {
                continue;
            };
            if crate::storage::safe_relative(&directory).is_err()
                || Path::new(&directory).components().count() != 1
            {
                continue;
            }
            let name = manifest_value(&text, "name")
                .filter(|n| !n.trim().is_empty())
                .unwrap_or_else(|| directory.clone());
            let id = manifest_value(&text, "appid")
                .filter(|id| !id.is_empty() && id.bytes().all(|c| c.is_ascii_digit()));
            manifests.insert(directory, (name, id));
        }
    }
    let mut found = Vec::new();
    for entry in std::fs::read_dir(common)
        .with_context(|| format!("Cannot read Steam game folder {}", common.display()))?
    {
        let entry = entry?;
        if !entry.file_type()?.is_dir() {
            continue;
        }
        let directory = entry.file_name().to_string_lossy().into_owned();
        if directory.starts_with('.') || directory == "Steam Controller Configs" {
            continue;
        }
        let (name, id) = manifests.remove(&directory).unwrap_or((directory, None));
        found.push(Discovered {
            name,
            steam_app_id: id,
            path: None,
            install_path: Some(entry.path().to_string_lossy().into_owned()),
            source: "steamInstall".into(),
        });
    }
    found.sort_by_cached_key(|g| g.name.to_lowercase());
    Ok(found)
}

// Steam's generated app manifests put each quoted key/value pair on its own line.
// Handle escaped quotes and backslashes while preserving Unicode game names.
fn manifest_value(text: &str, key: &str) -> Option<String> {
    for line in text.lines() {
        let mut chars = line.trim().chars();
        let quoted = |chars: &mut std::str::Chars<'_>| -> Option<String> {
            if chars.by_ref().find(|c| !c.is_whitespace())? != '"' {
                return None;
            }
            let mut value = String::new();
            while let Some(c) = chars.next() {
                match c {
                    '"' => return Some(value),
                    '\\' => {
                        let next = chars.next()?;
                        if next != '"' && next != '\\' {
                            value.push('\\');
                        }
                        value.push(next);
                    }
                    _ => value.push(c),
                }
            }
            None
        };
        if quoted(&mut chars).as_deref() == Some(key) {
            return quoted(&mut chars);
        }
    }
    None
}
