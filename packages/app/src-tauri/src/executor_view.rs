use serde_json::{Value, json};
use tauri::{
    AppHandle, Manager, Runtime,
    plugin::{Builder, PluginHandle, TauriPlugin},
};

const PLUGIN_NAME: &str = "executor-view";
const PLUGIN_PACKAGE: &str = "com.musetric.client";
const PLUGIN_CLASS: &str = "ExecutorViewPlugin";

struct ExecutorView<R: Runtime>(PluginHandle<R>);

pub(crate) fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new(PLUGIN_NAME)
        .setup(|app, api| {
            let handle = api.register_android_plugin(PLUGIN_PACKAGE, PLUGIN_CLASS)?;
            app.manage(ExecutorView(handle));
            Ok(())
        })
        .build()
}

pub(crate) fn open<R: Runtime>(app: &AppHandle<R>, url: &str) -> tauri::Result<()> {
    app.state::<ExecutorView<R>>()
        .0
        .run_mobile_plugin::<Value>("open", json!({ "url": url }))?;
    Ok(())
}
