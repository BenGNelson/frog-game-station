// Keep release builds from opening a console window alongside the app on Windows.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    frog_game_station_desktop_lib::run()
}
