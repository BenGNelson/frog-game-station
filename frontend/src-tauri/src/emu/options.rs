// Core options — the legacy SET_VARIABLES/GET_VARIABLE protocol, plus the
// per-OS defaults table that row 4's Mac validation demanded.
//
// Two rules the spike paid to learn, preserved exactly:
//  - The value pointer handed back by GET_VARIABLE must stay valid for the
//    core's lifetime, so chosen values are stored as LEAKED CStrings (a few
//    dozen bytes per option per session — deliberate).
//  - Declining GET_VARIABLE sends cores down a rarely-tested fallback
//    (mupen64plus_next frees one of its own statics and aborts) — a frontend
//    MUST answer every option the core registered.

use std::sync::Mutex;

// key -> leaked c-string pointer (usize so the static is Sync).
pub static OPTIONS: Mutex<Vec<(String, usize)>> = Mutex::new(Vec::new());
// key -> value chosen before retro_init; SET_VARIABLES consults this.
pub static OVERRIDES: Mutex<Vec<(String, String)>> = Mutex::new(Vec::new());

/// The per-OS default core options. The macOS N64 story (recorded in
/// NATIVE_APP_PLAN §5a): GLideN64 renders black on Apple's deprecated GL with
/// FB emulation on, and leaves frame trails with it off — so the software RDP
/// (angrylion + cxd4) is the macOS default: pixel-exact and a locked 60 fps on
/// Apple silicon. paraLLEl-RDP over Vulkan/MoltenVK is the post-1.0 quality
/// path. Other platforms keep the core's own defaults until validated.
pub fn default_options(system: &str) -> &'static [(&'static str, &'static str)] {
    match (system, std::env::consts::OS) {
        ("n64", "macos") => &[
            ("mupen64plus-rdp-plugin", "angrylion"),
            ("mupen64plus-rsp-plugin", "cxd4"),
        ],
        // PCSX-ReARMed defaults port 1 to the original digital pad, so the
        // sticks read as dead until a DualShock is selected — and some games
        // (Ape Escape) can't be played at all without one. Every controller
        // this app supports has sticks, so analog is the honest default.
        ("psx", _) => &[("pcsx_rearmed_pad1type", "analog")],
        _ => &[],
    }
}

/// Arm the overrides for a new session: the per-OS defaults, then any
/// `FROG_EMU_OPT="key=value;key=value"` dev overrides on top (the spike's
/// SPIKE_OPT idiom — invaluable when chasing a core option by hand).
/// Must run BEFORE retro_init — SET_VARIABLES arrives during it.
pub fn arm(system: &str) {
    let mut ov = OVERRIDES.lock().unwrap();
    ov.clear();
    OPTIONS.lock().unwrap().clear(); // stale pointers from a previous session stay leaked — see above
    for (k, v) in default_options(system) {
        ov.push((k.to_string(), v.to_string()));
    }
    if let Ok(raw) = std::env::var("FROG_EMU_OPT") {
        for pair in raw.split(';') {
            if let Some((k, v)) = pair.split_once('=') {
                let k = k.trim().to_string();
                ov.retain(|(existing, _)| *existing != k);
                ov.push((k, v.trim().to_string()));
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn n64_on_macos_defaults_to_the_software_rdp() {
        let opts = default_options("n64");
        if std::env::consts::OS == "macos" {
            assert!(opts.contains(&("mupen64plus-rdp-plugin", "angrylion")));
            assert!(opts.contains(&("mupen64plus-rsp-plugin", "cxd4")));
        } else {
            assert!(opts.is_empty());
        }
    }

    #[test]
    fn playstation_selects_an_analog_pad_on_every_platform() {
        assert!(default_options("psx").contains(&("pcsx_rearmed_pad1type", "analog")));
    }

    #[test]
    fn other_systems_keep_core_defaults() {
        assert!(default_options("gba").is_empty());
        assert!(default_options("gb").is_empty());
    }
}
