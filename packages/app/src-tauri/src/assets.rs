use std::collections::HashSet;

use musetric_server::{Asset, Assets};
use tauri::{AssetResolver, Runtime};

pub(crate) struct TauriAssets<R: Runtime> {
    resolver: AssetResolver<R>,
    prefix: &'static str,
    embedded: Option<HashSet<String>>,
}

fn read_embedded<R: Runtime>(resolver: &AssetResolver<R>) -> Option<HashSet<String>> {
    let names: HashSet<String> = resolver
        .iter()
        .map(|(name, _)| name.trim_start_matches('/').to_owned())
        .collect();
    (!names.is_empty()).then_some(names)
}

impl<R: Runtime> TauriAssets<R> {
    pub(crate) fn create(resolver: AssetResolver<R>, prefix: &'static str) -> Self {
        let embedded = read_embedded(&resolver);
        Self {
            resolver,
            prefix,
            embedded,
        }
    }

    fn published(&self, name: &str) -> bool {
        self.embedded
            .as_ref()
            .is_none_or(|names| names.contains(name))
    }
}

impl<R: Runtime> Assets for TauriAssets<R> {
    fn get(&self, path: &str) -> Option<Asset> {
        let name = format!("{}{path}", self.prefix);
        if !self.published(&name) {
            return None;
        }
        let asset = self.resolver.get(name)?;
        Some(Asset::create(asset.bytes, asset.mime_type))
    }
}
