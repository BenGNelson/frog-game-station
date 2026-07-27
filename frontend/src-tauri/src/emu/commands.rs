// The Tauri command/event contract — the row-6 deliverable. Everything the
// NativePlayer can ask of the host, and nothing else. Byte-heavy responses
// (states, SRAM, screenshots) ride tauri::ipc::Response — raw bytes into an
// ArrayBuffer, never JSON arrays; byte-heavy arguments arrive as the raw
// invoke body (a Uint8Array on the JS side).
//
// Threading: each command either pokes an atomic (input) or sends an EmuCmd
// down the session channel; the byte-returning ones carry a one-shot reply
// channel and block on it inside spawn_blocking, with a timeout so a wedged
// core surfaces as an error instead of a hung invoke.

use super::{audio, cores, input, rom, session, EmuState};
use serde::Deserialize;
use std::sync::mpsc;
use std::time::Duration;
use tauri::ipc::{InvokeBody, Request, Response};
use tauri::Manager;

const REPLY_TIMEOUT: Duration = Duration::from_secs(10);

fn send(state: &EmuState, cmd: session::EmuCmd) -> Result<(), String> {
    let guard = state.session.lock().unwrap();
    let handle = guard.as_ref().ok_or("no game running")?;
    handle.tx.send(cmd).map_err(|_| "the emulator thread is gone".to_string())
}

/// Send a command carrying a reply channel and wait (off the async runtime).
async fn ask<T: Send + 'static>(
    state: tauri::State<'_, EmuState>,
    make: impl FnOnce(mpsc::Sender<Result<T, String>>) -> session::EmuCmd,
) -> Result<T, String> {
    let (reply_tx, reply_rx) = mpsc::channel();
    send(&state, make(reply_tx))?;
    tauri::async_runtime::spawn_blocking(move || {
        reply_rx
            .recv_timeout(REPLY_TIMEOUT)
            .map_err(|_| "the emulator did not answer in time".to_string())?
    })
    .await
    .map_err(|e| e.to_string())?
}

fn body_bytes(request: Request<'_>) -> Result<Vec<u8>, String> {
    match request.body() {
        InvokeBody::Raw(bytes) => Ok(bytes.clone()),
        _ => Err("expected a raw byte body".into()),
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LoadGameArgs {
    pub game_id: String,
    pub rom_url: String,
    pub core: String,
    pub system: String,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LoadGameReply {
    pub av: session::AvInfoJs,
    /// This session's launch token — stop_game with it only stops THIS
    /// session, so a stale, cancelled boot can never reap a newer one.
    pub generation: u64,
}

static GEN: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);

#[tauri::command]
pub async fn load_game(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    state: tauri::State<'_, EmuState>,
    args: LoadGameArgs,
) -> Result<LoadGameReply, String> {
    // Whole-call serialization: without it a rapid relaunch (React's dev
    // double-mount, a double-click) interleaves two boots and the loser leaks
    // its thread and stage view.
    let _loading = state.load_lock.lock().await;
    // One session at a time — a second launch stops the first.
    stop_game_inner(&app, &state, None).await?;
    let generation = GEN.fetch_add(1, std::sync::atomic::Ordering::Relaxed) + 1;

    let core_path = cores::resolve(&args.core)?;
    let cache_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("rom-cache");
    let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("emu-data")
        .to_string_lossy()
        .into_owned();

    let rom_url = args.rom_url.clone();
    let game_id = args.game_id.clone();
    let (rom_path, rom_bytes) = tauri::async_runtime::spawn_blocking(move || {
        rom::fetch(&rom_url, &cache_dir, &game_id)
    })
    .await
    .map_err(|e| e.to_string())??;

    // AppKit on the main thread: the GL stage slides under the webview.
    let size = window.inner_size().map_err(|e| e.to_string())?;
    let (view_tx, view_rx) = mpsc::channel();
    {
        let window = window.clone();
        window
            .clone()
            .run_on_main_thread(move || {
                let view = unsafe { stage::insert(&window) };
                let _ = view_tx.send(view);
            })
            .map_err(|e| e.to_string())?;
    }
    let ns_view = tauri::async_runtime::spawn_blocking(move || {
        view_rx
            .recv_timeout(Duration::from_secs(5))
            .map_err(|_| "main thread did not create the GL stage".to_string())?
    })
    .await
    .map_err(|e| e.to_string())??;

    let (boot_tx, boot_rx) = mpsc::channel();
    let handle = session::spawn(
        app.clone(),
        session::StartParams {
            core_path: core_path.to_string_lossy().into_owned(),
            rom_path: rom_path.to_string_lossy().into_owned(),
            rom_bytes,
            system: args.system,
            data_dir,
            ns_view,
            width: size.width,
            height: size.height,
        },
        boot_tx,
        generation,
    );
    let resize_tx = handle.tx.clone();
    *state.session.lock().unwrap() = Some(handle);

    // Forward window resizes into the session for the rest of its life (a
    // dead session just ignores the sends).
    window.on_window_event(move |event| {
        if let tauri::WindowEvent::Resized(size) = event {
            let _ = resize_tx.send(session::EmuCmd::Resize(size.width, size.height));
        }
    });

    let booted = tauri::async_runtime::spawn_blocking(move || {
        boot_rx
            .recv_timeout(Duration::from_secs(30))
            .map_err(|_| "the core did not boot in time".to_string())?
    })
    .await
    .map_err(|e| e.to_string())?;

    match booted {
        Ok(av) => Ok(LoadGameReply { av, generation }),
        Err(e) => {
            // Boot failed — reap the session and the stage.
            stop_game_inner(&app, &state, Some(generation)).await.ok();
            Err(e)
        }
    }
}

async fn stop_game_inner(
    app: &tauri::AppHandle,
    state: &tauri::State<'_, EmuState>,
    only_generation: Option<u64>,
) -> Result<(), String> {
    let handle = {
        let mut guard = state.session.lock().unwrap();
        match (&*guard, only_generation) {
            // A generation-scoped stop for a session that is no longer
            // current (or none at all) is a no-op, not an error.
            (Some(h), Some(want)) if h.generation != want => return Ok(()),
            (None, _) => return Ok(()),
            _ => guard.take(),
        }
    };
    let Some(mut handle) = handle else { return Ok(()) };
    let _ = handle.tx.send(session::EmuCmd::Stop);
    if let Some(join) = handle.join.take() {
        let _ = tauri::async_runtime::spawn_blocking(move || {
            let _ = join.join();
        })
        .await;
    }
    let ns_view = handle.ns_view;
    if ns_view != 0 {
        if let Some(window) = app.get_webview_window("main") {
            let _ = window.run_on_main_thread(move || unsafe { stage::remove(ns_view) });
        }
    }
    Ok(())
}

#[tauri::command]
pub async fn stop_game(
    app: tauri::AppHandle,
    state: tauri::State<'_, EmuState>,
    generation: Option<u64>,
) -> Result<(), String> {
    stop_game_inner(&app, &state, generation).await
}

#[tauri::command]
pub fn set_paused(state: tauri::State<'_, EmuState>, paused: bool) -> Result<(), String> {
    send(&state, session::EmuCmd::SetPaused(paused))
}

#[tauri::command]
pub fn reset_game(state: tauri::State<'_, EmuState>) -> Result<(), String> {
    send(&state, session::EmuCmd::Reset)
}

#[tauri::command]
pub fn set_input_gated(gated: bool) {
    input::set_gated(gated);
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BindingEntry {
    pub web_button: u8,
    pub retro: Option<u8>,
}

#[tauri::command]
pub fn set_bindings(entries: Vec<BindingEntry>) {
    // Web-index-addressed table; the app's menu button (web 9) never maps.
    let mut table: Vec<Option<std::os::raw::c_uint>> = vec![None; 16];
    for e in entries {
        if e.web_button == 9 {
            continue;
        }
        if let Some(slot) = table.get_mut(e.web_button as usize) {
            *slot = e.retro.map(|r| r as std::os::raw::c_uint);
        }
    }
    *input::REMAP.lock().unwrap() = Some(table);
}

#[tauri::command]
pub fn clear_bindings() {
    *input::REMAP.lock().unwrap() = None;
}

#[tauri::command]
pub fn press_input(index: u32, down: bool) {
    input::press(index, down);
}

#[tauri::command]
pub fn set_analog(index: u32, value: u16) {
    input::analog(index, value);
}

#[tauri::command]
pub fn set_volume(level: f32) {
    audio::set_gain(level);
}

#[tauri::command]
pub fn set_fast_forward(state: tauri::State<'_, EmuState>, on: bool, ratio: String) -> Result<(), String> {
    send(&state, session::EmuCmd::SetFastForward { on, ratio })
}

#[tauri::command]
pub async fn save_state(state: tauri::State<'_, EmuState>) -> Result<Response, String> {
    ask(state, session::EmuCmd::SaveState).await.map(Response::new)
}

#[tauri::command]
pub async fn load_state(state: tauri::State<'_, EmuState>, request: Request<'_>) -> Result<(), String> {
    let bytes = body_bytes(request)?;
    ask(state, move |reply| session::EmuCmd::LoadState(bytes, reply)).await
}

#[tauri::command]
pub async fn get_sram(state: tauri::State<'_, EmuState>) -> Result<Response, String> {
    ask(state, session::EmuCmd::GetSram).await.map(Response::new)
}

#[tauri::command]
pub async fn load_sram(state: tauri::State<'_, EmuState>, request: Request<'_>) -> Result<(), String> {
    let bytes = body_bytes(request)?;
    ask(state, move |reply| session::EmuCmd::LoadSram(bytes, reply)).await
}

#[tauri::command]
pub async fn screenshot(state: tauri::State<'_, EmuState>) -> Result<Response, String> {
    ask(state, session::EmuCmd::Screenshot).await.map(Response::new)
}

// ---------- the GL stage NSView (macOS) ----------

#[cfg(target_os = "macos")]
mod stage {
    use objc2::rc::Retained;
    use objc2_app_kit::{NSAutoresizingMaskOptions, NSView, NSWindowOrderingMode};
    use objc2_foundation::MainThreadMarker;

    /// Create the GL stage under the webview. Main thread only.
    /// Returns the retained NSView pointer (as usize) or 0 on failure.
    pub unsafe fn insert(window: &tauri::WebviewWindow) -> Result<usize, String> {
        let mtm = MainThreadMarker::new().ok_or("not on the main thread")?;
        let content = window.ns_view().map_err(|e| e.to_string())? as *mut NSView;
        let content = &*content;
        let view = NSView::initWithFrame(mtm.alloc(), content.bounds());
        view.setAutoresizingMask(
            NSAutoresizingMaskOptions::ViewWidthSizable | NSAutoresizingMaskOptions::ViewHeightSizable,
        );
        #[allow(deprecated)]
        view.setWantsBestResolutionOpenGLSurface(true);
        content.addSubview_positioned_relativeTo(&view, NSWindowOrderingMode::Below, None);
        // The superview retains it; hand back a +1 we release in remove().
        Ok(Retained::into_raw(view) as usize)
    }

    /// Pull the stage back out. Main thread only.
    pub unsafe fn remove(ns_view: usize) {
        if ns_view == 0 {
            return;
        }
        let view: Retained<NSView> = Retained::from_raw(ns_view as *mut NSView).unwrap();
        view.removeFromSuperview();
    }
}

#[cfg(not(target_os = "macos"))]
mod stage {
    pub unsafe fn insert(_window: &tauri::WebviewWindow) -> Result<usize, String> {
        Err("the native player targets macOS in Phase 2a".into())
    }
    pub unsafe fn remove(_ns_view: usize) {}
}
