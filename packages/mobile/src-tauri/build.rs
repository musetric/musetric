fn main() -> Result<(), Box<dyn std::error::Error>> {
    let commands = tauri_build::AppManifest::new().commands(&["report_page"]);
    tauri_build::try_build(tauri_build::Attributes::new().app_manifest(commands))?;
    Ok(())
}
