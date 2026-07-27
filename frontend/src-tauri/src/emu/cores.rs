// Which dylib plays which system, and where the pinned cores live.
//
// Cores are GPL and always dlopen'd — never linked. scripts/fetch-native-cores.sh
// installs them (checksum-verified) into frontend/src-tauri/cores/<platform>/,
// which is where dev builds find them; FROG_CORES_DIR overrides for odd setups.
// Bundling into the .app resource dir is the Phase-4 packaging decision.

use std::path::PathBuf;

pub fn core_lib(core: &str) -> Option<&'static str> {
    Some(match core {
        "n64" => "mupen64plus_next_libretro",
        _ => return None, // 2b adds nds/psx; 2c the cartridge cores
    })
}

pub fn platform_dir() -> &'static str {
    match (std::env::consts::OS, std::env::consts::ARCH) {
        ("macos", "aarch64") => "mac-arm64",
        ("linux", _) => "linux-x86_64",
        ("windows", _) => "windows-x86_64",
        _ => "unknown",
    }
}

fn dylib_ext() -> &'static str {
    match std::env::consts::OS {
        "macos" => "dylib",
        "windows" => "dll",
        _ => "so",
    }
}

pub fn resolve(core: &str) -> Result<PathBuf, String> {
    let lib = core_lib(core).ok_or_else(|| format!("no native core wired for system '{core}' yet"))?;
    let file = format!("{lib}.{}", dylib_ext());
    let dir = match std::env::var("FROG_CORES_DIR") {
        Ok(d) => PathBuf::from(d),
        Err(_) => PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("cores").join(platform_dir()),
    };
    let path = dir.join(&file);
    if !path.is_file() {
        return Err(format!(
            "core not installed: {} — run scripts/fetch-native-cores.sh first",
            path.display()
        ));
    }
    Ok(path)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn n64_resolves_to_mupen_and_unknown_systems_refuse() {
        assert_eq!(core_lib("n64"), Some("mupen64plus_next_libretro"));
        assert!(core_lib("xbox").is_none());
        assert!(resolve("xbox").is_err());
    }

    #[test]
    fn missing_core_names_the_fetch_script() {
        std::env::set_var("FROG_CORES_DIR", "/nonexistent");
        let err = resolve("n64").unwrap_err();
        assert!(err.contains("fetch-native-cores"));
        std::env::remove_var("FROG_CORES_DIR");
    }
}
