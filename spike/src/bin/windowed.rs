// Windowed libretro host — spike part 2.
//
// Everything part 1 proved, plus the four things a real player needs:
//   1. a native window presenting frames (software cores: texture blit; HW cores:
//      the SET_HW_RENDER contract — host GL context, get_proc_address, an FBO the
//      core renders into, context_reset after load)
//   2. audio through the default output device (ring buffer + naive resample;
//      headless machines without a device keep running silently)
//   3. input from a real gamepad (gilrs) with a keyboard fallback
//   4. real-time pacing with fast-forward (hold Tab)
//
//   cargo run --release --bin windowed -- cores/<core>.so roms/<rom>
//
// Hotkeys: F5 save state, F7 load state, Tab fast-forward, Esc quit.
// Keyboard pad: arrows = d-pad, Z/X = B/A, A/S = Y/X, Q/W = L/R, E = L2 (N64 Z),
// Enter = Start, RShift = Select, IJKL = left analog stick.
//
// Headless verification: SPIKE_AUTOEXIT=<frames> runs that many frames, prints
// measured stats (fps, luminance), and exits 0/1 — used under xvfb-run in CI.

#[path = "../libretro.rs"]
mod libretro;

use glow::HasContext;
use glutin::config::ConfigTemplateBuilder;
use glutin::context::{ContextApi, ContextAttributesBuilder, PossiblyCurrentContext, Version};
use glutin::display::GetGlDisplay;
use glutin::prelude::*;
use glutin::surface::{Surface, SwapInterval, WindowSurface};
use libretro::*;
use std::collections::VecDeque;
use std::ffi::{CStr, CString};
use std::os::raw::{c_char, c_uint, c_void};
use std::sync::atomic::{AtomicBool, AtomicI16, AtomicU32, AtomicU64, AtomicUsize, Ordering};
use std::sync::Mutex;
use std::time::{Duration, Instant};
use winit::application::ApplicationHandler;
use winit::event::{ElementState, WindowEvent};
use winit::event_loop::{ActiveEventLoop, EventLoop};
use winit::keyboard::{KeyCode, PhysicalKey};
use winit::window::{Window, WindowAttributes};

// ---------- state shared with the C callbacks (all main-thread) ----------

struct VideoState {
    pixel_format: c_uint,
    frames: u64,
    hw_frame: bool,   // last frame came from the HW path (already in the FBO)
    dirty: bool,      // software frame waiting to be uploaded
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

// Audio ring: interleaved stereo i16 at the core's sample rate.
static AUDIO: Mutex<VecDeque<i16>> = Mutex::new(VecDeque::new());
static AUDIO_IN: AtomicU64 = AtomicU64::new(0); // stereo frames delivered by the core
static AUDIO_UNDERRUNS: AtomicU64 = AtomicU64::new(0);

// Input snapshot the input_state callback reads (updated once per frame).
static PAD_BITS: AtomicU32 = AtomicU32::new(0);
static PAD_AX: AtomicI16 = AtomicI16::new(0);
static PAD_AY: AtomicI16 = AtomicI16::new(0);

// Core options (legacy SET_VARIABLES/GET_VARIABLE protocol). The value handed back
// by GET_VARIABLE must stay valid for the core's lifetime, so defaults are stored as
// leaked CStrings. Declining GET_VARIABLE entirely sends cores down a rarely-tested
// fallback (mupen64plus_next frees one of its own statics and aborts) — a frontend
// MUST answer the options it was given.
static OPTIONS: Mutex<Vec<(String, usize)>> = Mutex::new(Vec::new()); // key -> leaked c-str ptr
// SPIKE_OPT="key=value;key=value" overrides a core option's default (value must be
// one of the option's listed values — the registration log prints them all).
static OVERRIDES: Mutex<Vec<(String, String)>> = Mutex::new(Vec::new());

// HW-render handshake.
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

thread_local! {
    static GL_DISPLAY: std::cell::RefCell<Option<glutin::display::Display>> =
        const { std::cell::RefCell::new(None) };
}

static DATA_DIR: &str = "spike_data\0";

#[repr(C)]
struct LogCallback {
    log: unsafe extern "C" fn(),
}
extern "C" {
    // src/log_shim.c — variadic retro_log_printf_t target
    fn frog_spike_log();
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
            static DIR_PTR: AtomicUsize = AtomicUsize::new(0);
            if DIR_PTR.load(Ordering::Relaxed) == 0 {
                let leaked = CString::new("spike_data").unwrap().into_raw();
                DIR_PTR.store(leaked as usize, Ordering::Relaxed);
            }
            *(data as *mut *const c_char) = DIR_PTR.load(Ordering::Relaxed) as *const c_char;
            true
        }
        ENV_GET_LOG_INTERFACE => {
            (*(data as *mut LogCallback)).log = frog_spike_log;
            true
        }
        ENV_GET_AUDIO_VIDEO_ENABLE => {
            // bit 0 = video, bit 1 = audio. Declining this reads as "audio off"
            // to some cores (mupen64plus_next went fully silent).
            *(data as *mut i32) = 3;
            true
        }
        ENV_GET_PREFERRED_HW_RENDER => {
            *(data as *mut c_uint) = HW_CONTEXT_OPENGL_CORE;
            true
        }
        ENV_SET_VARIABLES => {
            let mut vars = data as *const RetroVariable;
            let mut opts = OPTIONS.lock().unwrap();
            let overrides = OVERRIDES.lock().unwrap();
            while !(*vars).key.is_null() {
                let key = CStr::from_ptr((*vars).key).to_string_lossy().into_owned();
                let desc = CStr::from_ptr((*vars).value).to_string_lossy();
                // "Description; default|opt2|..." — the default is the first option.
                let default = desc
                    .split_once("; ")
                    .map(|(_, opts)| opts.split('|').next().unwrap_or(""))
                    .unwrap_or("")
                    .to_string();
                let chosen = overrides
                    .iter()
                    .find(|(k, _)| *k == key)
                    .map(|(_, v)| v.clone())
                    .unwrap_or(default);
                eprintln!("  [opt] {key} = {chosen}   ({desc})");
                let leaked = CString::new(chosen).unwrap().into_raw() as usize;
                opts.push((key, leaked));
                vars = vars.add(1);
            }
            eprintln!("  [opts] core registered {} options", opts.len());
            true
        }
        ENV_GET_VARIABLE => {
            let var = &mut *(data as *mut RetroVariable);
            let key = CStr::from_ptr(var.key).to_string_lossy();
            let opts = OPTIONS.lock().unwrap();
            match opts.iter().find(|(k, _)| *k == key) {
                Some((_, ptr)) => {
                    var.value = *ptr as *const c_char;
                    true
                }
                None => false,
            }
        }
        ENV_GET_VARIABLE_UPDATE => {
            *(data as *mut bool) = false;
            true
        }
        ENV_SET_HW_RENDER => {
            let cb = &mut *(data as *mut HwRenderCallback);
            if cb.context_type != HW_CONTEXT_OPENGL && cb.context_type != HW_CONTEXT_OPENGL_CORE {
                eprintln!("  [hw] refused context type {}", cb.context_type);
                return false;
            }
            eprintln!(
                "  [hw] core wants GL context type {} v{}.{} (depth {}, stencil {}, bottom-left {})",
                cb.context_type, cb.version_major, cb.version_minor, cb.depth, cb.stencil, cb.bottom_left_origin
            );
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
    let ptr = GL_DISPLAY.with(|d| match d.borrow().as_ref() {
        Some(display) => display.get_proc_address(CStr::from_ptr(sym)) as *const c_void,
        None => std::ptr::null(),
    });
    if ptr.is_null() {
        eprintln!("  [gl] get_proc_address -> NULL for {:?}", CStr::from_ptr(sym));
    }
    ptr
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

unsafe extern "C" fn audio_sample(l: i16, r: i16) {
    AUDIO_IN.fetch_add(1, Ordering::Relaxed);
    let mut a = AUDIO.lock().unwrap();
    a.push_back(l);
    a.push_back(r);
}

unsafe extern "C" fn audio_sample_batch(data: *const i16, frames: usize) -> usize {
    AUDIO_IN.fetch_add(frames as u64, Ordering::Relaxed);
    let s = std::slice::from_raw_parts(data, frames * 2);
    let mut a = AUDIO.lock().unwrap();
    a.extend(s.iter().copied());
    // Backstop: never let the ring grow past ~1s of 48k stereo audio.
    let cap = 48000 * 2;
    while a.len() > cap {
        a.pop_front();
    }
    frames
}

unsafe extern "C" fn input_poll() {}

unsafe extern "C" fn input_state(port: c_uint, device: c_uint, index: c_uint, id: c_uint) -> i16 {
    if port != 0 {
        return 0;
    }
    match device {
        DEVICE_JOYPAD => ((PAD_BITS.load(Ordering::Relaxed) >> id) & 1) as i16 * 0x7fff_u16 as i16,
        DEVICE_ANALOG if index == ANALOG_LEFT => match id {
            ANALOG_X => PAD_AX.load(Ordering::Relaxed),
            ANALOG_Y => PAD_AY.load(Ordering::Relaxed),
            _ => 0,
        },
        _ => 0,
    }
}

// ---------- the app ----------

struct Gl {
    context: PossiblyCurrentContext,
    surface: Surface<WindowSurface>,
    gl: glow::Context,
    // software path
    sw_texture: glow::Texture,
    sw_fbo: glow::Framebuffer, // wraps sw_texture as a READ target for blitting
    sw_w: u32,
    sw_h: u32,
    // HW path
    hw_fbo: Option<glow::Framebuffer>,
}

struct App {
    core: Core,
    rom_path: String,
    rom_bytes: Vec<u8>,
    window: Option<Window>,
    gl: Option<Gl>,
    av: Option<SystemAvInfo>,
    loaded: bool,
    gilrs: Option<gilrs::Gilrs>,
    _audio_stream: Option<cpal::Stream>,
    // pacing + stats
    next_frame: Instant,
    started: Instant,
    frames_run: u64,
    fast_forward: bool,
    // keyboard analog
    key_analog: [i16; 2],
    save_slot: Option<Vec<u8>>,
    autoexit: Option<u64>,
    failures: u32,
}

impl App {
    fn frame_period(&self) -> Duration {
        let fps = self.av.as_ref().map(|a| a.timing.fps).unwrap_or(60.0);
        Duration::from_secs_f64(1.0 / fps.max(1.0))
    }

    fn init_gl_and_game(&mut self, event_loop: &ActiveEventLoop) {
        // Window + GL context (3.3 core, the floor GLideN64 asks for).
        let template = ConfigTemplateBuilder::new().with_depth_size(24).with_stencil_size(8);
        let (window, gl_config) = glutin_winit::DisplayBuilder::new()
            .with_window_attributes(Some(
                WindowAttributes::default()
                    .with_title("Frog Game Station native spike")
                    .with_inner_size(winit::dpi::LogicalSize::new(960.0, 720.0)),
            ))
            .build(event_loop, template, |mut configs| configs.next().expect("no GL config"))
            .expect("window + GL config");
        let window = window.expect("window");
        let display = gl_config.display();

        let raw_window_handle = {
            use raw_window_handle::HasWindowHandle;
            window.window_handle().expect("window handle").as_raw()
        };
        let context_attributes = ContextAttributesBuilder::new()
            .with_context_api(ContextApi::OpenGl(Some(Version::new(3, 3))))
            .build(Some(raw_window_handle));
        let not_current = unsafe { display.create_context(&gl_config, &context_attributes) }.expect("GL context");

        let size = window.inner_size();
        let surface_attributes = glutin::surface::SurfaceAttributesBuilder::<WindowSurface>::new().build(
            raw_window_handle,
            std::num::NonZeroU32::new(size.width.max(1)).unwrap(),
            std::num::NonZeroU32::new(size.height.max(1)).unwrap(),
        );
        let surface = unsafe { display.create_window_surface(&gl_config, &surface_attributes) }.expect("surface");
        let context = not_current.make_current(&surface).expect("make_current");
        surface.set_swap_interval(&context, SwapInterval::DontWait).ok(); // manual pacing

        let gl = unsafe {
            glow::Context::from_loader_function(|s| {
                let c = CString::new(s).unwrap();
                display.get_proc_address(&c) as *const _
            })
        };
        unsafe {
            let version = gl.get_parameter_string(glow::VERSION);
            let renderer = gl.get_parameter_string(glow::RENDERER);
            println!("  gl: {version} on {renderer}");
        }

        GL_DISPLAY.with(|d| *d.borrow_mut() = Some(display.clone()));

        let (sw_texture, sw_fbo) = unsafe {
            let tex = gl.create_texture().unwrap();
            let fbo = gl.create_framebuffer().unwrap();
            (tex, fbo)
        };
        self.gl = Some(Gl { context, surface, gl, sw_texture, sw_fbo, sw_w: 0, sw_h: 0, hw_fbo: None });
        self.window = Some(window);

        // Load the game now that a context could be negotiated (SET_HW_RENDER
        // arrives during retro_load_game).
        self.rom_bytes = std::fs::read(&self.rom_path).expect("rom read failed");
        let rom = &self.rom_bytes;
        let path_c = CString::new(self.rom_path.as_str()).unwrap();
        let mut info = unsafe { std::mem::zeroed::<SystemInfo>() };
        unsafe { (self.core.get_system_info)(&mut info) };
        let game = GameInfo {
            path: path_c.as_ptr(),
            data: if info.need_fullpath { std::ptr::null() } else { rom.as_ptr() as *const c_void },
            size: rom.len(),
            meta: std::ptr::null(),
        };
        eprintln!("  [load] retro_load_game...");
        let loaded = unsafe { (self.core.load_game)(&game) };
        eprintln!("  [load] retro_load_game -> {loaded}");
        if !loaded {
            eprintln!("FAIL retro_load_game refused the ROM");
            self.failures += 1;
            event_loop.exit();
            return;
        }
        self.loaded = true;

        let mut av = unsafe { std::mem::zeroed::<SystemAvInfo>() };
        unsafe { (self.core.get_system_av_info)(&mut av) };
        println!(
            "  av: {}x{} (max {}x{}) @ {:.2} fps, audio {:.0} Hz",
            av.geometry.base_width,
            av.geometry.base_height,
            av.geometry.max_width,
            av.geometry.max_height,
            av.timing.fps,
            av.timing.sample_rate
        );

        // HW path: build the core's render target, then context_reset.
        let hw = HW.lock().unwrap().is_some();
        if hw {
            let g = self.gl.as_mut().unwrap();
            let (max_w, max_h) = (av.geometry.max_width.max(640), av.geometry.max_height.max(480));
            unsafe {
                let fbo = g.gl.create_framebuffer().unwrap();
                let color = g.gl.create_texture().unwrap();
                g.gl.bind_texture(glow::TEXTURE_2D, Some(color));
                g.gl.tex_image_2d(
                    glow::TEXTURE_2D, 0, glow::RGBA8 as i32, max_w as i32, max_h as i32,
                    0, glow::RGBA, glow::UNSIGNED_BYTE, None,
                );
                g.gl.tex_parameter_i32(glow::TEXTURE_2D, glow::TEXTURE_MIN_FILTER, glow::NEAREST as i32);
                g.gl.tex_parameter_i32(glow::TEXTURE_2D, glow::TEXTURE_MAG_FILTER, glow::NEAREST as i32);
                g.gl.bind_framebuffer(glow::FRAMEBUFFER, Some(fbo));
                g.gl.framebuffer_texture_2d(glow::FRAMEBUFFER, glow::COLOR_ATTACHMENT0, glow::TEXTURE_2D, Some(color), 0);
                let info = HW.lock().unwrap();
                let info = info.as_ref().unwrap();
                if info.depth || info.stencil {
                    let rb = g.gl.create_renderbuffer().unwrap();
                    g.gl.bind_renderbuffer(glow::RENDERBUFFER, Some(rb));
                    g.gl.renderbuffer_storage(glow::RENDERBUFFER, glow::DEPTH24_STENCIL8, max_w as i32, max_h as i32);
                    g.gl.framebuffer_renderbuffer(
                        glow::FRAMEBUFFER,
                        if info.stencil { glow::DEPTH_STENCIL_ATTACHMENT } else { glow::DEPTH_ATTACHMENT },
                        glow::RENDERBUFFER,
                        Some(rb),
                    );
                }
                let status = g.gl.check_framebuffer_status(glow::FRAMEBUFFER);
                assert_eq!(status, glow::FRAMEBUFFER_COMPLETE, "core FBO incomplete");
                g.gl.bind_framebuffer(glow::FRAMEBUFFER, None);
                g.hw_fbo = Some(fbo);
                HW_FBO.store(fbo.0.get() as usize, Ordering::Relaxed);
                HW_ACTIVE.store(true, Ordering::Relaxed);
            }
            let reset = HW.lock().unwrap().as_ref().unwrap().context_reset;
            eprintln!("  [hw] calling context_reset...");
            unsafe { reset() };
            eprintln!("  [hw] context_reset returned");
        }

        self.av = Some(av);
        self.start_audio();
        self.next_frame = Instant::now();
        self.started = Instant::now();
    }

    fn start_audio(&mut self) {
        use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
        if std::env::var("SPIKE_MUTE").is_ok() {
            println!("  audio: muted (SPIKE_MUTE)");
            return;
        }
        let core_rate = self.av.as_ref().map(|a| a.timing.sample_rate).unwrap_or(44100.0);
        let host = cpal::default_host();
        let Some(device) = host.default_output_device() else {
            println!("  audio: no output device — running silent (headless)");
            return;
        };
        let Ok(config) = device.default_output_config() else {
            println!("  audio: no default output config — running silent");
            return;
        };
        let device_rate = config.sample_rate().0 as f64;
        let channels = config.channels() as usize;
        let ratio = core_rate / device_rate; // source frames consumed per output frame
        let mut src_pos: f64 = 0.0; // fractional index into the ring's first frame
        // Jitter buffer: after an underrun, output silence until the ring refills to
        // low-water (~40 ms of core-rate audio) — occasional quiet beats crackle.
        let low_water = (core_rate * 0.04) as usize * 2;
        let mut holding = true;
        let stream = device
            .build_output_stream(
                &config.into(),
                move |out: &mut [f32], _| {
                    let mut ring = AUDIO.lock().unwrap();
                    if holding && ring.len() >= low_water {
                        holding = false;
                    }
                    for frame in out.chunks_mut(channels) {
                        if holding {
                            for c in frame.iter_mut() {
                                *c = 0.0;
                            }
                            continue;
                        }
                        // consume whole source frames the position has passed
                        while src_pos >= 1.0 && ring.len() >= 2 {
                            ring.pop_front();
                            ring.pop_front();
                            src_pos -= 1.0;
                        }
                        // linear interpolation between the ring's first two frames;
                        // underrun -> hold + silence (never repeat stale samples)
                        let (l, r) = if ring.len() >= 4 {
                            let f = src_pos as f32;
                            let l0 = ring[0] as f32;
                            let r0 = ring[1] as f32;
                            let l1 = ring[2] as f32;
                            let r1 = ring[3] as f32;
                            (((l0 + (l1 - l0) * f) / 32768.0), ((r0 + (r1 - r0) * f) / 32768.0))
                        } else {
                            AUDIO_UNDERRUNS.fetch_add(1, Ordering::Relaxed);
                            holding = true;
                            (0.0, 0.0)
                        };
                        frame[0] = l;
                        for c in frame.iter_mut().skip(1) {
                            *c = r;
                        }
                        src_pos += ratio;
                    }
                },
                |e| eprintln!("  audio error: {e}"),
                None,
            )
            .ok();
        if let Some(s) = stream {
            s.play().ok();
            println!("  audio: streaming at {device_rate:.0} Hz (core {core_rate:.0} Hz)");
            self._audio_stream = Some(s);
        }
    }

    fn poll_gamepad(&mut self) {
        let Some(gilrs) = self.gilrs.as_mut() else { return };
        use gilrs::{Axis, Button, EventType};
        while let Some(ev) = gilrs.next_event() {
            let bit = |b: Button| -> Option<c_uint> {
                match b {
                    Button::South => Some(JOYPAD_B),
                    Button::East => Some(JOYPAD_A),
                    Button::West => Some(JOYPAD_Y),
                    Button::North => Some(JOYPAD_X),
                    Button::DPadUp => Some(JOYPAD_UP),
                    Button::DPadDown => Some(JOYPAD_DOWN),
                    Button::DPadLeft => Some(JOYPAD_LEFT),
                    Button::DPadRight => Some(JOYPAD_RIGHT),
                    Button::Start => Some(JOYPAD_START),
                    Button::Select => Some(JOYPAD_SELECT),
                    Button::LeftTrigger => Some(JOYPAD_L),
                    Button::RightTrigger => Some(JOYPAD_R),
                    Button::LeftTrigger2 => Some(JOYPAD_L2),
                    Button::RightTrigger2 => Some(JOYPAD_R2),
                    _ => None,
                }
            };
            match ev.event {
                EventType::ButtonPressed(b, _) => {
                    if let Some(id) = bit(b) {
                        PAD_BITS.fetch_or(1 << id, Ordering::Relaxed);
                    }
                }
                EventType::ButtonReleased(b, _) => {
                    if let Some(id) = bit(b) {
                        PAD_BITS.fetch_and(!(1 << id), Ordering::Relaxed);
                    }
                }
                EventType::AxisChanged(Axis::LeftStickX, v, _) => {
                    PAD_AX.store((v * 32767.0) as i16, Ordering::Relaxed);
                }
                EventType::AxisChanged(Axis::LeftStickY, v, _) => {
                    // libretro analog Y is positive-down
                    PAD_AY.store((-v * 32767.0) as i16, Ordering::Relaxed);
                }
                _ => {}
            }
        }
    }

    fn run_one_frame(&mut self) {
        if self.frames_run < 5 {
            eprintln!("  [trace] retro_run #{}...", self.frames_run + 1);
        }
        unsafe { (self.core.run)() };
        if self.frames_run < 5 {
            eprintln!("  [trace] retro_run #{} returned", self.frames_run + 1);
        }
        self.frames_run += 1;
    }

    fn present(&mut self) {
        let Some(g) = self.gl.as_mut() else { return };
        let Some(window) = self.window.as_ref() else { return };
        let size = window.inner_size();
        let (win_w, win_h) = (size.width.max(1) as i32, size.height.max(1) as i32);
        let mut v = VIDEO.lock().unwrap();
        let (fw, fh) = (v.width.max(1) as i32, v.height.max(1) as i32);

        unsafe {
            g.gl.bind_framebuffer(glow::DRAW_FRAMEBUFFER, None);
            g.gl.viewport(0, 0, win_w, win_h);
            g.gl.clear_color(0.0, 0.0, 0.0, 1.0);
            g.gl.clear(glow::COLOR_BUFFER_BIT);

            // Letterbox: fit the frame's aspect into the window.
            let aspect = {
                let a = self.av.as_ref().map(|a| a.geometry.aspect_ratio).unwrap_or(0.0);
                if a > 0.0 { a } else { fw as f32 / fh as f32 }
            };
            let (dw, dh) = {
                let wa = win_w as f32 / win_h as f32;
                if wa > aspect {
                    ((win_h as f32 * aspect) as i32, win_h)
                } else {
                    (win_w, (win_w as f32 / aspect) as i32)
                }
            };
            let (dx, dy) = ((win_w - dw) / 2, (win_h - dh) / 2);

            let (read_fbo, flip) = if v.hw_frame {
                let bottom_left = HW.lock().unwrap().as_ref().map(|h| h.bottom_left).unwrap_or(true);
                (g.hw_fbo, !bottom_left)
            } else {
                // Software: (re)upload the packed frame, then blit from its FBO.
                if v.dirty {
                    g.gl.bind_texture(glow::TEXTURE_2D, Some(g.sw_texture));
                    if g.sw_w != v.width || g.sw_h != v.height {
                        g.sw_w = v.width;
                        g.sw_h = v.height;
                    }
                    let (internal, format, ty): (i32, u32, u32) = match v.pixel_format {
                        PIXFMT_XRGB8888 => (glow::RGBA8 as i32, glow::BGRA, glow::UNSIGNED_INT_8_8_8_8_REV),
                        PIXFMT_RGB565 => (glow::RGB8 as i32, glow::RGB, glow::UNSIGNED_SHORT_5_6_5),
                        _ => (glow::RGBA8 as i32, glow::BGRA, glow::UNSIGNED_SHORT_1_5_5_5_REV),
                    };
                    g.gl.pixel_store_i32(glow::UNPACK_ALIGNMENT, 1);
                    g.gl.tex_image_2d(
                        glow::TEXTURE_2D, 0, internal, fw, fh, 0, format, ty,
                        Some(&v.last_frame),
                    );
                    g.gl.tex_parameter_i32(glow::TEXTURE_2D, glow::TEXTURE_MIN_FILTER, glow::NEAREST as i32);
                    g.gl.tex_parameter_i32(glow::TEXTURE_2D, glow::TEXTURE_MAG_FILTER, glow::NEAREST as i32);
                    g.gl.bind_framebuffer(glow::FRAMEBUFFER, Some(g.sw_fbo));
                    g.gl.framebuffer_texture_2d(
                        glow::FRAMEBUFFER, glow::COLOR_ATTACHMENT0, glow::TEXTURE_2D, Some(g.sw_texture), 0,
                    );
                    g.gl.bind_framebuffer(glow::FRAMEBUFFER, None);
                    v.dirty = false;
                }
                (Some(g.sw_fbo), true) // texture row 0 = image top → flip on blit
            };

            if let Some(fbo) = read_fbo {
                g.gl.bind_framebuffer(glow::READ_FRAMEBUFFER, Some(fbo));
                let (sy0, sy1) = if flip { (fh, 0) } else { (0, fh) };
                g.gl.blit_framebuffer(
                    0, sy0, fw, sy1,
                    dx, dy, dx + dw, dy + dh,
                    glow::COLOR_BUFFER_BIT,
                    glow::NEAREST,
                );
                g.gl.bind_framebuffer(glow::READ_FRAMEBUFFER, None);
            }
        }
        drop(v);
        g.surface.swap_buffers(&g.context).ok();
    }

    fn mean_luminance(&self) -> f64 {
        // Read back the presented frame region from the read source we just drew.
        // For simplicity, sample the software buffer or the HW FBO directly.
        let v = VIDEO.lock().unwrap();
        if v.hw_frame {
            let Some(g) = self.gl.as_ref() else { return 0.0 };
            let (w, h) = (v.width.max(1) as i32, v.height.max(1) as i32);
            let mut buf = vec![0u8; (w * h * 4) as usize];
            unsafe {
                g.gl.bind_framebuffer(glow::READ_FRAMEBUFFER, g.hw_fbo);
                g.gl.read_pixels(
                    0, 0, w, h, glow::RGBA, glow::UNSIGNED_BYTE,
                    glow::PixelPackData::Slice(&mut buf),
                );
                g.gl.bind_framebuffer(glow::READ_FRAMEBUFFER, None);
            }
            let total: u64 = buf.chunks_exact(4).map(|p| (p[0] as u64 + p[1] as u64 + p[2] as u64) / 3).sum();
            return total as f64 / (w as f64 * h as f64);
        }
        if v.last_frame.is_empty() {
            return 0.0;
        }
        let mut total = 0u64;
        let mut count = 0u64;
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
                    let r = ((raw >> 11) & 0x1f) << 3;
                    let gch = ((raw >> 5) & 0x3f) << 2;
                    let b = (raw & 0x1f) << 3;
                    total += (r as u64 + gch as u64 + b as u64) / 3;
                    count += 1;
                }
            }
            _ => {
                for px in v.last_frame.chunks_exact(2) {
                    let raw = u16::from_le_bytes([px[0], px[1]]);
                    let r = ((raw >> 10) & 0x1f) << 3;
                    let gch = ((raw >> 5) & 0x1f) << 3;
                    let b = (raw & 0x1f) << 3;
                    total += (r as u64 + gch as u64 + b as u64) / 3;
                    count += 1;
                }
            }
        }
        total as f64 / count.max(1) as f64
    }
}

impl ApplicationHandler for App {
    fn resumed(&mut self, event_loop: &ActiveEventLoop) {
        if self.window.is_none() {
            self.init_gl_and_game(event_loop);
        }
    }

    fn window_event(&mut self, event_loop: &ActiveEventLoop, _id: winit::window::WindowId, event: WindowEvent) {
        match event {
            WindowEvent::CloseRequested => event_loop.exit(),
            WindowEvent::Resized(size) => {
                if let (Some(g), Some(w), Some(h)) = (
                    self.gl.as_ref(),
                    std::num::NonZeroU32::new(size.width),
                    std::num::NonZeroU32::new(size.height),
                ) {
                    g.surface.resize(&g.context, w, h);
                }
            }
            WindowEvent::KeyboardInput { event, .. } => {
                let pressed = event.state == ElementState::Pressed;
                let PhysicalKey::Code(code) = event.physical_key else { return };
                let bit = match code {
                    KeyCode::ArrowUp => Some(JOYPAD_UP),
                    KeyCode::ArrowDown => Some(JOYPAD_DOWN),
                    KeyCode::ArrowLeft => Some(JOYPAD_LEFT),
                    KeyCode::ArrowRight => Some(JOYPAD_RIGHT),
                    KeyCode::KeyZ => Some(JOYPAD_B),
                    KeyCode::KeyX => Some(JOYPAD_A),
                    KeyCode::KeyA => Some(JOYPAD_Y),
                    KeyCode::KeyS => Some(JOYPAD_X),
                    KeyCode::KeyQ => Some(JOYPAD_L),
                    KeyCode::KeyW => Some(JOYPAD_R),
                    KeyCode::KeyE => Some(JOYPAD_L2),
                    KeyCode::Enter => Some(JOYPAD_START),
                    KeyCode::ShiftRight => Some(JOYPAD_SELECT),
                    _ => None,
                };
                if let Some(id) = bit {
                    if pressed {
                        PAD_BITS.fetch_or(1 << id, Ordering::Relaxed);
                    } else {
                        PAD_BITS.fetch_and(!(1 << id), Ordering::Relaxed);
                    }
                    return;
                }
                // keyboard analog (IJKL)
                let analog = match code {
                    KeyCode::KeyI => Some((1, -32767)),
                    KeyCode::KeyK => Some((1, 32767)),
                    KeyCode::KeyJ => Some((0, -32767)),
                    KeyCode::KeyL => Some((0, 32767)),
                    _ => None,
                };
                if let Some((axis, val)) = analog {
                    self.key_analog[axis] = if pressed { val } else { 0 };
                    PAD_AX.store(self.key_analog[0], Ordering::Relaxed);
                    PAD_AY.store(self.key_analog[1], Ordering::Relaxed);
                    return;
                }
                match code {
                    KeyCode::Tab => self.fast_forward = pressed,
                    KeyCode::Escape if pressed => event_loop.exit(),
                    KeyCode::F5 if pressed => unsafe {
                        let size = (self.core.serialize_size)();
                        let mut buf = vec![0u8; size];
                        if size > 0 && (self.core.serialize)(buf.as_mut_ptr() as *mut c_void, size) {
                            self.save_slot = Some(buf);
                            println!("  state saved ({size} bytes)");
                        } else {
                            println!("  state save FAILED");
                        }
                    },
                    KeyCode::F7 if pressed => unsafe {
                        if let Some(buf) = &self.save_slot {
                            let ok = (self.core.unserialize)(buf.as_ptr() as *const c_void, buf.len());
                            println!("  state load {}", if ok { "ok" } else { "FAILED" });
                        } else {
                            println!("  no state saved yet (F5 first)");
                        }
                    },
                    _ => {}
                }
            }
            WindowEvent::RedrawRequested => {
                if !self.loaded {
                    return;
                }
                self.poll_gamepad();

                // Pace to the core's fps; fast-forward runs a batch unpaced.
                if self.fast_forward {
                    for _ in 0..4 {
                        self.run_one_frame();
                    }
                    self.next_frame = Instant::now();
                } else {
                    let now = Instant::now();
                    if now < self.next_frame {
                        std::thread::sleep(self.next_frame - now);
                    }
                    self.run_one_frame();
                    self.next_frame += self.frame_period();
                    if Instant::now() > self.next_frame + Duration::from_millis(250) {
                        self.next_frame = Instant::now(); // resync after a stall
                    }
                }
                if self.frames_run <= 5 {
                    eprintln!("  [trace] present #{}...", self.frames_run);
                }
                self.present();
                if self.frames_run <= 5 {
                    eprintln!("  [trace] present #{} done", self.frames_run);
                }

                if self.frames_run % 300 == 0 {
                    let lum = self.mean_luminance();
                    let hw = HW_ACTIVE.load(Ordering::Relaxed);
                    let ring = AUDIO.lock().unwrap().len();
                    eprintln!(
                        "  [probe] frame {} luminance {:.1} hw_path {} | audio in {} frames, ring {} , underruns {}",
                        self.frames_run,
                        lum,
                        hw,
                        AUDIO_IN.load(Ordering::Relaxed),
                        ring,
                        AUDIO_UNDERRUNS.load(Ordering::Relaxed)
                    );
                }

                if let Some(limit) = self.autoexit {
                    if self.frames_run >= limit {
                        let wall = self.started.elapsed().as_secs_f64();
                        let fps = self.frames_run as f64 / wall;
                        let lum = self.mean_luminance();
                        let hw = HW_ACTIVE.load(Ordering::Relaxed);
                        let ok_fps = fps > self.av.as_ref().map(|a| a.timing.fps * 0.9).unwrap_or(50.0);
                        let ok_lum = lum > 8.0;
                        println!(
                            "  autoexit after {} frames: {:.1} fps (target {:.1}), luminance {:.1}, hw_path {}",
                            self.frames_run,
                            fps,
                            self.av.as_ref().map(|a| a.timing.fps).unwrap_or(0.0),
                            lum,
                            hw
                        );
                        println!("  {} pacing holds ≥90% of target fps", if ok_fps { "ok  " } else { "FAIL" });
                        println!("  {} frame renders non-black", if ok_lum { "ok  " } else { "FAIL" });
                        if !ok_fps || !ok_lum {
                            self.failures += 1;
                        }
                        event_loop.exit();
                    }
                }
            }
            _ => {}
        }
    }

    fn about_to_wait(&mut self, _event_loop: &ActiveEventLoop) {
        if let Some(w) = self.window.as_ref() {
            w.request_redraw();
        }
    }
}

fn main() {
    let args: Vec<String> = std::env::args().collect();
    if args.len() < 3 {
        eprintln!("usage: {} <core> <rom>", args[0]);
        std::process::exit(2);
    }
    std::fs::create_dir_all("spike_data").ok();

    // Overrides must exist before the core registers its options (retro_init).
    if let Ok(raw) = std::env::var("SPIKE_OPT") {
        let mut ov = OVERRIDES.lock().unwrap();
        for pair in raw.split(';') {
            if let Some((k, v)) = pair.split_once('=') {
                ov.push((k.trim().to_string(), v.trim().to_string()));
            }
        }
        eprintln!("  [opts] {} override(s) from SPIKE_OPT", ov.len());
    }

    let core = Core::load(&args[1]).expect("dlopen + symbol resolution failed");
    unsafe {
        assert_eq!((core.api_version)(), API_VERSION, "libretro API version mismatch");
        (core.set_environment)(environment);
        (core.set_video_refresh)(video_refresh);
        (core.set_audio_sample)(audio_sample);
        (core.set_audio_sample_batch)(audio_sample_batch);
        (core.set_input_poll)(input_poll);
        (core.set_input_state)(input_state);
        (core.init)();
        let mut info = std::mem::zeroed::<SystemInfo>();
        (core.get_system_info)(&mut info);
        println!(
            "  core: {} {}",
            std::ffi::CStr::from_ptr(info.library_name).to_string_lossy(),
            std::ffi::CStr::from_ptr(info.library_version).to_string_lossy()
        );
    }

    let autoexit = std::env::var("SPIKE_AUTOEXIT").ok().and_then(|v| v.parse().ok());
    let mut app = App {
        core,
        rom_path: args[2].clone(),
        rom_bytes: Vec::new(),
        window: None,
        gl: None,
        av: None,
        loaded: false,
        gilrs: gilrs::Gilrs::new().ok(),
        _audio_stream: None,
        next_frame: Instant::now(),
        started: Instant::now(),
        frames_run: 0,
        fast_forward: false,
        key_analog: [0; 2],
        save_slot: None,
        autoexit,
        failures: 0,
    };

    let event_loop = EventLoop::new().expect("event loop");
    event_loop.set_control_flow(winit::event_loop::ControlFlow::Poll);
    event_loop.run_app(&mut app).expect("event loop run");

    // Teardown in libretro order.
    unsafe {
        if app.loaded {
            if let Some(hw) = HW.lock().unwrap().as_ref() {
                if let Some(destroy) = hw.context_destroy {
                    destroy();
                }
            }
            (app.core.unload_game)();
        }
        (app.core.deinit)();
    }

    if app.failures > 0 {
        println!("\nSPIKE PART 2: {} FAILURE(S)", app.failures);
        std::process::exit(1);
    }
    println!("\nSPIKE PART 2 CLEAN EXIT");
}
