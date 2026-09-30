use anyhow::Result;
use std::{
    fs::File,
    io::{Read, Write},
    path::Path,
};
pub fn compress(source: &Path, target: &mut File, level: i32) -> Result<()> {
    let mut input = File::open(source)?;
    zstd::stream::copy_encode(&mut input, &mut *target, level)?;
    target.flush()?;
    target.sync_all()?;
    Ok(())
}
pub fn decompress(source: &Path, target: &mut impl Write, max_bytes: u64) -> Result<()> {
    let reader = zstd::stream::read::Decoder::new(File::open(source)?)?;
    let count = std::io::copy(&mut reader.take(max_bytes.saturating_add(1)), target)?;
    anyhow::ensure!(count <= max_bytes, "Blob exceeds recorded size");
    Ok(())
}
