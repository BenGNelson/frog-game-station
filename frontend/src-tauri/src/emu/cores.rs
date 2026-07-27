// Which dylib plays which system, and where the pinned cores live.
//
// Cores are GPL and always dlopen'd — never linked. scripts/fetch-native-cores.sh
// installs them (checksum-verified) into frontend/src-tauri/cores/<platform>/,
// which is where dev builds find them; FROG_CORES_DIR overrides for odd setups.
// Bundling into the .app resource dir is the Phase-4 packaging decision.

use std::path::PathBuf;

pub fn core_lib(core: &str) -> Option<&'static str> {
    // The SAME core the web player runs for each system, deliberately: a save
    // state is a core-specific blob, so picking a "better" core here would mean
    // a state made on the phone wouldn't load on the desktop. (Battery saves are
    // raw and would roam either way — states are the ones that break.)
    Some(match core {
        "n64" => "mupen64plus_next_libretro",
        "nds" => "melonds_libretro",
        "psx" => "pcsx_rearmed_libretro",
        "gb" => "gambatte_libretro",
        // The backend runs Game Boy Color on the gba core too — one mapping
        // covers .gbc and .gba, exactly as the web player does it.
        "gba" => "mgba_libretro",
        "nes" => "fceumm_libretro",
        "snes" => "snes9x_libretro",
        "segaMD" | "segaGG" => "genesis_plus_gx_libretro",
        "segaMS" => "smsplus_libretro",
        _ => return None,
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
    fn every_system_the_library_lists_resolves_to_a_core() {
        // The backend's format table (backend/app/library.py) is the source of
        // truth for these keys; all nine systems must play natively now.
        for core in ["gb", "gba", "nes", "snes", "segaMD", "segaMS", "segaGG", "n64", "nds", "psx"] {
            assert!(core_lib(core).is_some(), "no native core wired for {core}");
        }
        assert!(core_lib("xbox").is_none());
        assert!(resolve("xbox").is_err());
    }

    #[test]
    fn the_native_cores_match_the_web_players_so_save_states_roam() {
        // frontend/src/lib/library.js LIBRETRO_CORE is the mirror — these pairs
        // must not drift, or a state made on one face won't load on the other.
        for (system, lib) in [
            ("gb", "gambatte_libretro"),
            ("gba", "mgba_libretro"),
            ("nes", "fceumm_libretro"),
            ("snes", "snes9x_libretro"),
            ("segaMD", "genesis_plus_gx_libretro"),
            ("segaGG", "genesis_plus_gx_libretro"),
            ("segaMS", "smsplus_libretro"),
            ("n64", "mupen64plus_next_libretro"),
            ("nds", "melonds_libretro"),
            ("psx", "pcsx_rearmed_libretro"),
        ] {
            assert_eq!(core_lib(system), Some(lib));
        }
    }

    #[test]
    fn missing_core_names_the_fetch_script() {
        std::env::set_var("FROG_CORES_DIR", "/nonexistent");
        let err = resolve("n64").unwrap_err();
        assert!(err.contains("fetch-native-cores"));
        std::env::remove_var("FROG_CORES_DIR");
    }
}
