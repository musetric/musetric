use std::{
    io::{self, Write},
    process::exit,
    sync::Arc,
};

use musetric_server::{Bundle, EmbeddedServerOptions, Frontend, start_embedded};
use tauri::{Manager, WebviewUrl, WebviewWindowBuilder};

#[cfg(desktop)]
use tauri_plugin_dialog::{DialogExt, MessageDialogKind};
#[cfg(desktop)]
use tauri_plugin_window_state::StateFlags;

use crate::assets::TauriAssets;

mod assets;
#[cfg(desktop)]
mod lifecycle;
#[cfg(desktop)]
mod update;

const STARTUP_FAILURE: &str = "musetric could not start: ";
const EXECUTOR_PREFIX: &str = "executor/";
const MAIN_WINDOW: &str = "main";
const TITLE: &str = "Musetric";
const APP_PREFIX: &str = "";
#[cfg(desktop)]
const WINDOW_HEIGHT: f64 = 800.0;
#[cfg(desktop)]
const WINDOW_WIDTH: f64 = 1280.0;
#[cfg(desktop)]
const LOG_FILE_SIZE: u128 = 100 * 1024 * 1024;
#[cfg(desktop)]
const KEPT_LOG_COUNT: usize = 20;
#[cfg(target_os = "windows")]
const WEBVIEW2_BROWSER_ARGS: &str = "--disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection --enable-unsafe-webgpu --disable-webgpu-blocklist --ignore-gpu-blocklist --force_high_performance_gpu";

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    if let Err(error) = run_app() {
        let _ = writeln!(io::stderr().lock(), "{STARTUP_FAILURE}{error}");
        exit(1);
    }
}

fn run_app() -> tauri::Result<()> {
    let app = tauri::Builder::default()
        .setup(|app| -> Result<(), Box<dyn std::error::Error>> {
            #[cfg(desktop)]
            let root = setup_desktop_lifecycle(app)?;
            #[cfg(mobile)]
            let root = app.path().app_data_dir()?;
            let storage = root.join("storage");
            let server_result =
                tauri::async_runtime::block_on(start_embedded(EmbeddedServerOptions {
                    listen: "127.0.0.1:0".to_owned(),
                    database: storage.join("db/app.db"),
                    blobs: storage.join("blobs"),
                    models: root.join("models"),
                    browser_bundle: Bundle::Assets(Arc::new(TauriAssets::create(
                        app.asset_resolver(),
                        EXECUTOR_PREFIX,
                    ))),
                    frontend: Frontend::from_assets(Arc::new(TauriAssets::create(
                        app.asset_resolver(),
                        APP_PREFIX,
                    ))),
                    processing: true,
                }));
            #[cfg(desktop)]
            let server = match server_result {
                Ok(server) => server,
                Err(error) => {
                    report_startup_failure(app, &root, error.as_ref());
                    return Err(io::Error::other(error.to_string()).into());
                }
            };
            #[cfg(mobile)]
            let server = server_result.map_err(|error| io::Error::other(error.to_string()))?;
            let url = WebviewUrl::External(server.url().parse()?);
            app.manage(server);
            create_main_window(app.handle(), url)?;
            Ok(())
        })
        .build(tauri::generate_context!())?;
    app.run(|handle, event| handle_run_event(handle, &event));
    Ok(())
}

fn create_main_window<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
    url: WebviewUrl,
) -> tauri::Result<()> {
    #[cfg(target_os = "windows")]
    let builder = WebviewWindowBuilder::new(app, MAIN_WINDOW, url)
        .title(TITLE)
        .additional_browser_args(WEBVIEW2_BROWSER_ARGS);
    #[cfg(not(target_os = "windows"))]
    let builder = WebviewWindowBuilder::new(app, MAIN_WINDOW, url).title(TITLE);
    finish_main_window(builder)
}

#[cfg(desktop)]
fn finish_main_window<R: tauri::Runtime, M: Manager<R>>(
    builder: WebviewWindowBuilder<'_, R, M>,
) -> tauri::Result<()> {
    builder
        .inner_size(WINDOW_WIDTH, WINDOW_HEIGHT)
        .background_color(tauri::webview::Color(18, 18, 18, 255))
        .visible(false)
        .build()?
        .show()?;
    Ok(())
}

#[cfg(mobile)]
fn finish_main_window<R: tauri::Runtime, M: Manager<R>>(
    builder: WebviewWindowBuilder<'_, R, M>,
) -> tauri::Result<()> {
    builder.build()?;
    Ok(())
}

#[cfg(desktop)]
fn setup_desktop_lifecycle(
    app: &mut tauri::App,
) -> Result<std::path::PathBuf, Box<dyn std::error::Error>> {
    app.handle()
        .plugin(tauri_plugin_single_instance::init(|handle, _, _| {
            open_main_window(handle);
        }))?;
    let root = lifecycle::application_data_dir(app)?;
    let logs = lifecycle::logs_dir(&root);
    std::fs::create_dir_all(&logs)?;
    app.handle().plugin(
        tauri_plugin_log::Builder::new()
            .level(log::LevelFilter::Info)
            .max_file_size(LOG_FILE_SIZE)
            .file_open_strategy(tauri_plugin_log::FileOpenStrategy::Rotate)
            .rotation_strategy(tauri_plugin_log::RotationStrategy::KeepSome(KEPT_LOG_COUNT))
            .targets([tauri_plugin_log::Target::new(
                tauri_plugin_log::TargetKind::Folder {
                    path: logs,
                    file_name: Some("musetric".into()),
                },
            )])
            .build(),
    )?;
    app.handle().plugin(tauri_plugin_dialog::init())?;
    app.handle().plugin(
        tauri_plugin_window_state::Builder::default()
            .with_state_flags(StateFlags::SIZE | StateFlags::POSITION | StateFlags::MAXIMIZED)
            .build(),
    )?;
    app.handle()
        .plugin(tauri_plugin_updater::Builder::new().build())?;
    let Some(lock) = lifecycle::acquire_storage_lock(&root)? else {
        let (title, message) = lifecycle::storage_busy_message();
        show_error_dialog(app, title, &message);
        return Err(io::Error::other(message).into());
    };
    app.manage(lock);
    log::info!(
        "app starting: version={}, platform={}, arch={}, packaged={}, user_data={}",
        env!("CARGO_PKG_VERSION"),
        std::env::consts::OS,
        std::env::consts::ARCH,
        !cfg!(debug_assertions),
        root.display()
    );
    update::start(app.handle());
    Ok(root)
}

#[cfg(desktop)]
fn report_startup_failure(
    app: &mut tauri::App,
    root: &std::path::Path,
    error: &(dyn std::error::Error + Send + Sync + 'static),
) {
    let logs = lifecycle::log_path(root);
    let (title, message) = lifecycle::startup_failure_message(error, &logs);
    show_error_dialog(app, title, &message);
}

#[cfg(desktop)]
fn show_error_dialog(app: &mut tauri::App, title: &str, message: &str) {
    log::error!("{title}: {message}");
    app.dialog()
        .message(message)
        .title(title)
        .kind(MessageDialogKind::Error)
        .blocking_show();
}

#[cfg(desktop)]
fn focus_main_window(app: &tauri::AppHandle) -> bool {
    let Some(window) = app.get_webview_window(MAIN_WINDOW) else {
        return false;
    };
    let _ = window.unminimize();
    let _ = window.show();
    let _ = window.set_focus();
    true
}

#[cfg(desktop)]
fn open_main_window(app: &tauri::AppHandle) {
    if focus_main_window(app) {
        return;
    }
    let Some(server) = app.try_state::<musetric_server::EmbeddedServer>() else {
        return;
    };
    let url = match server.url().parse() {
        Ok(url) => WebviewUrl::External(url),
        Err(error) => {
            log::error!("could not reopen the main window: {error}");
            return;
        }
    };
    if let Err(error) = create_main_window(app, url) {
        log::error!("could not reopen the main window: {error}");
    }
}

fn handle_run_event(app: &tauri::AppHandle, event: &tauri::RunEvent) {
    match event {
        tauri::RunEvent::Exit => {
            if let Some(server) = app.try_state::<musetric_server::EmbeddedServer>() {
                server.close();
            }
            #[cfg(desktop)]
            update::install_on_exit(app);
        }
        #[cfg(target_os = "macos")]
        tauri::RunEvent::ExitRequested {
            api, code: None, ..
        } => {
            api.prevent_exit();
        }
        #[cfg(target_os = "macos")]
        tauri::RunEvent::Reopen {
            has_visible_windows: false,
            ..
        } => open_main_window(app),
        _ => {}
    }
}
