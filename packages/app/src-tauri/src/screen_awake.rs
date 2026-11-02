use tauri::{
    Runtime,
    plugin::{Builder, TauriPlugin},
};

const PLUGIN_NAME: &str = "screen-awake";

tauri::ios_plugin_binding!(init_plugin_screen_awake);

pub(crate) fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new(PLUGIN_NAME)
        .setup(|_, api| {
            api.register_ios_plugin(init_plugin_screen_awake)?;
            Ok(())
        })
        .build()
}
