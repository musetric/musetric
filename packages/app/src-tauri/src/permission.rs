use musetric_server::EmbeddedServer;
use tauri::{
    Manager, Runtime, Url, Webview,
    webview::{PermissionKind, PermissionResponse},
};

pub(crate) fn handle<R: Runtime>(webview: &Webview<R>, kind: PermissionKind) -> PermissionResponse {
    if kind == PermissionKind::Microphone && shows_the_app(webview) {
        PermissionResponse::Allow
    } else {
        PermissionResponse::Default
    }
}

fn shows_the_app<R: Runtime>(webview: &Webview<R>) -> bool {
    let Some(server) = webview.try_state::<EmbeddedServer>() else {
        return false;
    };
    let (Ok(page), Ok(app)) = (webview.url(), server.url().parse::<Url>()) else {
        return false;
    };
    page.origin() == app.origin()
}
