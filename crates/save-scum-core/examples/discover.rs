fn main() -> anyhow::Result<()> {
    println!(
        "{}",
        serde_json::to_string_pretty(&save_scum_core::scanner::discover(None)?)?
    );
    Ok(())
}
