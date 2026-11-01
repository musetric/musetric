use tauri::{
    Runtime,
    plugin::{Builder, TauriPlugin},
};

const PLUGIN_NAME: &str = "haptics";

tauri::ios_plugin_binding!(init_plugin_haptics);

pub(crate) fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new(PLUGIN_NAME)
        .setup(|_, api| {
            api.register_ios_plugin(init_plugin_haptics)?;
            Ok(())
        })
        .build()
}
