// Mode 1+: one webview window over the built frontend — library, metadata, and
// saves ride HTTP to the self-hosted backend — with the native player's GL
// stage composited underneath (Phase 2a). `probe` is the standalone §8.2
// compositing proof, armed only via FROG_NATIVE_PROBE=1.
mod probe;

pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            probe::maybe_arm(app);
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running the app");
}
