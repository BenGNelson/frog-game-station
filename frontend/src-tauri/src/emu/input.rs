// Input: the snapshot the core reads, and everything that writes into it.
//
// Same shape the spike proved: `input_poll` is a no-op; the host updates a
// few atomics (once per frame for the pad, on command for synthetic presses)
// and `input_state` serves the core from them. The RetroPad digital indices
// here match the frontend's `lib/retropad.js` one-to-one — that shared
// vocabulary is what lets the Controls screen drive a native core.
//
// Gating (the native gateEngineGamepad): while any menu chrome is open, the
// physical pad must walk the MENU, not the paused game underneath. Gated ⇒
// gilrs events still drain (hot-plug, no stale state) but stop writing into
// the snapshot, and the snapshot is zeroed. Synthetic presses from the app
// (press_input / set_analog — e.g. the START tap) bypass the gate on purpose,
// exactly like the web player's press() does.

use super::libretro::*;
use std::os::raw::c_uint;
use std::sync::atomic::{AtomicBool, AtomicI16, AtomicU32, Ordering};
use std::sync::Mutex;

pub static PAD_BITS: AtomicU32 = AtomicU32::new(0);
pub static PAD_AX: AtomicI16 = AtomicI16::new(0);
pub static PAD_AY: AtomicI16 = AtomicI16::new(0);
// The right stick — on the N64 it IS the C-buttons (mupen64plus_next maps
// them there), so a host without it has no C-buttons at all.
pub static PAD_RX: AtomicI16 = AtomicI16::new(0);
pub static PAD_RY: AtomicI16 = AtomicI16::new(0);
pub static GATED: AtomicBool = AtomicBool::new(false);
// Set when the gate lifts: the next poll drops the backlog and suppresses the
// buttons the player is still holding (see set_gated).
static FLUSH_ON_RESUME: AtomicBool = AtomicBool::new(false);
// Web-button indices held across an ungate; each clears on its own release.
static HELD_AT_RESUME: AtomicU32 = AtomicU32::new(0);

// Optional remap pushed by the frontend: standard web-gamepad button index →
// RetroPad id (or None = unmapped). Index 9 (the web pad's Start/menu chord
// button in the app's scheme) is never mapped by the frontend — the app owns
// it — and anything absent falls back to nothing, not to the default table.
pub static REMAP: Mutex<Option<Vec<Option<c_uint>>>> = Mutex::new(None);

pub fn set_gated(gated: bool) {
    let was = GATED.swap(gated, Ordering::Relaxed);
    if was && !gated {
        // Lifting the gate is the dangerous edge. The webview polls the pad on
        // its own rAF loop and reacts to "A" the instant it sees it — closing
        // the menu and ungating — while the SAME press is still sitting in
        // gilrs's queue, unread by the emu thread. Drained naively it would land
        // in the game a frame later: A resumed the menu AND accelerated the kart.
        // So on release the next poll discards whatever queued up, and any button
        // still physically held is suppressed until the player lets go of it.
        FLUSH_ON_RESUME.store(true, Ordering::Relaxed);
    }
    if gated {
        PAD_BITS.store(0, Ordering::Relaxed);
        PAD_AX.store(0, Ordering::Relaxed);
        PAD_AY.store(0, Ordering::Relaxed);
        PAD_RX.store(0, Ordering::Relaxed);
        PAD_RY.store(0, Ordering::Relaxed);
    }
}

pub fn press(index: c_uint, down: bool) {
    if index >= 16 {
        return;
    }
    if down {
        PAD_BITS.fetch_or(1 << index, Ordering::Relaxed);
    } else {
        PAD_BITS.fetch_and(!(1 << index), Ordering::Relaxed);
    }
}

/// Analog halves, in the frontend's `retropad.js` ANALOG index space —
/// each direction is its own input, value 0..=32767:
/// 16 = LX_PLUS (stick right), 17 = LX_MINUS (left),
/// 18 = LY_PLUS (down — libretro Y is positive-down), 19 = LY_MINUS (up),
/// 20..=23 the same four for the right stick (the N64 C-buttons).
pub fn analog(index: c_uint, value: u16) {
    let v = value.min(32767) as i16;
    match index {
        16 => PAD_AX.store(v, Ordering::Relaxed),
        17 => PAD_AX.store(-v, Ordering::Relaxed),
        18 => PAD_AY.store(v, Ordering::Relaxed),
        19 => PAD_AY.store(-v, Ordering::Relaxed),
        20 => PAD_RX.store(v, Ordering::Relaxed),
        21 => PAD_RX.store(-v, Ordering::Relaxed),
        22 => PAD_RY.store(v, Ordering::Relaxed),
        23 => PAD_RY.store(-v, Ordering::Relaxed),
        _ => {}
    }
}

/// gilrs Button → standard web-gamepad button index (the W3C "standard
/// mapping"). The frontend's bindings are keyed in THIS space; the REMAP
/// table then turns it into a RetroPad id.
pub fn web_index(b: gilrs::Button) -> Option<usize> {
    use gilrs::Button;
    Some(match b {
        Button::South => 0,
        Button::East => 1,
        Button::West => 2,
        Button::North => 3,
        Button::LeftTrigger => 4,
        Button::RightTrigger => 5,
        Button::LeftTrigger2 => 6,
        Button::RightTrigger2 => 7,
        Button::Select => 8,
        Button::Start => 9,
        Button::LeftThumb => 10,
        Button::RightThumb => 11,
        Button::DPadUp => 12,
        Button::DPadDown => 13,
        Button::DPadLeft => 14,
        Button::DPadRight => 15,
        _ => return None,
    })
}

/// The out-of-the-box mapping (no REMAP pushed): the spike's proven table,
/// expressed in web-index space. Web index 9 (Start) is deliberately ABSENT —
/// short-press START is synthesized by the app, long-press opens the menu, and
/// the game must never see the raw button.
/// The inverse of `web_index`, for reading a pad's live button state.
fn button_for_web(web: usize) -> Option<gilrs::Button> {
    use gilrs::Button;
    Some(match web {
        0 => Button::South,
        1 => Button::East,
        2 => Button::West,
        3 => Button::North,
        4 => Button::LeftTrigger,
        5 => Button::RightTrigger,
        6 => Button::LeftTrigger2,
        7 => Button::RightTrigger2,
        8 => Button::Select,
        9 => Button::Start,
        10 => Button::LeftThumb,
        11 => Button::RightThumb,
        12 => Button::DPadUp,
        13 => Button::DPadDown,
        14 => Button::DPadLeft,
        15 => Button::DPadRight,
        _ => return None,
    })
}

fn default_retro_id(web: usize) -> Option<c_uint> {
    Some(match web {
        0 => JOYPAD_B,
        1 => JOYPAD_A,
        2 => JOYPAD_Y,
        3 => JOYPAD_X,
        4 => JOYPAD_L,
        5 => JOYPAD_R,
        6 => JOYPAD_L2,
        7 => JOYPAD_R2,
        8 => JOYPAD_SELECT,
        12 => JOYPAD_UP,
        13 => JOYPAD_DOWN,
        14 => JOYPAD_LEFT,
        15 => JOYPAD_RIGHT,
        _ => return None,
    })
}

fn retro_id_for(web: usize) -> Option<c_uint> {
    let remap = REMAP.lock().unwrap();
    match remap.as_ref() {
        Some(table) => table.get(web).copied().flatten(),
        None => default_retro_id(web),
    }
}

/// Drain gilrs and update the snapshot. Runs once per frame on the emu thread.
pub fn poll(gilrs: &mut gilrs::Gilrs) {
    use gilrs::{Axis, EventType};

    // The gate just lifted: throw away the backlog (it belongs to the menu the
    // player was driving), then note which buttons are still down so they can't
    // register as fresh presses until released.
    if FLUSH_ON_RESUME.swap(false, Ordering::Relaxed) {
        while gilrs.next_event().is_some() {}
        let mut held = 0u32;
        for (_id, pad) in gilrs.gamepads() {
            for web in 0..16usize {
                if let Some(button) = button_for_web(web) {
                    if pad.is_pressed(button) {
                        held |= 1 << web;
                    }
                }
            }
        }
        HELD_AT_RESUME.store(held, Ordering::Relaxed);
        return;
    }

    while let Some(ev) = gilrs.next_event() {
        let gated = GATED.load(Ordering::Relaxed);
        match ev.event {
            EventType::ButtonPressed(b, _) | EventType::ButtonReleased(b, _) => {
                if gated {
                    continue;
                }
                let down = matches!(ev.event, EventType::ButtonPressed(..));
                let Some(web) = web_index(b) else { continue };
                let held = HELD_AT_RESUME.load(Ordering::Relaxed);
                if held & (1 << web) != 0 {
                    // Suppressed since the menu closed. Its release is what frees
                    // it — and is itself swallowed, so the core never sees half
                    // of a press it was never given.
                    if !down {
                        HELD_AT_RESUME.fetch_and(!(1 << web), Ordering::Relaxed);
                    }
                    continue;
                }
                if let Some(id) = retro_id_for(web) {
                    press(id, down);
                }
            }
            EventType::AxisChanged(Axis::LeftStickX, v, _) => {
                if !gated {
                    PAD_AX.store((v * 32767.0) as i16, Ordering::Relaxed);
                }
            }
            EventType::AxisChanged(Axis::LeftStickY, v, _) => {
                if !gated {
                    // libretro analog Y is positive-down
                    PAD_AY.store((-v * 32767.0) as i16, Ordering::Relaxed);
                }
            }
            EventType::AxisChanged(Axis::RightStickX, v, _) => {
                if !gated {
                    PAD_RX.store((v * 32767.0) as i16, Ordering::Relaxed);
                }
            }
            EventType::AxisChanged(Axis::RightStickY, v, _) => {
                if !gated {
                    PAD_RY.store((-v * 32767.0) as i16, Ordering::Relaxed);
                }
            }
            _ => {}
        }
    }
}

pub unsafe extern "C" fn input_poll() {}

pub unsafe extern "C" fn input_state(port: c_uint, device: c_uint, index: c_uint, id: c_uint) -> i16 {
    if port != 0 {
        return 0;
    }
    match device {
        DEVICE_JOYPAD => ((PAD_BITS.load(Ordering::Relaxed) >> id) & 1) as i16 * 0x7fff_u16 as i16,
        DEVICE_ANALOG if index == ANALOG_LEFT => match id {
            ANALOG_X => PAD_AX.load(Ordering::Relaxed),
            ANALOG_Y => PAD_AY.load(Ordering::Relaxed),
            _ => 0,
        },
        DEVICE_ANALOG if index == ANALOG_RIGHT => match id {
            ANALOG_X => PAD_RX.load(Ordering::Relaxed),
            ANALOG_Y => PAD_RY.load(Ordering::Relaxed),
            _ => 0,
        },
        _ => 0,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // The pad snapshot is process-wide state; cargo runs tests in parallel
    // threads, so every test that touches it takes this lock.
    static PAD_TEST_LOCK: Mutex<()> = Mutex::new(());

    #[test]
    fn the_default_table_never_maps_the_menu_button() {
        assert_eq!(default_retro_id(9), None);
    }

    #[test]
    fn default_table_matches_the_spike_mapping() {
        assert_eq!(default_retro_id(0), Some(JOYPAD_B));
        assert_eq!(default_retro_id(1), Some(JOYPAD_A));
        assert_eq!(default_retro_id(6), Some(JOYPAD_L2)); // N64 Z
        assert_eq!(default_retro_id(12), Some(JOYPAD_UP));
    }

    #[test]
    fn gating_zeroes_and_blocks_nothing_synthetic() {
        let _lock = PAD_TEST_LOCK.lock().unwrap();
        set_gated(true);
        assert_eq!(PAD_BITS.load(Ordering::Relaxed), 0);
        press(JOYPAD_START, true); // synthetic presses bypass the gate
        assert_ne!(PAD_BITS.load(Ordering::Relaxed), 0);
        press(JOYPAD_START, false);
        set_gated(false);
    }

    #[test]
    fn analog_halves_follow_the_retropad_contract() {
        let _lock = PAD_TEST_LOCK.lock().unwrap();
        // retropad.js: 16 = LX_PLUS (stick right, positive X).
        analog(16, 32767);
        assert_eq!(PAD_AX.load(Ordering::Relaxed), 32767);
        analog(17, 32767);
        assert_eq!(PAD_AX.load(Ordering::Relaxed), -32767);
        // 18 = LY_PLUS = down, which IS positive in libretro's Y convention.
        analog(18, 12000);
        assert_eq!(PAD_AY.load(Ordering::Relaxed), 12000);
        analog(19, 12000);
        assert_eq!(PAD_AY.load(Ordering::Relaxed), -12000);
        // 20-23: the right stick — the N64's C-buttons.
        analog(20, 9000);
        assert_eq!(PAD_RX.load(Ordering::Relaxed), 9000);
        analog(23, 9000);
        assert_eq!(PAD_RY.load(Ordering::Relaxed), -9000);
        for i in [16, 18, 20, 23] {
            analog(i, 0);
        }
    }

    #[test]
    fn the_right_stick_serves_the_analog_right_index() {
        let _lock = PAD_TEST_LOCK.lock().unwrap();
        analog(20, 4242);
        unsafe {
            assert_eq!(input_state(0, DEVICE_ANALOG, ANALOG_RIGHT, ANALOG_X), 4242);
            assert_eq!(input_state(0, DEVICE_ANALOG, ANALOG_LEFT, ANALOG_X), 0);
        }
        analog(20, 0);
    }
}
