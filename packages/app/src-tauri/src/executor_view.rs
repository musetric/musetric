use std::io;

use serde_json::{Value, json};
use tauri::{
    AppHandle, Manager, Runtime,
    plugin::{Builder, PluginHandle, TauriPlugin},
};

const PLUGIN_NAME: &str = "executor-view";
#[cfg(target_os = "android")]
const PLUGIN_PACKAGE: &str = "com.musetric.client";
#[cfg(target_os = "android")]
const PLUGIN_CLASS: &str = "ExecutorViewPlugin";

#[cfg(target_os = "ios")]
tauri::ios_plugin_binding!(init_plugin_executor_view);

struct ExecutorView<R: Runtime>(PluginHandle<R>);

pub(crate) fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new(PLUGIN_NAME)
        .setup(|app, api| {
            #[cfg(target_os = "android")]
            let handle = api.register_android_plugin(PLUGIN_PACKAGE, PLUGIN_CLASS)?;
            #[cfg(target_os = "ios")]
            let handle = api.register_ios_plugin(init_plugin_executor_view)?;
            app.manage(ExecutorView(handle));
            Ok(())
        })
        .build()
}

pub(crate) fn open<R: Runtime>(app: &AppHandle<R>, url: &str) -> tauri::Result<()> {
    app.state::<ExecutorView<R>>()
        .0
        .run_mobile_plugin::<Value>("open", json!({ "url": url }))
        .map_err(|error| io::Error::other(error.to_string()))?;
    Ok(())
}
