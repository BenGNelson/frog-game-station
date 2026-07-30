// Core options — the legacy SET_VARIABLES/GET_VARIABLE protocol, the per-OS
// defaults table that row 4's Mac validation demanded, and the model behind the
// player's System options panel.
//
// Three rules the spike paid to learn, preserved exactly:
//  - The value pointer handed back by GET_VARIABLE must stay valid for the
//    core's lifetime, so chosen values are stored as LEAKED CStrings (a few
//    dozen bytes per option per session — deliberate). Changing an option leaks
//    a NEW string and never frees the old one: the core is entitled to hold
//    every pointer it was ever given, so freeing here is a use-after-free
//    waiting for the next time it reads a value it cached.
//  - Declining GET_VARIABLE sends cores down a rarely-tested fallback
//    (mupen64plus_next frees one of its own statics and aborts) — a frontend
//    MUST answer every option the core registered.
//  - GET_VARIABLE_UPDATE must answer true exactly ONCE after a change. Always
//    true has melonDS rebuild its renderer sixty times a second; always false
//    (what the host did until Phase 3) means a change is never picked up.

use std::ffi::CString;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Mutex, MutexGuard};

/// One option the running core registered.
pub struct OptionEntry {
    pub key: String,
    /// The description half of "Screen Layout; Top/Bottom|Left/Right".
    pub label: String,
    /// Every value the core declared, in the core's own order.
    pub values: Vec<String>,
    /// The core's own first value — what "use the core's defaults" restores to.
    pub default_value: String,
    /// What GET_VARIABLE currently answers with.
    pub current: String,
    /// The LEAKED CString behind `current`. Never freed — see the header.
    ptr: usize,
}

/// The whole options model under ONE lock. These used to be two mutexes taken in
/// OPPOSITE orders (arm: overrides→entries, SET_VARIABLES: entries→overrides) —
/// a lock-order inversion that stayed harmless only because both ran on the emu
/// thread. A Tauri command thread reads this now, so the question is deleted
/// rather than re-reasoned about every time someone touches the file.
#[derive(Default)]
pub struct Options {
    pub entries: Vec<OptionEntry>,
    /// key -> value chosen before retro_init; SET_VARIABLES consults this.
    pub overrides: Vec<(String, String)>,
}

pub static OPTIONS: Mutex<Options> = Mutex::new(Options {
    entries: Vec::new(),
    overrides: Vec::new(),
});

/// GET_VARIABLE_UPDATE's answer. An atomic rather than a field because the core
/// asks every frame and `swap` IS the "true exactly once" primitive.
static DIRTY: AtomicBool = AtomicBool::new(false);

/// A panicking emu thread must not also take the options panel down with it —
/// a poisoned lock still holds a perfectly readable table.
fn lock() -> MutexGuard<'static, Options> {
    OPTIONS.lock().unwrap_or_else(|e| e.into_inner())
}

/// The shape the frontend sees.
#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CoreOptionJs {
    pub key: String,
    pub label: String,
    pub values: Vec<String>,
    pub default_value: String,
    pub current: String,
}

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

/// "Screen Layout; Top/Bottom|Left/Right" -> ("Screen Layout", [...]).
/// Tolerant on purpose: splits at the FIRST ';' and trims, so a core that omits
/// the space after the semicolon still parses, and a description with no ';' at
/// all yields a label and no values rather than a garbled key.
pub fn parse_variable(desc: &str) -> (String, Vec<String>) {
    match desc.split_once(';') {
        Some((label, values)) => (
            label.trim().to_string(),
            values
                .trim()
                .split('|')
                .map(|v| v.trim().to_string())
                .filter(|v| !v.is_empty())
                .collect(),
        ),
        None => (desc.trim().to_string(), Vec::new()),
    }
}

/// SET_VARIABLES' body, lifted out of the C callback so the table can be built
/// and asserted on with no core loaded.
pub fn register(key: &str, desc: &str) {
    let (label, values) = parse_variable(desc);
    let default_value = values.first().cloned().unwrap_or_default();
    let mut opts = lock();
    let chosen = opts
        .overrides
        .iter()
        .find(|(k, _)| k == key)
        .map(|(_, v)| v.clone())
        .unwrap_or_else(|| default_value.clone());
    let ptr = leak(&chosen);
    opts.entries.push(OptionEntry {
        key: key.to_string(),
        label,
        values,
        default_value,
        current: chosen,
        ptr,
    });
}

fn leak(value: &str) -> usize {
    // A NUL inside a core's own value string would be a broken core; fall back
    // to an empty string rather than panicking the emu thread over it.
    CString::new(value)
        .unwrap_or_default()
        .into_raw() as usize
}

/// The pointer GET_VARIABLE should answer with, or None for a key we never saw
/// (the only case where declining is correct).
pub fn value_ptr(key: &str) -> Option<usize> {
    lock().entries.iter().find(|e| e.key == key).map(|e| e.ptr)
}

/// Everything the core registered, for the frontend's curated view.
pub fn list() -> Vec<CoreOptionJs> {
    lock()
        .entries
        .iter()
        .map(|e| CoreOptionJs {
            key: e.key.clone(),
            label: e.label.clone(),
            values: e.values.clone(),
            default_value: e.default_value.clone(),
            current: e.current.clone(),
        })
        .collect()
}

/// Change one option. EMU-THREAD ONLY — routed through EmuCmd::SetOption so the
/// pointer swap can never land while the core is inside retro_run, and possibly
/// inside GET_VARIABLE reading the very pointer being replaced.
pub fn set_value(key: &str, value: &str) -> Result<(), String> {
    {
        let mut opts = lock();
        let entry = opts
            .entries
            .iter_mut()
            .find(|e| e.key == key)
            .ok_or_else(|| format!("the core registered no option named {key}"))?;
        // Never invent a value: a core handed something outside its own
        // declared list can behave in ways nobody has tested.
        if !entry.values.iter().any(|v| v == value) {
            return Err(format!("{key} does not offer {value}"));
        }
        if entry.current == value {
            return Ok(()); // a no-op must not raise the update flag
        }
        entry.ptr = leak(value);
        entry.current = value.to_string();
    }
    // Value first, flag second — never the reverse, or a core polling between
    // the two reads "something changed" and finds the old value.
    DIRTY.store(true, Ordering::Release);
    Ok(())
}

/// GET_VARIABLE_UPDATE's answer: true exactly once after a change.
pub fn take_update() -> bool {
    DIRTY.swap(false, Ordering::AcqRel)
}

/// Arm the overrides for a new session, weakest layer first:
///   the per-OS defaults  <  the player's saved choices  <  FROG_EMU_OPT
/// The env var wins because it is the debugging escape hatch (the spike's
/// SPIKE_OPT idiom — invaluable when chasing a core option by hand).
/// Must run BEFORE retro_init — SET_VARIABLES arrives during it.
pub fn arm(system: &str, saved: &[(String, String)]) {
    let mut opts = lock();
    opts.overrides.clear();
    // Stale entries from a previous session go; their leaked strings stay
    // leaked, deliberately — see the header.
    opts.entries.clear();
    DIRTY.store(false, Ordering::Release);

    let mut put = |k: String, v: String| {
        opts.overrides.retain(|(existing, _)| *existing != k);
        opts.overrides.push((k, v));
    };
    for (k, v) in default_options(system) {
        put(k.to_string(), v.to_string());
    }
    for (k, v) in saved {
        put(k.clone(), v.clone());
    }
    if let Ok(raw) = std::env::var("FROG_EMU_OPT") {
        for pair in raw.split(';') {
            if let Some((k, v)) = pair.split_once('=') {
                put(k.trim().to_string(), v.trim().to_string());
            }
        }
    }
}

/// Drop the table when a session ends, so a list between games answers with an
/// honest empty rather than the dead core's options.
pub fn clear() {
    let mut opts = lock();
    opts.entries.clear();
    opts.overrides.clear();
    DIRTY.store(false, Ordering::Release);
}

#[cfg(test)]
mod tests {
    use super::*;

    // The options table is process-wide state and cargo runs tests in parallel
    // — same reason input.rs keeps a PAD_TEST_LOCK.
    static OPTS_TEST_LOCK: Mutex<()> = Mutex::new(());
    fn guard() -> MutexGuard<'static, ()> {
        OPTS_TEST_LOCK.lock().unwrap_or_else(|e| e.into_inner())
    }

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

    #[test]
    fn a_description_splits_into_a_label_and_its_values() {
        let (label, values) = parse_variable("Screen Layout; Top/Bottom|Left/Right|Hybrid Top");
        assert_eq!(label, "Screen Layout");
        assert_eq!(values, ["Top/Bottom", "Left/Right", "Hybrid Top"]);
        // No space after the semicolon — some cores write it that way.
        let (label, values) = parse_variable("Threaded;enabled|disabled");
        assert_eq!(label, "Threaded");
        assert_eq!(values, ["enabled", "disabled"]);
        // No values at all is a label, not a garbled key.
        let (label, values) = parse_variable("Just a label");
        assert_eq!(label, "Just a label");
        assert!(values.is_empty());
    }

    #[test]
    fn registration_takes_the_cores_first_value_unless_overridden() {
        let _g = guard();
        arm("gba", &[]);
        register("test_plain", "Plain; a|b|c");
        let entries = list();
        let e = entries.iter().find(|e| e.key == "test_plain").unwrap();
        assert_eq!(e.current, "a");
        assert_eq!(e.default_value, "a");

        arm("gba", &[("test_over".to_string(), "c".to_string())]);
        register("test_over", "Over; a|b|c");
        let entries = list();
        let e = entries.iter().find(|e| e.key == "test_over").unwrap();
        assert_eq!(e.current, "c"); // the saved choice
        assert_eq!(e.default_value, "a"); // the core's own default is still known
        clear();
    }

    #[test]
    fn a_saved_choice_beats_the_per_os_default_and_the_env_beats_both() {
        let _g = guard();
        // Only meaningful where a per-OS default exists.
        arm("psx", &[]);
        assert!(lock()
            .overrides
            .contains(&("pcsx_rearmed_pad1type".to_string(), "analog".to_string())));

        arm(
            "psx",
            &[("pcsx_rearmed_pad1type".to_string(), "standard".to_string())],
        );
        assert!(lock()
            .overrides
            .contains(&("pcsx_rearmed_pad1type".to_string(), "standard".to_string())));

        std::env::set_var("FROG_EMU_OPT", "pcsx_rearmed_pad1type=negcon");
        arm(
            "psx",
            &[("pcsx_rearmed_pad1type".to_string(), "standard".to_string())],
        );
        assert!(lock()
            .overrides
            .contains(&("pcsx_rearmed_pad1type".to_string(), "negcon".to_string())));
        std::env::remove_var("FROG_EMU_OPT");
        clear();
    }

    #[test]
    fn setting_a_value_leaks_a_new_pointer_and_never_reuses_the_old() {
        let _g = guard();
        arm("gba", &[]);
        register("test_ptr", "Ptr; a|b");
        let before = value_ptr("test_ptr").unwrap();
        set_value("test_ptr", "b").unwrap();
        let after = value_ptr("test_ptr").unwrap();
        // The old pointer is still live for the core to read — it must NOT have
        // been freed and handed back for the new value.
        assert_ne!(before, after);
        assert_eq!(list().iter().find(|e| e.key == "test_ptr").unwrap().current, "b");
        clear();
    }

    #[test]
    fn setting_refuses_an_unknown_key_or_a_value_the_core_never_declared() {
        let _g = guard();
        arm("gba", &[]);
        register("test_refuse", "Refuse; a|b");
        assert!(set_value("no_such_key", "a").is_err());
        assert!(set_value("test_refuse", "z").is_err());
        assert_eq!(
            list().iter().find(|e| e.key == "test_refuse").unwrap().current,
            "a"
        );
        clear();
    }

    #[test]
    fn the_update_flag_answers_true_exactly_once_and_never_for_a_no_op() {
        let _g = guard();
        arm("gba", &[]);
        register("test_dirty", "Dirty; a|b");
        assert!(!take_update()); // a fresh session has nothing to re-read

        set_value("test_dirty", "b").unwrap();
        assert!(take_update()); // the core learns about the change...
        assert!(!take_update()); // ...exactly once

        set_value("test_dirty", "b").unwrap(); // same value = no change
        assert!(!take_update());
        clear();
    }

    #[test]
    fn arming_a_new_session_drops_the_previous_cores_table() {
        let _g = guard();
        arm("gba", &[]);
        register("test_stale", "Stale; a|b");
        assert!(!list().is_empty());
        arm("gb", &[]);
        assert!(list().is_empty());
        clear();
    }
}
