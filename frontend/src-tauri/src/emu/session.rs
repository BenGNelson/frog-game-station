// The emulation session: one game, one thread, one GL surface.
//
// The thread owns everything volatile — the dlopen'd core, the GL context
// (created and current HERE, never on main; the probe proved CGL is happy
// off-main), the pacing accumulator, gilrs, the cpal stream — and speaks to
// the outside world through exactly two channels: EmuCmd in (mpsc from the
// Tauri commands), events out (app.emit). The main thread's only jobs are
// AppKit: slide the GL NSView under the webview before the thread starts,
// pull it out after the thread joins.
//
// Contracts preserved verbatim from the validated spike:
//  - pacing: the core's own fps, accumulator (`next += period`), 250ms stall
//    resync, vsync OFF (manual pacing), fast-forward = unpaced batch
//  - HW render: FBO complete → HW_FBO.store → context_reset, in that order,
//    after the GL context and during/after retro_load_game
//  - teardown: context_destroy → unload_game → deinit, then the NSView
//  - GET_VARIABLE answered for every registered option, from leaked CStrings

use super::{audio, input, libretro::*, options};
use glow::HasContext;
use serde::Serialize;
use std::ffi::{CStr, CString};
use std::os::raw::{c_char, c_uint, c_void};
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::mpsc::{Receiver, Sender};
use std::sync::Mutex;
use std::time::{Duration, Instant};
use tauri::Emitter;

// ---------- state shared with the C callbacks (emu-thread only) ----------

struct VideoState {
    pixel_format: c_uint,
    frames: u64,
    hw_frame: bool,
    dirty: bool,
    width: u32,
    height: u32,
    last_frame: Vec<u8>,
}

static VIDEO: Mutex<VideoState> = Mutex::new(VideoState {
    pixel_format: PIXFMT_0RGB1555,
    frames: 0,
    hw_frame: false,
    dirty: false,
    width: 0,
    height: 0,
    last_frame: Vec::new(),
});

struct HwInfo {
    context_reset: HwContextResetFn,
    context_destroy: Option<HwContextResetFn>,
    depth: bool,
    stencil: bool,
    bottom_left: bool,
}
static HW: Mutex<Option<HwInfo>> = Mutex::new(None);
static HW_FBO: AtomicUsize = AtomicUsize::new(0);
static HW_ACTIVE: AtomicBool = AtomicBool::new(false);
// The display filter, as an index into shader::Filter. An atomic because the
// command thread sets it and the emu thread reads it every present.
static FILTER: AtomicUsize = AtomicUsize::new(0);

pub fn set_filter(id: &str) {
    use crate::emu::shader::Filter;
    let f = match Filter::from_id(id) {
        Filter::Off => 0,
        Filter::Smooth => 1,
        Filter::Crt => 2,
        Filter::CrtCurve => 3,
    };
    FILTER.store(f, Ordering::Relaxed);
}

fn current_filter() -> crate::emu::shader::Filter {
    use crate::emu::shader::Filter;
    match FILTER.load(Ordering::Relaxed) {
        1 => Filter::Smooth,
        2 => Filter::Crt,
        3 => Filter::CrtCurve,
        _ => Filter::Off,
    }
}

// The system/save dir handed to the core (leaked once; absolute app-data path
// set per session before retro_init — the spike's CWD-relative "spike_data"
// would break under an .app bundle).
static DATA_DIR_PTR: AtomicUsize = AtomicUsize::new(0);

thread_local! {
    // get_proc_address target. Emu-thread only: GL init and every retro_run
    // happen here, so the core can never ask from anywhere else.
    static GL_DISPLAY: std::cell::RefCell<Option<glutin::display::Display>> =
        const { std::cell::RefCell::new(None) };
}

#[repr(C)]
struct LogCallback {
    log: unsafe extern "C" fn(),
}
extern "C" {
    fn frog_spike_log(); // emu/log_shim.c — the C-variadic retro_log target
}

// ---------- libretro callbacks ----------

unsafe extern "C" fn environment(cmd: c_uint, data: *mut c_void) -> bool {
    match cmd {
        ENV_GET_CAN_DUPE => {
            *(data as *mut bool) = true;
            true
        }
        ENV_SET_PIXEL_FORMAT => {
            VIDEO.lock().unwrap().pixel_format = *(data as *const c_uint);
            true
        }
        ENV_GET_SYSTEM_DIRECTORY | ENV_GET_SAVE_DIRECTORY => {
            let ptr = DATA_DIR_PTR.load(Ordering::Relaxed);
            if ptr == 0 {
                return false;
            }
            *(data as *mut *const c_char) = ptr as *const c_char;
            true
        }
        ENV_GET_LOG_INTERFACE => {
            (*(data as *mut LogCallback)).log = frog_spike_log;
            true
        }
        ENV_GET_AUDIO_VIDEO_ENABLE => {
            // bit 0 = video, bit 1 = audio; declining reads as "audio off" to
            // some cores (mupen64plus_next went fully silent).
            *(data as *mut i32) = 3;
            true
        }
        ENV_GET_PREFERRED_HW_RENDER => {
            *(data as *mut c_uint) = HW_CONTEXT_OPENGL_CORE;
            true
        }
        ENV_SET_VARIABLES => {
            let mut vars = data as *const RetroVariable;
            while !(*vars).key.is_null() {
                let key = CStr::from_ptr((*vars).key).to_string_lossy().into_owned();
                let desc = CStr::from_ptr((*vars).value).to_string_lossy().into_owned();
                options::register(&key, &desc);
                vars = vars.add(1);
            }
            true
        }
        ENV_GET_VARIABLE => {
            let var = &mut *(data as *mut RetroVariable);
            let key = CStr::from_ptr(var.key).to_string_lossy().into_owned();
            // Declining is correct ONLY for a key we never saw registered — see
            // the mupen64plus-abort note in options.rs.
            match options::value_ptr(&key) {
                Some(ptr) => {
                    var.value = ptr as *const c_char;
                    true
                }
                None => false,
            }
        }
        ENV_GET_VARIABLE_UPDATE => {
            // True exactly ONCE per change. Always-true has melonDS rebuild its
            // renderer every frame; always-false (what this was) means a changed
            // option is never picked up at all.
            *(data as *mut bool) = options::take_update();
            true
        }
        ENV_SET_HW_RENDER => {
            let cb = &mut *(data as *mut HwRenderCallback);
            if cb.context_type != HW_CONTEXT_OPENGL && cb.context_type != HW_CONTEXT_OPENGL_CORE {
                return false;
            }
            cb.get_current_framebuffer = Some(get_current_framebuffer);
            cb.get_proc_address = Some(get_proc_address);
            *HW.lock().unwrap() = Some(HwInfo {
                context_reset: cb.context_reset.expect("core must provide context_reset"),
                context_destroy: cb.context_destroy,
                depth: cb.depth,
                stencil: cb.stencil,
                bottom_left: cb.bottom_left_origin,
            });
            true
        }
        _ => false,
    }
}

unsafe extern "C" fn get_current_framebuffer() -> usize {
    HW_FBO.load(Ordering::Relaxed)
}

unsafe extern "C" fn get_proc_address(sym: *const c_char) -> *const c_void {
    GL_DISPLAY.with(|d| match d.borrow().as_ref() {
        Some(display) => {
            use glutin::display::GlDisplay;
            display.get_proc_address(CStr::from_ptr(sym)) as *const c_void
        }
        None => std::ptr::null(),
    })
}

unsafe extern "C" fn video_refresh(data: *const c_void, width: c_uint, height: c_uint, pitch: usize) {
    let mut v = VIDEO.lock().unwrap();
    v.frames += 1;
    v.width = width;
    v.height = height;
    if data == HW_FRAME_BUFFER_VALID {
        v.hw_frame = true;
        return;
    }
    if data.is_null() {
        return; // dupe — previous frame still valid
    }
    let bpp = if v.pixel_format == PIXFMT_XRGB8888 { 4 } else { 2 };
    let row_bytes = width as usize * bpp;
    v.last_frame.clear();
    for y in 0..height as usize {
        let row = std::slice::from_raw_parts((data as *const u8).add(y * pitch), row_bytes);
        v.last_frame.extend_from_slice(row);
    }
    v.hw_frame = false;
    v.dirty = true;
}

// ---------- the public surface ----------

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AvInfoJs {
    pub width: u32,
    pub height: u32,
    pub max_width: u32,
    pub max_height: u32,
    pub fps: f64,
    pub sample_rate: f64,
    pub aspect: f32,
}

pub enum EmuCmd {
    SetPaused(bool),
    SetRewinding(bool),
    Reset,
    SaveState(Sender<Result<Vec<u8>, String>>),
    LoadState(Vec<u8>, Sender<Result<(), String>>),
    GetSram(Sender<Result<Vec<u8>, String>>),
    LoadSram(Vec<u8>, Sender<Result<(), String>>),
    Screenshot(Sender<Result<Vec<u8>, String>>),
    SetFastForward { on: bool, ratio: String },
    /// Change one core option. Routed through the channel rather than done on
    /// the command thread so the pointer swap lands BETWEEN frames — never
    /// while the core is inside retro_run reading the pointer being replaced.
    SetOption {
        key: String,
        value: String,
        reply: Sender<Result<(), String>>,
    },
    Resize(u32, u32),
    Stop,
}

pub struct SessionHandle {
    pub tx: Sender<EmuCmd>,
    pub join: Option<std::thread::JoinHandle<()>>,
    pub ns_view: usize,
    // Which launch this is. A stale stop (React's dev double-mount resolves
    // its first, cancelled boot AFTER the second one started) must be able to
    // say which session it means — otherwise it reaps the fresh one.
    pub generation: u64,
}

pub struct StartParams {
    pub core_path: String,
    pub rom_path: String,
    pub system: String,
    /// The player's saved core-option choices for this system. Applied before
    /// retro_init, which is the only moment SET_VARIABLES can consult them.
    pub options: Vec<(String, String)>,
    pub data_dir: String,
    pub ns_view: usize,
    pub width: u32,
    pub height: u32,
}

/// Spawn the emu thread. Resolves through `boot_tx` once the core is running
/// (or refuses); the thread then serves commands until Stop / channel close.
pub fn spawn(
    app: tauri::AppHandle,
    params: StartParams,
    boot_tx: Sender<Result<AvInfoJs, String>>,
    generation: u64,
) -> SessionHandle {
    let (tx, rx) = std::sync::mpsc::channel::<EmuCmd>();
    let ns_view = params.ns_view;
    let join = std::thread::Builder::new()
        .name("frog-emu".into())
        .spawn(move || run_session(app, params, rx, boot_tx))
        .expect("spawn emu thread");
    SessionHandle { tx, join: Some(join), ns_view, generation }
}

// ---------- the thread body ----------

struct Gl {
    context: glutin::context::PossiblyCurrentContext,
    surface: glutin::surface::Surface<glutin::surface::WindowSurface>,
    gl: glow::Context,
    sw_texture: glow::Texture,
    sw_fbo: glow::Framebuffer,
    hw_fbo: Option<glow::Framebuffer>,
    // The core's own render target, kept because the filter samples it as a
    // texture — a framebuffer alone can only be blitted.
    hw_texture: Option<glow::Texture>,
    filter_stage: Option<crate::emu::shader::FilterStage>,
    win_w: u32,
    win_h: u32,
}

fn init_gl(ns_view: usize, width: u32, height: u32) -> Result<Gl, String> {
    use glutin::config::ConfigTemplateBuilder;
    use glutin::context::{ContextApi, ContextAttributesBuilder, Version};
    use glutin::display::{Display, DisplayApiPreference, GlDisplay};
    use glutin::prelude::{GlSurface, NotCurrentGlContext};
    use glutin::surface::{SurfaceAttributesBuilder, SwapInterval, WindowSurface};
    use raw_window_handle::{AppKitDisplayHandle, AppKitWindowHandle, RawDisplayHandle, RawWindowHandle};
    use std::num::NonZeroU32;

    // Phase 2a targets macOS; Windows/Linux get their own display/surface plumbing
    // when Phase 4 takes the app cross-platform. Everything else in this module —
    // the core, options, audio, input, pacing, saves — is already portable and
    // compiles (and unit-tests) everywhere, which is what keeps the CI gate honest.
    #[cfg(not(target_os = "macos"))]
    {
        let _ = (ns_view, width, height);
        return Err("the native player runs on macOS in this release".into());
    }

    #[cfg(target_os = "macos")]
    unsafe {
        let raw_display = RawDisplayHandle::AppKit(AppKitDisplayHandle::new());
        let api = DisplayApiPreference::Cgl;

        let display = Display::new(raw_display, api).map_err(|e| format!("gl display: {e}"))?;
        let config = display
            .find_configs(ConfigTemplateBuilder::new().with_depth_size(24).with_stencil_size(8).build())
            .map_err(|e| format!("gl configs: {e}"))?
            .next()
            .ok_or("no GL config")?;
        let rwh = RawWindowHandle::AppKit(AppKitWindowHandle::new(
            std::ptr::NonNull::new(ns_view as *mut _).ok_or("null ns_view")?,
        ));
        let surface = display
            .create_window_surface(
                &config,
                &SurfaceAttributesBuilder::<WindowSurface>::new().build(
                    rwh,
                    NonZeroU32::new(width.max(1)).unwrap(),
                    NonZeroU32::new(height.max(1)).unwrap(),
                ),
            )
            .map_err(|e| format!("gl surface: {e}"))?;
        let context = display
            .create_context(
                &config,
                &ContextAttributesBuilder::new()
                    .with_context_api(ContextApi::OpenGl(Some(Version::new(3, 3))))
                    .build(Some(rwh)),
            )
            .map_err(|e| format!("gl context: {e}"))?
            .make_current(&surface)
            .map_err(|e| format!("make_current: {e}"))?;
        surface.set_swap_interval(&context, SwapInterval::DontWait).ok(); // manual pacing

        let gl = glow::Context::from_loader_function(|s| {
            display.get_proc_address(&CString::new(s).unwrap()) as *const _
        });
        eprintln!(
            "[emu] gl {:?} on {:?}",
            gl.get_parameter_string(glow::VERSION),
            gl.get_parameter_string(glow::RENDERER)
        );
        GL_DISPLAY.with(|d| *d.borrow_mut() = Some(display));

        let sw_texture = gl.create_texture().map_err(|e| e.to_string())?;
        let sw_fbo = gl.create_framebuffer().map_err(|e| e.to_string())?;
        let filter_stage = crate::emu::shader::FilterStage::new(&gl);
        Ok(Gl {
            context,
            surface,
            gl,
            sw_texture,
            sw_fbo,
            hw_fbo: None,
            hw_texture: None,
            filter_stage,
            win_w: width,
            win_h: height,
        })
    }
}

fn run_session(
    app: tauri::AppHandle,
    params: StartParams,
    rx: Receiver<EmuCmd>,
    boot_tx: Sender<Result<AvInfoJs, String>>,
) {
    // Fresh session: reset every static a previous game may have written.
    *VIDEO.lock().unwrap() = VideoState {
        pixel_format: PIXFMT_0RGB1555,
        frames: 0,
        hw_frame: false,
        dirty: false,
        width: 0,
        height: 0,
        last_frame: Vec::new(),
    };
    *HW.lock().unwrap() = None;
    HW_FBO.store(0, Ordering::Relaxed);
    HW_ACTIVE.store(false, Ordering::Relaxed);
    input::set_gated(false);
    input::PAD_BITS.store(0, Ordering::Relaxed);

    // The core's system/save dir: an absolute app-data path (leaked once per
    // process — sessions share it; the string never changes).
    if DATA_DIR_PTR.load(Ordering::Relaxed) == 0 {
        std::fs::create_dir_all(&params.data_dir).ok();
        let leaked = CString::new(params.data_dir.clone()).unwrap().into_raw();
        DATA_DIR_PTR.store(leaked as usize, Ordering::Relaxed);
    }

    let fail = |msg: String, boot_tx: &Sender<Result<AvInfoJs, String>>| {
        let _ = boot_tx.send(Err(msg.clone()));
        let _ = app.emit("native:error", serde_json::json!({ "message": msg }));
    };

    // GL first: SET_HW_RENDER arrives during retro_load_game and needs a
    // context to exist.
    let mut gl = match init_gl(params.ns_view, params.width, params.height) {
        Ok(g) => g,
        Err(e) => return fail(e, &boot_tx),
    };

    options::arm(&params.system, &params.options);
    let core = match Core::load(&params.core_path) {
        Ok(c) => c,
        Err(e) => return fail(format!("core load: {e}"), &boot_tx),
    };
    unsafe {
        if (core.api_version)() != API_VERSION {
            return fail("libretro API version mismatch".into(), &boot_tx);
        }
        (core.set_environment)(environment);
        (core.set_video_refresh)(video_refresh);
        (core.set_audio_sample)(audio::audio_sample);
        (core.set_audio_sample_batch)(audio::audio_sample_batch);
        (core.set_input_poll)(input::input_poll);
        (core.set_input_state)(input::input_state);
        (core.init)();
    }

    let path_c = CString::new(params.rom_path.as_str()).unwrap();
    let mut info = unsafe { std::mem::zeroed::<SystemInfo>() };
    unsafe { (core.get_system_info)(&mut info) };
    // Disc cores (PlayStation, and DS with some images) declare need_fullpath and
    // read the file themselves — handing them a buffer would mean holding a whole
    // disc in RAM for nothing. Everyone else gets the bytes.
    let rom_bytes: Vec<u8> = if info.need_fullpath {
        Vec::new()
    } else {
        match std::fs::read(&params.rom_path) {
            Ok(b) => b,
            Err(e) => {
                unsafe { (core.deinit)() };
                return fail(format!("could not read the ROM: {e}"), &boot_tx);
            }
        }
    };
    let game = GameInfo {
        path: path_c.as_ptr(),
        data: if info.need_fullpath {
            std::ptr::null()
        } else {
            rom_bytes.as_ptr() as *const c_void
        },
        size: rom_bytes.len(),
        meta: std::ptr::null(),
    };
    if !unsafe { (core.load_game)(&game) } {
        unsafe { (core.deinit)() };
        return fail("the core refused the ROM".into(), &boot_tx);
    }

    let mut av = unsafe { std::mem::zeroed::<SystemAvInfo>() };
    unsafe { (core.get_system_av_info)(&mut av) };

    // HW path: the core's render target, then context_reset — order matters.
    if HW.lock().unwrap().is_some() {
        let (max_w, max_h) = (av.geometry.max_width.max(640), av.geometry.max_height.max(480));
        unsafe {
            let fbo = gl.gl.create_framebuffer().unwrap();
            let color = gl.gl.create_texture().unwrap();
            gl.gl.bind_texture(glow::TEXTURE_2D, Some(color));
            gl.gl.tex_image_2d(
                glow::TEXTURE_2D, 0, glow::RGBA8 as i32, max_w as i32, max_h as i32,
                0, glow::RGBA, glow::UNSIGNED_BYTE, None,
            );
            gl.gl.tex_parameter_i32(glow::TEXTURE_2D, glow::TEXTURE_MIN_FILTER, glow::NEAREST as i32);
            gl.gl.tex_parameter_i32(glow::TEXTURE_2D, glow::TEXTURE_MAG_FILTER, glow::NEAREST as i32);
            gl.gl.bind_framebuffer(glow::FRAMEBUFFER, Some(fbo));
            gl.gl.framebuffer_texture_2d(glow::FRAMEBUFFER, glow::COLOR_ATTACHMENT0, glow::TEXTURE_2D, Some(color), 0);
            {
                let hw = HW.lock().unwrap();
                let hw = hw.as_ref().unwrap();
                if hw.depth || hw.stencil {
                    let rb = gl.gl.create_renderbuffer().unwrap();
                    gl.gl.bind_renderbuffer(glow::RENDERBUFFER, Some(rb));
                    gl.gl.renderbuffer_storage(glow::RENDERBUFFER, glow::DEPTH24_STENCIL8, max_w as i32, max_h as i32);
                    gl.gl.framebuffer_renderbuffer(
                        glow::FRAMEBUFFER,
                        if hw.stencil { glow::DEPTH_STENCIL_ATTACHMENT } else { glow::DEPTH_ATTACHMENT },
                        glow::RENDERBUFFER,
                        Some(rb),
                    );
                }
            }
            let status = gl.gl.check_framebuffer_status(glow::FRAMEBUFFER);
            if status != glow::FRAMEBUFFER_COMPLETE {
                (core.unload_game)();
                (core.deinit)();
                return fail(format!("core FBO incomplete: 0x{status:x}"), &boot_tx);
            }
            gl.gl.bind_framebuffer(glow::FRAMEBUFFER, None);
            gl.hw_fbo = Some(fbo);
            gl.hw_texture = Some(color);
            HW_FBO.store(fbo.0.get() as usize, Ordering::Relaxed);
            HW_ACTIVE.store(true, Ordering::Relaxed);
        }
        let reset = HW.lock().unwrap().as_ref().unwrap().context_reset;
        unsafe { reset() };
    }

    // Paint the stage black before the first core frame. The window is
    // transparent so the webview's chrome can float over the picture, which
    // means an undrawn GL surface shows the DESKTOP through the app — briefly,
    // between the boot screen going and the first frame arriving.
    unsafe {
        gl.gl.bind_framebuffer(glow::DRAW_FRAMEBUFFER, None);
        gl.gl.clear_color(0.0, 0.0, 0.0, 1.0);
        gl.gl.clear(glow::COLOR_BUFFER_BIT);
    }
    {
        use glutin::prelude::GlSurface;
        gl.surface.swap_buffers(&gl.context).ok();
    }

    let _audio_stream = audio::start(av.timing.sample_rate);
    let mut gilrs = gilrs::Gilrs::new().ok();

    let av_js = AvInfoJs {
        width: av.geometry.base_width,
        height: av.geometry.base_height,
        max_width: av.geometry.max_width,
        max_height: av.geometry.max_height,
        fps: av.timing.fps,
        sample_rate: av.timing.sample_rate,
        aspect: av.geometry.aspect_ratio,
    };
    if boot_tx.send(Ok(av_js.clone())).is_err() {
        // Caller gave up (timeout) — tear down rather than run a zombie.
        teardown(&core);
        return;
    }
    let _ = app.emit("native:booted", &av_js);
    let _ = app.emit("native:state", serde_json::json!({ "state": "running" }));

    // ---------- the loop ----------
    let frame_period = |fps: f64, ratio: &str| -> Duration {
        let base = 1.0 / fps.max(1.0);
        match ratio.parse::<f64>() {
            Ok(r) if r > 1.0 => Duration::from_secs_f64(base / r),
            _ => Duration::from_secs_f64(base),
        }
    };
    let mut paused = false;
    let mut ff_on = false;
    let mut ff_ratio = String::from("3.0");
    let mut next_frame = Instant::now();
    let mut frames_run: u64 = 0;
    let mut last_stats = Instant::now();
    let mut stats_frames: u64 = 0;
    // Rewind: a rolling ring of recent save states. Snapshots are taken every
    // REWIND_EVERY frames rather than every frame — ten a second is enough to
    // scrub back smoothly — and the ring is bounded by BYTES as well as time,
    // because a Game Boy state is a few hundred KB while a PlayStation state is
    // megabytes. So the depth is ~10s on the small systems and however much of
    // that fits in the budget on the big ones, instead of an unbounded promise.
    const REWIND_EVERY: u64 = 6;
    const REWIND_SECONDS: usize = 10;
    const REWIND_BUDGET: usize = 96 * 1024 * 1024;
    let rewind_max = (REWIND_SECONDS * 60) / REWIND_EVERY as usize;
    let mut rewind_ring: std::collections::VecDeque<Vec<u8>> = std::collections::VecDeque::new();
    let mut rewind_bytes: usize = 0;
    let mut rewinding = false;

    let mut last_sram_hash: u64 = 0;
    let mut stopping = false;
    let trace = std::env::var("FROG_EMU_TRACE").ok().as_deref() == Some("1");

    while !stopping {
        // Paused: block on the channel — a paused game costs zero CPU.
        let first = if paused {
            match rx.recv() {
                Ok(c) => Some(c),
                Err(_) => break,
            }
        } else {
            match rx.try_recv() {
                Ok(c) => Some(c),
                Err(std::sync::mpsc::TryRecvError::Empty) => None,
                Err(std::sync::mpsc::TryRecvError::Disconnected) => break,
            }
        };
        let mut pending = first;
        while let Some(cmd) = pending.take() {
            match cmd {
                EmuCmd::SetRewinding(on) => {
                    rewinding = on;
                    next_frame = Instant::now();
                }
                EmuCmd::SetPaused(p) => {
                    paused = p;
                    if !p {
                        next_frame = Instant::now();
                    }
                    let _ = app.emit(
                        "native:state",
                        serde_json::json!({ "state": if p { "paused" } else { "running" } }),
                    );
                }
                EmuCmd::Reset => unsafe { (core.reset)() },
                EmuCmd::SaveState(reply) => {
                    let out = unsafe {
                        let size = (core.serialize_size)();
                        let mut buf = vec![0u8; size];
                        if size > 0 && (core.serialize)(buf.as_mut_ptr() as *mut c_void, size) {
                            Ok(buf)
                        } else {
                            Err("the core returned an empty save state".into())
                        }
                    };
                    let _ = reply.send(out);
                }
                EmuCmd::LoadState(bytes, reply) => {
                    let ok = unsafe { (core.unserialize)(bytes.as_ptr() as *const c_void, bytes.len()) };
                    let _ = reply.send(if ok { Ok(()) } else { Err("state load failed".into()) });
                }
                EmuCmd::GetSram(reply) => {
                    let _ = reply.send(Ok(read_sram(&core)));
                }
                EmuCmd::LoadSram(bytes, reply) => {
                    let out = unsafe {
                        let size = (core.get_memory_size)(MEMORY_SAVE_RAM);
                        let data = (core.get_memory_data)(MEMORY_SAVE_RAM);
                        if data.is_null() || size == 0 {
                            Err("the core exposes no SRAM".into())
                        } else {
                            let n = bytes.len().min(size);
                            std::ptr::copy_nonoverlapping(bytes.as_ptr(), data as *mut u8, n);
                            Ok(())
                        }
                    };
                    last_sram_hash = fnv1a(&read_sram(&core));
                    let _ = reply.send(out);
                }
                EmuCmd::Screenshot(reply) => {
                    let _ = reply.send(screenshot(&gl));
                }
                EmuCmd::SetFastForward { on, ratio } => {
                    ff_on = on;
                    ff_ratio = ratio;
                    next_frame = Instant::now();
                }
                EmuCmd::SetOption { key, value, reply } => {
                    let _ = reply.send(options::set_value(&key, &value));
                }
                EmuCmd::Resize(w, h) => {
                    use glutin::prelude::GlSurface;
                    gl.win_w = w.max(1);
                    gl.win_h = h.max(1);
                    gl.surface.resize(
                        &gl.context,
                        std::num::NonZeroU32::new(gl.win_w).unwrap(),
                        std::num::NonZeroU32::new(gl.win_h).unwrap(),
                    );
                }
                EmuCmd::Stop => {
                    stopping = true;
                }
            }
            pending = rx.try_recv().ok();
        }
        if stopping || paused {
            continue;
        }

        if let Some(g) = gilrs.as_mut() {
            input::poll(g);
        }

        // Rewinding replaces the frame: pop the most recent snapshot and load
        // it. Runs at the snapshot rate rather than the frame rate, which is
        // what makes it look like time running backwards instead of a stutter.
        if rewinding {
            match rewind_ring.pop_back() {
                Some(state) => {
                    rewind_bytes = rewind_bytes.saturating_sub(state.len());
                    unsafe { (core.unserialize)(state.as_ptr() as *const c_void, state.len()) };
                }
                None => {
                    // Out of history — hold the oldest frame rather than
                    // silently running forward again under the player's thumb.
                    std::thread::sleep(Duration::from_millis(16));
                    present(&mut gl, &av);
                    continue;
                }
            }
            let now = Instant::now();
            if now < next_frame {
                std::thread::sleep(next_frame - now);
            }
            next_frame += Duration::from_secs_f64(1.0 / av.timing.fps.max(1.0)) * REWIND_EVERY as u32;
            present(&mut gl, &av);
            continue;
        }

        // Pace to the core's fps; 'unlimited' fast-forward runs an unpaced batch.
        if ff_on && ff_ratio == "unlimited" {
            for _ in 0..4 {
                unsafe { (core.run)() };
                frames_run += 1;
                stats_frames += 1;
            }
            next_frame = Instant::now();
        } else {
            let period = frame_period(av.timing.fps, if ff_on { &ff_ratio } else { "1" });
            let now = Instant::now();
            if now < next_frame {
                std::thread::sleep(next_frame - now);
            }
            unsafe { (core.run)() };
            frames_run += 1;
            stats_frames += 1;
            next_frame += period;
            if Instant::now() > next_frame + Duration::from_millis(250) {
                next_frame = Instant::now(); // resync after a stall
            }
        }

        present(&mut gl, &av);

        if frames_run % REWIND_EVERY == 0 {
            unsafe {
                let size = (core.serialize_size)();
                if size > 0 && size <= REWIND_BUDGET {
                    let mut buf = vec![0u8; size];
                    if (core.serialize)(buf.as_mut_ptr() as *mut c_void, size) {
                        rewind_bytes += size;
                        rewind_ring.push_back(buf);
                        while rewind_ring.len() > rewind_max || rewind_bytes > REWIND_BUDGET {
                            match rewind_ring.pop_front() {
                                Some(old) => rewind_bytes = rewind_bytes.saturating_sub(old.len()),
                                None => break,
                            }
                        }
                    }
                }
            }
        }

        // SRAM watch: cheap hash every 60 frames; a change pings the webview,
        // which pulls the bytes and runs the roaming pipeline.
        if frames_run % 60 == 0 {
            let h = fnv1a(&read_sram(&core));
            if h != last_sram_hash {
                last_sram_hash = h;
                let _ = app.emit("native:sram-changed", serde_json::json!({}));
            }
        }
        if last_stats.elapsed() >= Duration::from_secs(1) {
            let fps = stats_frames as f64 / last_stats.elapsed().as_secs_f64();
            if trace {
                eprintln!(
                    "[emu] frame {frames_run} {fps:.1} fps luminance {:.1} hw {} ring {}",
                    mean_luminance(&gl),
                    HW_ACTIVE.load(Ordering::Relaxed),
                    audio::RING.lock().unwrap().len(),
                );
            }
            last_stats = Instant::now();
            stats_frames = 0;
            let _ = app.emit(
                "native:stats",
                serde_json::json!({
                    "fps": fps,
                    "ring": audio::RING.lock().unwrap().len(),
                    "underruns": audio::UNDERRUNS.load(Ordering::Relaxed),
                    "hw": HW_ACTIVE.load(Ordering::Relaxed),
                }),
            );
        }
    }

    teardown(&core);
    let _ = app.emit("native:state", serde_json::json!({ "state": "stopped" }));
}

fn teardown(core: &Core) {
    unsafe {
        if let Some(hw) = HW.lock().unwrap().as_ref() {
            if let Some(destroy) = hw.context_destroy {
                destroy();
            }
        }
        (core.unload_game)();
        (core.deinit)();
    }
    // The dead core's option table would otherwise still answer list_core_options
    // between games. (The leaked value strings stay leaked — nothing is freed.)
    options::clear();
}

fn read_sram(core: &Core) -> Vec<u8> {
    unsafe {
        let size = (core.get_memory_size)(MEMORY_SAVE_RAM);
        let data = (core.get_memory_data)(MEMORY_SAVE_RAM);
        if data.is_null() || size == 0 {
            return Vec::new();
        }
        std::slice::from_raw_parts(data as *const u8, size).to_vec()
    }
}

// The picture's rect inside the window, in physical pixels, republished every
// present. The stylus needs it: a click lands in WINDOW space and has to become
// a point on the game's screen, and the letterbox lives here.
pub static PICTURE: Mutex<(i32, i32, i32, i32)> = Mutex::new((0, 0, 0, 0));

/// Window-relative click (physical px) → 0.0..1.0 across the picture. None when
/// the click landed on the letterbox rather than the game.
pub fn picture_point(px: f32, py: f32) -> Option<(f32, f32)> {
    let (dx, dy, dw, dh) = *PICTURE.lock().unwrap();
    if dw <= 0 || dh <= 0 {
        return None;
    }
    let x = (px - dx as f32) / dw as f32;
    let y = (py - dy as f32) / dh as f32;
    if !(0.0..=1.0).contains(&x) || !(0.0..=1.0).contains(&y) {
        return None;
    }
    Some((x, y))
}

pub fn fnv1a(bytes: &[u8]) -> u64 {
    let mut h: u64 = 0xcbf2_9ce4_8422_2325;
    for b in bytes {
        h ^= *b as u64;
        h = h.wrapping_mul(0x1_0000_01b3);
    }
    h
}

/// Aspect-fit the frame into the window — the same letterbox the web player's
/// full-bleed layout produces, so chrome overlays sit identically on both.
pub fn letterbox(win_w: i32, win_h: i32, fw: i32, fh: i32, aspect: f32) -> (i32, i32, i32, i32) {
    let aspect = if aspect > 0.0 { aspect } else { fw as f32 / fh.max(1) as f32 };
    let wa = win_w as f32 / win_h.max(1) as f32;
    let (dw, dh) = if wa > aspect {
        ((win_h as f32 * aspect) as i32, win_h)
    } else {
        (win_w, (win_w as f32 / aspect) as i32)
    };
    ((win_w - dw) / 2, (win_h - dh) / 2, dw, dh)
}

/// Mean brightness of the frame the core last produced. The spike's trick for
/// answering "is it actually rendering?" without a human looking at a window —
/// a black screen and a working screen are otherwise indistinguishable in logs.
/// Enabled by FROG_EMU_TRACE=1; costs a readback, so it stays off by default.
fn mean_luminance(gl: &Gl) -> f64 {
    let v = VIDEO.lock().unwrap();
    let (w, h) = (v.width.max(1) as usize, v.height.max(1) as usize);
    if v.hw_frame {
        let Some(fbo) = gl.hw_fbo else { return 0.0 };
        let mut buf = vec![0u8; w * h * 4];
        unsafe {
            gl.gl.bind_framebuffer(glow::READ_FRAMEBUFFER, Some(fbo));
            gl.gl.read_pixels(
                0, 0, w as i32, h as i32, glow::RGBA, glow::UNSIGNED_BYTE,
                glow::PixelPackData::Slice(&mut buf),
            );
            gl.gl.bind_framebuffer(glow::READ_FRAMEBUFFER, None);
        }
        let total: u64 = buf.chunks_exact(4).map(|p| (p[0] as u64 + p[1] as u64 + p[2] as u64) / 3).sum();
        return total as f64 / (w * h) as f64;
    }
    if v.last_frame.is_empty() {
        return 0.0;
    }
    let (mut total, mut count) = (0u64, 0u64);
    match v.pixel_format {
        PIXFMT_XRGB8888 => {
            for px in v.last_frame.chunks_exact(4) {
                total += (px[0] as u64 + px[1] as u64 + px[2] as u64) / 3;
                count += 1;
            }
        }
        PIXFMT_RGB565 => {
            for px in v.last_frame.chunks_exact(2) {
                let raw = u16::from_le_bytes([px[0], px[1]]);
                total += ((((raw >> 11) & 0x1f) << 3) as u64
                    + (((raw >> 5) & 0x3f) << 2) as u64
                    + ((raw & 0x1f) << 3) as u64) / 3;
                count += 1;
            }
        }
        _ => {
            for px in v.last_frame.chunks_exact(2) {
                let raw = u16::from_le_bytes([px[0], px[1]]);
                total += ((((raw >> 10) & 0x1f) << 3) as u64
                    + (((raw >> 5) & 0x1f) << 3) as u64
                    + ((raw & 0x1f) << 3) as u64) / 3;
                count += 1;
            }
        }
    }
    total as f64 / count.max(1) as f64
}

fn present(gl: &mut Gl, av: &SystemAvInfo) {
    let (win_w, win_h) = (gl.win_w.max(1) as i32, gl.win_h.max(1) as i32);
    let mut v = VIDEO.lock().unwrap();
    let (fw, fh) = (v.width.max(1) as i32, v.height.max(1) as i32);

    unsafe {
        gl.gl.bind_framebuffer(glow::DRAW_FRAMEBUFFER, None);
        gl.gl.viewport(0, 0, win_w, win_h);
        gl.gl.clear_color(0.0, 0.0, 0.0, 1.0);
        gl.gl.clear(glow::COLOR_BUFFER_BIT);

        let (dx, dy, dw, dh) = letterbox(win_w, win_h, fw, fh, av.geometry.aspect_ratio);
        *PICTURE.lock().unwrap() = (dx, dy, dw, dh);

        let (read_fbo, flip) = if v.hw_frame {
            let bottom_left = HW.lock().unwrap().as_ref().map(|h| h.bottom_left).unwrap_or(true);
            (gl.hw_fbo, !bottom_left)
        } else {
            if v.dirty {
                gl.gl.bind_texture(glow::TEXTURE_2D, Some(gl.sw_texture));
                let (internal, format, ty): (i32, u32, u32) = match v.pixel_format {
                    PIXFMT_XRGB8888 => (glow::RGBA8 as i32, glow::BGRA, glow::UNSIGNED_INT_8_8_8_8_REV),
                    PIXFMT_RGB565 => (glow::RGB8 as i32, glow::RGB, glow::UNSIGNED_SHORT_5_6_5),
                    _ => (glow::RGBA8 as i32, glow::BGRA, glow::UNSIGNED_SHORT_1_5_5_5_REV),
                };
                gl.gl.pixel_store_i32(glow::UNPACK_ALIGNMENT, 1);
                gl.gl.tex_image_2d(glow::TEXTURE_2D, 0, internal, fw, fh, 0, format, ty, Some(&v.last_frame));
                gl.gl.tex_parameter_i32(glow::TEXTURE_2D, glow::TEXTURE_MIN_FILTER, glow::NEAREST as i32);
                gl.gl.tex_parameter_i32(glow::TEXTURE_2D, glow::TEXTURE_MAG_FILTER, glow::NEAREST as i32);
                gl.gl.bind_framebuffer(glow::FRAMEBUFFER, Some(gl.sw_fbo));
                gl.gl.framebuffer_texture_2d(glow::FRAMEBUFFER, glow::COLOR_ATTACHMENT0, glow::TEXTURE_2D, Some(gl.sw_texture), 0);
                gl.gl.bind_framebuffer(glow::FRAMEBUFFER, None);
                v.dirty = false;
            }
            (Some(gl.sw_fbo), true) // texture row 0 = image top → flip on blit
        };

        let filter = current_filter();
        let source_tex = if v.hw_frame { gl.hw_texture } else { Some(gl.sw_texture) };

        match (filter.needs_shader(), source_tex, gl.filter_stage.as_ref()) {
            // The CRT looks draw the game as a textured quad so a fragment
            // shader can lay scanlines over it.
            (true, Some(tex), Some(stage)) => {
                stage.draw(&gl.gl, tex, filter, (fw, fh), (dx, dy, dw, dh), flip);
                gl.gl.viewport(0, 0, win_w, win_h);
            }
            // Off and Smooth are the same blit with different sampling —
            // cheaper and sharper than imitating them in a shader.
            _ => {
                if let Some(fbo) = read_fbo {
                    let sampling = if filter == crate::emu::shader::Filter::Smooth {
                        glow::LINEAR
                    } else {
                        glow::NEAREST
                    };
                    gl.gl.bind_framebuffer(glow::READ_FRAMEBUFFER, Some(fbo));
                    let (sy0, sy1) = if flip { (fh, 0) } else { (0, fh) };
                    gl.gl.blit_framebuffer(0, sy0, fw, sy1, dx, dy, dx + dw, dy + dh, glow::COLOR_BUFFER_BIT, sampling);
                    gl.gl.bind_framebuffer(glow::READ_FRAMEBUFFER, None);
                }
            }
        }
    }
    drop(v);
    use glutin::prelude::GlSurface;
    gl.surface.swap_buffers(&gl.context).ok();
}

/// The live frame as PNG bytes — save-state thumbnails, Save Screenshot, and
/// set-as-cover all ride this. HW path reads the core's FBO; software path
/// decodes the packed frame. Rows are flipped as needed so the PNG is upright.
fn screenshot(gl: &Gl) -> Result<Vec<u8>, String> {
    let v = VIDEO.lock().unwrap();
    let (w, h) = (v.width.max(1) as usize, v.height.max(1) as usize);
    let mut rgba = vec![0u8; w * h * 4];

    if v.hw_frame {
        let Some(fbo) = gl.hw_fbo else { return Err("no HW frame".into()) };
        unsafe {
            gl.gl.bind_framebuffer(glow::READ_FRAMEBUFFER, Some(fbo));
            gl.gl.read_pixels(
                0, 0, w as i32, h as i32, glow::RGBA, glow::UNSIGNED_BYTE,
                glow::PixelPackData::Slice(&mut rgba),
            );
            gl.gl.bind_framebuffer(glow::READ_FRAMEBUFFER, None);
        }
        let bottom_left = HW.lock().unwrap().as_ref().map(|i| i.bottom_left).unwrap_or(true);
        if bottom_left {
            flip_rows(&mut rgba, w, h);
        }
    } else {
        if v.last_frame.is_empty() {
            return Err("no frame yet".into());
        }
        match v.pixel_format {
            PIXFMT_XRGB8888 => {
                for (i, px) in v.last_frame.chunks_exact(4).take(w * h).enumerate() {
                    // XRGB little-endian in memory: B G R X
                    rgba[i * 4] = px[2];
                    rgba[i * 4 + 1] = px[1];
                    rgba[i * 4 + 2] = px[0];
                    rgba[i * 4 + 3] = 255;
                }
            }
            PIXFMT_RGB565 => {
                for (i, px) in v.last_frame.chunks_exact(2).take(w * h).enumerate() {
                    let raw = u16::from_le_bytes([px[0], px[1]]);
                    rgba[i * 4] = (((raw >> 11) & 0x1f) << 3) as u8;
                    rgba[i * 4 + 1] = (((raw >> 5) & 0x3f) << 2) as u8;
                    rgba[i * 4 + 2] = ((raw & 0x1f) << 3) as u8;
                    rgba[i * 4 + 3] = 255;
                }
            }
            _ => {
                for (i, px) in v.last_frame.chunks_exact(2).take(w * h).enumerate() {
                    let raw = u16::from_le_bytes([px[0], px[1]]);
                    rgba[i * 4] = (((raw >> 10) & 0x1f) << 3) as u8;
                    rgba[i * 4 + 1] = (((raw >> 5) & 0x1f) << 3) as u8;
                    rgba[i * 4 + 2] = ((raw & 0x1f) << 3) as u8;
                    rgba[i * 4 + 3] = 255;
                }
            }
        }
    }
    drop(v);

    let mut out = Vec::new();
    {
        let mut enc = png::Encoder::new(&mut out, w as u32, h as u32);
        enc.set_color(png::ColorType::Rgba);
        enc.set_depth(png::BitDepth::Eight);
        let mut writer = enc.write_header().map_err(|e| e.to_string())?;
        writer.write_image_data(&rgba).map_err(|e| e.to_string())?;
    }
    Ok(out)
}

fn flip_rows(buf: &mut [u8], w: usize, h: usize) {
    let stride = w * 4;
    for y in 0..h / 2 {
        let (top, bottom) = buf.split_at_mut((h - 1 - y) * stride);
        top[y * stride..y * stride + stride].swap_with_slice(&mut bottom[..stride]);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn letterbox_pillars_a_wide_window_and_bars_a_tall_one() {
        // 4:3 frame in a 16:9 window → pillarboxed, full height.
        let (dx, dy, dw, dh) = letterbox(1920, 1080, 640, 480, 4.0 / 3.0);
        assert_eq!(dh, 1080);
        assert_eq!(dw, 1440);
        assert_eq!(dx, 240);
        assert_eq!(dy, 0);
        // Same frame in a portrait window → letterboxed, full width.
        let (dx, dy, dw, dh) = letterbox(800, 1200, 640, 480, 4.0 / 3.0);
        assert_eq!(dw, 800);
        assert_eq!(dh, 600);
        assert_eq!(dx, 0);
        assert_eq!(dy, 300);
    }

    #[test]
    fn letterbox_falls_back_to_frame_aspect_when_core_reports_none() {
        let (_, _, dw, dh) = letterbox(1000, 1000, 320, 240, 0.0);
        assert_eq!((dw, dh), (1000, 750));
    }

    #[test]
    fn picture_point_maps_inside_and_rejects_the_letterbox() {
        *PICTURE.lock().unwrap() = (100, 0, 800, 600); // pillarboxed 800x600
        assert_eq!(picture_point(500.0, 300.0), Some((0.5, 0.5)));
        assert_eq!(picture_point(100.0, 0.0), Some((0.0, 0.0)));
        assert!(picture_point(50.0, 300.0).is_none()); // the black bar, not the game
        *PICTURE.lock().unwrap() = (0, 0, 0, 0);
        assert!(picture_point(1.0, 1.0).is_none()); // nothing presented yet
    }

    #[test]
    fn fnv_hash_detects_change_and_stability() {
        let a = fnv1a(b"hello");
        assert_eq!(a, fnv1a(b"hello"));
        assert_ne!(a, fnv1a(b"hellp"));
        assert_ne!(fnv1a(b""), 0);
    }

    #[test]
    fn flip_rows_inverts_vertically() {
        // 1x3 image, rows R,G,B → B,G,R
        let mut buf = vec![
            255, 0, 0, 255, //
            0, 255, 0, 255, //
            0, 0, 255, 255,
        ];
        flip_rows(&mut buf, 1, 3);
        assert_eq!(&buf[0..4], &[0, 0, 255, 255]);
        assert_eq!(&buf[8..12], &[255, 0, 0, 255]);
    }
}
