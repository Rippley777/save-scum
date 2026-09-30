use anyhow::{Context, Result};
use std::{
    fs,
    io::{Read, Write},
    path::{Component, Path, PathBuf},
};
pub fn safe_relative(path: &str) -> Result<PathBuf> {
    anyhow::ensure!(
        !path.is_empty() && !path.contains('\\') && !path.contains(':') && !path.contains('\0'),
        "Unsafe file path: {path}"
    );
    let p = Path::new(path);
    anyhow::ensure!(
        p.components().all(|c| matches!(c, Component::Normal(_))),
        "Unsafe file path: {path}"
    );
    Ok(p.to_path_buf())
}
pub fn blob_path(root: &Path, hash: &str) -> Result<PathBuf> {
    anyhow::ensure!(
        hash.len() == 64
            && hash
                .bytes()
                .all(|b| b.is_ascii_hexdigit() && !b.is_ascii_uppercase()),
        "Invalid content hash"
    );
    Ok(root
        .join("blobs")
        .join(&hash[..2])
        .join(format!("{hash}.zst")))
}
pub fn hash_file(path: &Path) -> Result<String> {
    let mut file =
        fs::File::open(path).with_context(|| format!("Cannot read {}", path.display()))?;
    let mut hasher = blake3::Hasher::new();
    let mut buffer = [0; 65536];
    loop {
        let n = file.read(&mut buffer)?;
        if n == 0 {
            break;
        }
        hasher.update(&buffer[..n]);
    }
    Ok(hasher.finalize().to_hex().to_string())
}
pub fn store(root: &Path, source: &Path, expected: &str, size: u64, level: i32) -> Result<()> {
    let dest = blob_path(root, expected)?;
    if dest.exists() {
        verify(root, expected, size)?;
        return Ok(());
    }
    fs::create_dir_all(dest.parent().unwrap())?;
    let mut temp = tempfile::NamedTempFile::new_in(dest.parent().unwrap())?;
    crate::compression::compress(source, temp.as_file_mut(), level)?;
    verify_path(temp.path(), expected, size)?;
    temp.persist_noclobber(&dest).map_err(|e| e.error)?;
    Ok(())
}
pub fn verify(root: &Path, hash: &str, size: u64) -> Result<()> {
    verify_path(&blob_path(root, hash)?, hash, size)
}
pub fn verify_path(path: &Path, expected: &str, size: u64) -> Result<()> {
    struct HashWriter {
        hasher: blake3::Hasher,
        count: u64,
    }
    impl Write for HashWriter {
        fn write(&mut self, bytes: &[u8]) -> std::io::Result<usize> {
            self.hasher.update(bytes);
            self.count += bytes.len() as u64;
            Ok(bytes.len())
        }
        fn flush(&mut self) -> std::io::Result<()> {
            Ok(())
        }
    }
    let mut out = HashWriter {
        hasher: blake3::Hasher::new(),
        count: 0,
    };
    crate::compression::decompress(path, &mut out, size)?;
    anyhow::ensure!(
        out.count == size && out.hasher.finalize().to_hex().as_str() == expected,
        "Integrity check failed for blob {expected}"
    );
    Ok(())
}
pub fn usage(root: &Path) -> u64 {
    walkdir::WalkDir::new(root.join("blobs"))
        .into_iter()
        .filter_map(Result::ok)
        .filter(|e| e.file_type().is_file())
        .filter_map(|e| e.metadata().ok())
        .map(|m| m.len())
        .sum()
}
