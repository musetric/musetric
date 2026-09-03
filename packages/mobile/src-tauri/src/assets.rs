use musetric_server::{Asset, Assets};
use tauri::{AssetResolver, Runtime};

pub(crate) struct TauriAssets<R: Runtime> {
    resolver: AssetResolver<R>,
    prefix: &'static str,
}

impl<R: Runtime> TauriAssets<R> {
    pub(crate) fn create(resolver: AssetResolver<R>, prefix: &'static str) -> Self {
        Self { resolver, prefix }
    }
}

impl<R: Runtime> Assets for TauriAssets<R> {
    fn get(&self, path: &str) -> Option<Asset> {
        let asset = self.resolver.get(format!("{}{path}", self.prefix))?;
        Some(Asset::create(asset.bytes, asset.mime_type))
    }
}
