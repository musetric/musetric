use std::{env, error::Error};

const PUBLISH_VARIABLE: &str = "MUSETRIC_PUBLISH";

fn main() -> Result<(), Box<dyn Error>> {
    println!("cargo:rustc-check-cfg=cfg(development)");
    println!("cargo:rerun-if-env-changed={PUBLISH_VARIABLE}");
    if development()? {
        println!("cargo:rustc-cfg=development");
    }
    if env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("ios") {
        ios::link_ios_plugins()?;
    }
    tauri_build::try_build(tauri_build::Attributes::new())?;
    Ok(())
}

fn development() -> Result<bool, Box<dyn Error>> {
    let debug = env::var_os("CARGO_CFG_DEBUG_ASSERTIONS").is_some();
    Ok(match env::var("CARGO_CFG_TARGET_OS")?.as_str() {
        "ios" => !published()?,
        "android" => debug || !published()?,
        _ => debug,
    })
}

fn published() -> Result<bool, Box<dyn Error>> {
    match env::var(PUBLISH_VARIABLE) {
        Err(env::VarError::NotPresent) => Ok(false),
        Ok(value) if value == "false" => Ok(false),
        Ok(value) if value == "true" => Ok(true),
        Ok(value) => Err(format!("{PUBLISH_VARIABLE} must be true or false, got {value}").into()),
        Err(error) => Err(error.into()),
    }
}

#[cfg(target_os = "macos")]
mod ios {
    use std::{
        env,
        error::Error,
        fs,
        path::{Path, PathBuf},
    };

    const LIBRARY: &str = "musetric-ios";
    const PACKAGE: &str = "ios";
    const TAURI_API: &str = ".tauri/tauri-api";
    const SKIPPED: [&str; 3] = [".build", "Package.resolved", "Tests"];

    pub(crate) fn link_ios_plugins() -> Result<(), Box<dyn Error>> {
        let manifest = PathBuf::from(env::var("CARGO_MANIFEST_DIR")?);
        let tauri_api = PathBuf::from(env::var("DEP_TAURI_IOS_LIBRARY_PATH")?);
        let copy = manifest.join(TAURI_API);
        if copy.exists() {
            fs::remove_dir_all(&copy)?;
        }
        copy_folder(&tauri_api, &copy)?;
        println!("cargo:rerun-if-changed={PACKAGE}");
        tauri_utils::build::link_apple_library(LIBRARY, manifest.join(PACKAGE));
        Ok(())
    }

    fn copy_folder(source: &Path, target: &Path) -> Result<(), Box<dyn Error>> {
        fs::create_dir_all(target)?;
        for listed in fs::read_dir(source)? {
            let entry = listed?;
            let name = entry.file_name();
            if SKIPPED.iter().any(|skipped| name == *skipped) {
                continue;
            }
            let from = entry.path();
            let to = target.join(&name);
            if entry.file_type()?.is_dir() {
                copy_folder(&from, &to)?;
            } else {
                fs::copy(&from, &to)?;
            }
        }
        Ok(())
    }
}

#[cfg(not(target_os = "macos"))]
mod ios {
    use std::error::Error;

    pub(crate) fn link_ios_plugins() -> Result<(), Box<dyn Error>> {
        Err("iOS builds need a macOS host".into())
    }
}
