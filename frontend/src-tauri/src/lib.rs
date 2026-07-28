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
            emu::commands::set_pointer,
            emu::commands::set_volume,
            emu::commands::set_rewinding,
            emu::commands::set_fullscreen,
            emu::commands::is_fullscreen,
            emu::commands::set_fast_forward,
            emu::commands::save_state,
            emu::commands::load_state,
            emu::commands::get_sram,
            emu::commands::load_sram,
            emu::commands::screenshot,
            emu::commands::close_window,
        ])
        .setup(|app| {
            use tauri::{Emitter, Manager};
            if let Some(window) = app.get_webview_window("main") {
                let handle = app.handle().clone();
                // ONE listener for the app's lifetime — registering per launch
                // would stack a forwarder per game played.
                window.on_window_event(move |event| match event {
                    tauri::WindowEvent::Resized(size) => {
                        let tx = handle
                            .state::<emu::EmuState>()
                            .session
                            .lock()
                            .ok()
                            .and_then(|g| g.as_ref().map(|h| h.tx.clone()));
                        if let Some(tx) = tx {
                            let _ = tx.send(emu::session::EmuCmd::Resize(size.width, size.height));
                        }
                    }
                    // The window-close SRAM backstop: a live game's final save
                    // read must be exact, and the webview can't run its flush
                    // after the window dies. Hold the FIRST close, tell the
                    // player to flush-and-quit (it calls close_window when
                    // done); a second click passes through regardless, so a
                    // broken webview can never trap the window open.
                    tauri::WindowEvent::CloseRequested { api, .. } => {
                        let state = handle.state::<emu::EmuState>();
                        let live = state.session.lock().ok().map(|g| g.is_some()).unwrap_or(false);
                        if live && !state.close_flush_armed.swap(true, std::sync::atomic::Ordering::Relaxed) {
                            api.prevent_close();
                            let _ = handle.emit("native:close-requested", serde_json::json!({}));
                        }
                    }
                    _ => {}
                });
            }
            probe::maybe_arm(app);
            probe::maybe_nav(app);
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running the app");
}
