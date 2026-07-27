// The native emulator host — the spike (spike/, rows 3–4) grown into library
// code. One session at a time; the session thread owns the core and the GL
// surface (session.rs), and the Tauri command layer (commands.rs) is the only
// way in or out.

pub mod audio;
pub mod commands;
pub mod cores;
pub mod input;
#[allow(dead_code)]
pub mod libretro;
pub mod options;
pub mod rom;
pub mod session;

use std::sync::Mutex;

/// The managed Tauri state: at most one running session. `load_lock`
/// serializes whole load_game calls — without it, a rapid relaunch (React's
/// dev double-mount, a double-click) can interleave two boots and leak the
/// loser's thread and stage view.
pub struct EmuState {
    pub session: Mutex<Option<session::SessionHandle>>,
    pub load_lock: tauri::async_runtime::Mutex<()>,
    // One held window-close per game: the first close with a live session is
    // intercepted for the SRAM flush; a second always passes through. Re-armed
    // by each load_game so every session gets its own guarded close.
    pub close_flush_armed: std::sync::atomic::AtomicBool,
}

impl Default for EmuState {
    fn default() -> Self {
        EmuState {
            session: Mutex::new(None),
            load_lock: tauri::async_runtime::Mutex::new(()),
            close_flush_armed: std::sync::atomic::AtomicBool::new(false),
        }
    }
}
