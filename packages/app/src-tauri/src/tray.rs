use std::time::Duration;

use musetric_server::EmbeddedServer;
use tauri::{
    AppHandle, Manager,
    menu::{Menu, MenuEvent, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIcon, TrayIconBuilder, TrayIconEvent},
};

const TRAY: &str = "processing";
const OPEN: &str = "open";
const QUIT: &str = "quit";
const OPEN_LABEL: &str = "Open Musetric";
const QUIT_LABEL: &str = "Quit Musetric";
const PROCESSING: &str = "Musetric: processing a song";
const PROCESSED: &str = "Musetric: processing is done";
const STATE_INTERVAL: Duration = Duration::from_secs(2);

pub(crate) fn processing_runs(app: &AppHandle) -> bool {
    app.try_state::<EmbeddedServer>()
        .is_some_and(|server| tauri::async_runtime::block_on(server.processing_runs()))
}

pub(crate) fn show(app: &AppHandle) -> tauri::Result<()> {
    if app.tray_by_id(TRAY).is_some() {
        return Ok(());
    }
    let open = MenuItem::with_id(app, OPEN, OPEN_LABEL, true, None::<&str>)?;
    let quit = MenuItem::with_id(app, QUIT, QUIT_LABEL, true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&open, &quit])?;
    let mut builder = TrayIconBuilder::with_id(TRAY)
        .tooltip(PROCESSING)
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|handle, event| handle_menu(handle, &event))
        .on_tray_icon_event(|tray, event| handle_click(tray, &event));
    if let Some(icon) = app.default_window_icon() {
        builder = builder.icon(icon.clone());
    }
    builder.build(app)?;
    follow_processing(app.clone());
    Ok(())
}

pub(crate) fn hide(app: &AppHandle) {
    app.remove_tray_by_id(TRAY);
}

fn handle_menu(app: &AppHandle, event: &MenuEvent) {
    if event.id() == OPEN {
        crate::open_main_window(app);
    } else if event.id() == QUIT {
        app.exit(0);
    }
}

fn handle_click(tray: &TrayIcon, event: &TrayIconEvent) {
    if let TrayIconEvent::Click {
        button: MouseButton::Left,
        button_state: MouseButtonState::Up,
        ..
    } = *event
    {
        crate::open_main_window(tray.app_handle());
    }
}

fn follow_processing(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        loop {
            tokio::time::sleep(STATE_INTERVAL).await;
            let Some(tray) = app.tray_by_id(TRAY) else {
                return;
            };
            let runs = match app.try_state::<EmbeddedServer>() {
                Some(server) => server.processing_runs().await,
                None => false,
            };
            let _ = tray.set_tooltip(Some(if runs { PROCESSING } else { PROCESSED }));
        }
    });
}
