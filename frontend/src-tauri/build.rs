fn main() {
    // The C-variadic retro_log target (stable Rust can't define one).
    cc::Build::new().file("src/emu/log_shim.c").compile("logshim");
    tauri_build::build()
}
