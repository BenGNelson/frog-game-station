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

/// The managed Tauri state: at most one running session.
pub struct EmuState(pub Mutex<Option<session::SessionHandle>>);

impl Default for EmuState {
    fn default() -> Self {
        EmuState(Mutex::new(None))
    }
}
