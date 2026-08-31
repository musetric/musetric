mod download;
mod project_api;
mod server;
mod storage;

use std::sync::Mutex;

use tauri::{Manager, State};

use crate::server::StorageInfo;

struct StorageState(Mutex<Option<StorageInfo>>);

#[tauri::command]
fn storage_info(state: State<StorageState>) -> Result<StorageInfo, String> {
    state
        .0
        .lock()
        .map_err(|error| error.to_string())?
        .clone()
        .ok_or_else(|| "storage server is not ready".to_owned())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(StorageState(Mutex::new(None)))
        .invoke_handler(tauri::generate_handler![storage_info])
        .setup(|app| {
            let data_root = storage::create_data_root(app.path().app_data_dir()?);
            let debug_path = storage::create_storage_paths(&data_root)
                .root
                .join("debug-server-addr.txt");
            let info = tauri::async_runtime::block_on(server::start_server(data_root))?;
            let _ = std::fs::write(debug_path, format!("{} {}", info.origin, info.token));
            let state = app.state::<StorageState>();
            let mut slot = state.0.lock().map_err(|error| error.to_string())?;
            *slot = Some(info);
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
