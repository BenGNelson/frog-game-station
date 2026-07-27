// Mode 1+: one webview window over the built frontend — library, metadata, and
// saves ride HTTP to the self-hosted backend — with the native player's GL
// stage composited underneath (Phase 2a). `probe` is the standalone §8.2
// compositing proof, armed only via FROG_NATIVE_PROBE=1.
mod emu;
mod probe;

pub fn run() {
    tauri::Builder::default()
        .manage(emu::EmuState::default())
        .invoke_handler(tauri::generate_handler![
            emu::commands::load_game,
            emu::commands::stop_game,
            emu::commands::set_paused,
            emu::commands::reset_game,
            emu::commands::set_input_gated,
            emu::commands::set_bindings,
            emu::commands::clear_bindings,
            emu::commands::press_input,
            emu::commands::set_analog,
            emu::commands::set_volume,
            emu::commands::set_fast_forward,
            emu::commands::save_state,
            emu::commands::load_state,
            emu::commands::get_sram,
            emu::commands::load_sram,
            emu::commands::screenshot,
        ])
        .setup(|app| {
            probe::maybe_arm(app);
            probe::maybe_nav(app);
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running the app");
}
