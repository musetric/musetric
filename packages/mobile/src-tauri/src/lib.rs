use std::{
    io::{self, Write},
    process::exit,
    sync::Arc,
};

use musetric_server::{
    EmbeddedServerOptions, Frontend, FrontendAsset, FrontendAssets, start_embedded,
};
use tauri::{Manager, Runtime};

struct TauriAssets<R: Runtime> {
    resolver: tauri::AssetResolver<R>,
}

impl<R: Runtime> FrontendAssets for TauriAssets<R> {
    fn get(&self, path: &str) -> Option<FrontendAsset> {
        self.resolver
            .get(path.to_owned())
            .map(|asset| FrontendAsset::new(asset.bytes, asset.mime_type))
    }
}

const STARTUP_FAILURE: &str = "musetric could not start: ";

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    if let Err(error) = run_app() {
        let _ = writeln!(io::stderr().lock(), "{STARTUP_FAILURE}{error}");
        exit(1);
    }
}

fn run_app() -> tauri::Result<()> {
    tauri::Builder::default()
        .setup(|app| {
            let root = app.path().app_data_dir()?;
            let storage = root.join("storage");
            let server = tauri::async_runtime::block_on(start_embedded(EmbeddedServerOptions {
                listen: "127.0.0.1:0".to_owned(),
                database: storage.join("db/app.db"),
                blobs: storage.join("blobs"),
                ffmpeg: root.join("runtime/ffmpeg"),
                ffprobe: root.join("runtime/ffprobe"),
                models: root.join("models"),
                browser_bundle: root.join("browser"),
                frontend: Frontend::from_assets(Arc::new(TauriAssets {
                    resolver: app.asset_resolver(),
                })),
            }))
            .map_err(|error| std::io::Error::other(error.to_string()))?;
            let url = server.url().parse()?;
            app.manage(server);
            app.get_webview_window("main")
                .ok_or("The main webview was not created")?
                .navigate(url)?;
            Ok(())
        })
        .run(tauri::generate_context!())
}
