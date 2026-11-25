use musetric_server::EmbeddedServer;
use tauri::{
    Manager, Runtime, Url, Webview,
    webview::{PermissionKind, PermissionResponse},
};

#[cfg(target_os = "windows")]
#[expect(
    unsafe_code,
    reason = "WebView2 sets a permission ahead of a request only through its COM interface"
)]
mod grant {
    use webview2_com::{
        Microsoft::Web::WebView2::Win32::{
            COREWEBVIEW2_PERMISSION_KIND_MICROPHONE, COREWEBVIEW2_PERMISSION_STATE_ALLOW,
            ICoreWebView2_13, ICoreWebView2Controller, ICoreWebView2Profile4,
        },
        SetPermissionStateCompletedHandler,
    };
    use windows::core::{HSTRING, Interface, Result};

    pub(super) fn microphone(controller: &ICoreWebView2Controller, origin: &str) -> Result<()> {
        let wide_origin = HSTRING::from(origin);
        let completed = SetPermissionStateCompletedHandler::create(Box::new(|result| {
            if let Err(error) = result {
                log::error!("could not grant the microphone: {error}");
            }
            Ok(())
        }));
        unsafe {
            controller
                .CoreWebView2()?
                .cast::<ICoreWebView2_13>()?
                .Profile()?
                .cast::<ICoreWebView2Profile4>()?
                .SetPermissionState(
                    COREWEBVIEW2_PERMISSION_KIND_MICROPHONE,
                    &wide_origin,
                    COREWEBVIEW2_PERMISSION_STATE_ALLOW,
                    &completed,
                )
        }
    }
}

pub(crate) fn handle<R: Runtime>(webview: &Webview<R>, kind: PermissionKind) -> PermissionResponse {
    if kind == PermissionKind::Microphone && shows_the_app(webview) {
        PermissionResponse::Allow
    } else {
        PermissionResponse::Default
    }
}

#[cfg(target_os = "windows")]
pub(crate) fn grant_microphone<R: Runtime>(window: &tauri::WebviewWindow<R>) {
    let Some(origin) = app_origin(window) else {
        return;
    };
    let granted = window.with_webview(move |webview| {
        if let Err(error) = grant::microphone(&webview.controller(), &origin) {
            log::error!("could not grant the microphone: {error}");
        }
    });
    if let Err(error) = granted {
        log::error!("could not grant the microphone: {error}");
    }
}

fn app_origin<R: Runtime, M: Manager<R>>(manager: &M) -> Option<String> {
    let server = manager.try_state::<EmbeddedServer>()?;
    let url = server.url().parse::<Url>().ok()?;
    Some(url.origin().ascii_serialization())
}

fn shows_the_app<R: Runtime>(webview: &Webview<R>) -> bool {
    let (Ok(page), Some(app)) = (webview.url(), app_origin(webview)) else {
        return false;
    };
    page.origin().ascii_serialization() == app
}
