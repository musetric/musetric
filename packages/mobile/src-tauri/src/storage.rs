use std::path::{Component, Path, PathBuf};

/// On Android `app_data_dir` is the package directory itself, and the place
/// applications are expected to keep their own files is `files` inside it.
#[cfg(target_os = "android")]
pub fn create_data_root(app_data_dir: PathBuf) -> PathBuf {
    app_data_dir.join("files")
}

#[cfg(not(target_os = "android"))]
pub fn create_data_root(app_data_dir: PathBuf) -> PathBuf {
    app_data_dir
}

/// The same layout the desktop application uses under its user data directory,
/// see `createStoragePaths` in `@musetric/utils`.
pub struct StoragePaths {
    pub root: PathBuf,
    pub blobs: PathBuf,
    pub models: PathBuf,
    pub database: PathBuf,
}

pub fn create_storage_paths(data_root: &Path) -> StoragePaths {
    let root = data_root.join("storage");
    StoragePaths {
        blobs: root.join("blobs"),
        models: root.join("models"),
        database: root.join("db").join("app.db"),
        root,
    }
}

/// Resolves a request path against the storage root, refusing anything that
/// could escape it.
pub fn resolve_storage_path(root: &Path, relative: &str) -> Option<PathBuf> {
    let candidate = Path::new(relative);
    if candidate.is_absolute() {
        return None;
    }
    let mut resolved = root.to_path_buf();
    for component in candidate.components() {
        match component {
            Component::Normal(part) => resolved.push(part),
            Component::CurDir => {}
            _ => return None,
        }
    }
    Some(resolved)
}
