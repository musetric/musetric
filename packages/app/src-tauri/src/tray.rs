use std::{
    sync::atomic::{AtomicBool, Ordering},
    time::Duration,
};

use musetric_server::EmbeddedServer;
use tauri::{
    AppHandle, Manager,
    menu::{Menu, MenuEvent, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
};

const TRAY: &str = "processing";
const OPEN: &str = "open";
const QUIT: &str = "quit";
const OPEN_LABEL: &str = "Open Musetric";
const QUIT_LABEL: &str = "Quit Musetric";
const PROCESSING: &str = "Musetric: processing a song";
const STATE_INTERVAL: Duration = Duration::from_secs(2);

struct Following(AtomicBool);

pub(crate) fn processing_runs(app: &AppHandle) -> bool {
    app.try_state::<EmbeddedServer>()
        .is_some_and(|server| tauri::async_runtime::block_on(server.processing_runs()))
}

pub(crate) fn show(app: &AppHandle) -> tauri::Result<()> {
    if app.tray_by_id(TRAY).is_none() {
        let open = MenuItem::with_id(app, OPEN, OPEN_LABEL, true, None::<&str>)?;
        let quit = MenuItem::with_id(app, QUIT, QUIT_LABEL, true, None::<&str>)?;
        let menu = Menu::with_items(app, &[&open, &quit])?;
        let mut builder = TrayIconBuilder::with_id(TRAY)
            .tooltip(PROCESSING)
            .menu(&menu)
            .show_menu_on_left_click(false)
            .on_menu_event(|handle, event| handle_menu(handle, &event))
            .on_tray_icon_event(|tray, event| handle_click(tray.app_handle(), &event));
        if let Some(icon) = app.default_window_icon() {
            builder = builder.icon(icon.clone());
        }
        builder.build(app)?;
    }
    follow_processing(app);
    Ok(())
}

pub(crate) fn hide(app: &AppHandle) {
    app.remove_tray_by_id(TRAY);
}

fn open_later(app: &AppHandle) {
    let handle = app.clone();
    if let Err(error) = app.run_on_main_thread(move || crate::open_main_window(&handle)) {
        log::error!("could not reopen the main window: {error}");
    }
}

fn handle_menu(app: &AppHandle, event: &MenuEvent) {
    if event.id() == OPEN {
        open_later(app);
    } else if event.id() == QUIT {
        app.exit(0);
    }
}

fn handle_click(app: &AppHandle, event: &TrayIconEvent) {
    if let TrayIconEvent::Click {
        button: MouseButton::Left,
        button_state: MouseButtonState::Up,
        ..
    } = *event
    {
        open_later(app);
    }
}

fn follow_processing(app: &AppHandle) {
    if app.try_state::<Following>().is_none() {
        app.manage(Following(AtomicBool::new(false)));
    }
    let Some(following) = app.try_state::<Following>() else {
        return;
    };
    if following.0.swap(true, Ordering::SeqCst) {
        return;
    }
    let handle = app.clone();
    tauri::async_runtime::spawn(async move {
        loop {
            tokio::time::sleep(STATE_INTERVAL).await;
            if handle.tray_by_id(TRAY).is_none() {
                break;
            }
            let runs = match handle.try_state::<EmbeddedServer>() {
                Some(server) => server.processing_runs().await,
                None => false,
            };
            if !runs {
                handle.exit(0);
                break;
            }
        }
        if let Some(state) = handle.try_state::<Following>() {
            state.0.store(false, Ordering::SeqCst);
        }
    });
}
