// Mode 1: the shell is deliberately empty — one webview window over the built
// frontend, everything else (library, metadata, saves) over HTTP to the
// self-hosted backend. Native commands arrive with the Phase-2 player.
pub fn run() {
    tauri::Builder::default()
        .run(tauri::generate_context!())
        .expect("error while running the app");
}
