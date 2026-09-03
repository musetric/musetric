use std::{
    io::{self, Write},
    process::exit,
    sync::Arc,
};

use musetric_server::{Bundle, EmbeddedServerOptions, Frontend, start_embedded};
use tauri::{Manager, WebviewUrl, WebviewWindowBuilder};

use crate::{
    assets::TauriAssets,
    pages::{TauriPages, report_page},
};

mod assets;
mod pages;

const STARTUP_FAILURE: &str = "musetric could not start: ";
const EXECUTOR_PREFIX: &str = "executor/";
const MAIN_WINDOW: &str = "main";
const TITLE: &str = "Musetric";
const APP_PREFIX: &str = "";

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
            let pages = TauriPages::create(app.handle().clone());
            app.manage(Arc::clone(&pages));
            let server = tauri::async_runtime::block_on(start_embedded(EmbeddedServerOptions {
                listen: "127.0.0.1:0".to_owned(),
                database: storage.join("db/app.db"),
                blobs: storage.join("blobs"),
                ffmpeg: root.join("runtime/ffmpeg"),
                models: root.join("models"),
                browser_bundle: Bundle::Assets(Arc::new(TauriAssets::create(
                    app.asset_resolver(),
                    EXECUTOR_PREFIX,
                ))),
                frontend: Frontend::from_assets(Arc::new(TauriAssets::create(
                    app.asset_resolver(),
                    APP_PREFIX,
                ))),
                pages,
                processing: true,
            }))
            .map_err(|error| std::io::Error::other(error.to_string()))?;
            let url = server.url().parse()?;
            app.manage(server);
            WebviewWindowBuilder::new(app, MAIN_WINDOW, WebviewUrl::External(url))
                .title(TITLE)
                .build()?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![report_page])
        .run(tauri::generate_context!())
}
