// Headless libretro host — spike part 1.
//
// Proves the four things the native player depends on, with no window, audio
// device, or gamepad in the loop:
//   1. a real core dlopens and drives through the retro_* lifecycle
//   2. a real ROM boots and RENDERS (non-black frames, measured, not assumed)
//   3. save states round-trip: serialize -> diverge -> unserialize -> replay
//      reproduces the exact same framebuffer (determinism check)
//   4. the whole loop runs faster than real time on this machine
//
//   cargo run --release -- cores/gambatte_libretro.so roms/ucity.gbc [frames] [replay]

mod libretro;

use libretro::*;
use std::ffi::CString;
use std::os::raw::{c_char, c_uint, c_void};
use std::sync::Mutex;
use std::time::Instant;

struct HostState {
    pixel_format: c_uint,
    frames: u64,
    dupes: u64,
    audio_frames: u64,
    width: u32,
    height: u32,
    last_frame: Vec<u8>, // tightly packed rows (pitch stripped)
}

static STATE: Mutex<HostState> = Mutex::new(HostState {
    pixel_format: PIXFMT_0RGB1555,
    frames: 0,
    dupes: 0,
    audio_frames: 0,
    width: 0,
    height: 0,
    last_frame: Vec::new(),
});

// Directory handed to the core for system/save files. Static so the pointer the
// core keeps stays valid for the whole run.
static DATA_DIR: &str = "spike_data\0";

unsafe extern "C" fn environment(cmd: c_uint, data: *mut c_void) -> bool {
    match cmd {
        ENV_GET_CAN_DUPE => {
            *(data as *mut bool) = true;
            true
        }
        ENV_SET_PIXEL_FORMAT => {
            STATE.lock().unwrap().pixel_format = *(data as *const c_uint);
            true
        }
        ENV_GET_SYSTEM_DIRECTORY | ENV_GET_SAVE_DIRECTORY => {
            *(data as *mut *const c_char) = DATA_DIR.as_ptr() as *const c_char;
            true
        }
        // Everything else (log interface, variables, hw-render, ...) declined;
        // how a core copes with refusal is exactly what the spike measures.
        other => {
            static SEEN: Mutex<Vec<c_uint>> = Mutex::new(Vec::new());
            let mut seen = SEEN.lock().unwrap();
            let base = other & !ENV_EXPERIMENTAL;
            if !seen.contains(&base) {
                seen.push(base);
                if other & ENV_EXPERIMENTAL != 0 {
                    eprintln!("  [env] declined experimental cmd {base}");
                } else {
                    eprintln!("  [env] declined cmd {base}");
                }
            }
            false
        }
    }
}

unsafe extern "C" fn video_refresh(data: *const c_void, width: c_uint, height: c_uint, pitch: usize) {
    let mut st = STATE.lock().unwrap();
    st.frames += 1;
    if data.is_null() {
        st.dupes += 1; // frame dupe: previous frame still valid
        return;
    }
    let bpp = if st.pixel_format == PIXFMT_XRGB8888 { 4 } else { 2 };
    let row_bytes = width as usize * bpp;
    st.width = width;
    st.height = height;
    st.last_frame.clear();
    for y in 0..height as usize {
        let row = std::slice::from_raw_parts((data as *const u8).add(y * pitch), row_bytes);
        st.last_frame.extend_from_slice(row);
    }
}

unsafe extern "C" fn audio_sample(_l: i16, _r: i16) {
    STATE.lock().unwrap().audio_frames += 1;
}

unsafe extern "C" fn audio_sample_batch(_data: *const i16, frames: usize) -> usize {
    STATE.lock().unwrap().audio_frames += frames as u64;
    frames
}

unsafe extern "C" fn input_poll() {}

unsafe extern "C" fn input_state(_port: c_uint, _device: c_uint, _index: c_uint, _id: c_uint) -> i16 {
    0 // no buttons held; determinism depends on this being constant
}

/// Mean luminance (0..=255) of the captured frame, per pixel format.
fn luminance(st: &HostState) -> f64 {
    if st.last_frame.is_empty() {
        return 0.0;
    }
    let mut total = 0u64;
    let mut count = 0u64;
    match st.pixel_format {
        PIXFMT_XRGB8888 => {
            for px in st.last_frame.chunks_exact(4) {
                total += (px[0] as u64 + px[1] as u64 + px[2] as u64) / 3;
                count += 1;
            }
        }
        PIXFMT_RGB565 => {
            for px in st.last_frame.chunks_exact(2) {
                let v = u16::from_le_bytes([px[0], px[1]]);
                let r = ((v >> 11) & 0x1f) << 3;
                let g = ((v >> 5) & 0x3f) << 2;
                let b = (v & 0x1f) << 3;
                total += (r as u64 + g as u64 + b as u64) / 3;
                count += 1;
            }
        }
        _ => {
            for px in st.last_frame.chunks_exact(2) {
                let v = u16::from_le_bytes([px[0], px[1]]);
                let r = ((v >> 10) & 0x1f) << 3;
                let g = ((v >> 5) & 0x1f) << 3;
                let b = (v & 0x1f) << 3;
                total += (r as u64 + g as u64 + b as u64) / 3;
                count += 1;
            }
        }
    }
    total as f64 / count as f64
}

fn frame_hash(st: &HostState) -> u64 {
    // FNV-1a over the packed frame — cheap and enough to compare two frames.
    let mut h: u64 = 0xcbf29ce484222325;
    for &b in &st.last_frame {
        h ^= b as u64;
        h = h.wrapping_mul(0x100000001b3);
    }
    h
}

fn c_str(ptr: *const c_char) -> String {
    if ptr.is_null() {
        return String::new();
    }
    unsafe { std::ffi::CStr::from_ptr(ptr).to_string_lossy().into_owned() }
}

fn main() {
    let args: Vec<String> = std::env::args().collect();
    if args.len() < 3 {
        eprintln!("usage: {} <core.so> <rom> [frames] [replay]", args[0]);
        std::process::exit(2);
    }
    let (core_path, rom_path) = (&args[1], &args[2]);
    let warmup: u64 = args.get(3).and_then(|s| s.parse().ok()).unwrap_or(600);
    let replay: u64 = args.get(4).and_then(|s| s.parse().ok()).unwrap_or(180);

    std::fs::create_dir_all("spike_data").ok();
    let core = Core::load(core_path).expect("dlopen + symbol resolution failed");
    let mut failures = 0;
    let mut check = |ok: bool, msg: &str| {
        println!("  {} {}", if ok { "ok  " } else { "FAIL" }, msg);
        if !ok {
            failures += 1;
        }
    };

    unsafe {
        let api = (core.api_version)();
        check(api == API_VERSION, &format!("retro_api_version == 1 (got {api})"));

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
            "  core: {} {} (extensions: {}, need_fullpath: {})",
            c_str(info.library_name),
            c_str(info.library_version),
            c_str(info.valid_extensions),
            info.need_fullpath
        );

        let rom = std::fs::read(rom_path).expect("rom read failed");
        let path_c = CString::new(rom_path.as_str()).unwrap();
        let game = GameInfo {
            path: path_c.as_ptr(),
            data: if info.need_fullpath { std::ptr::null() } else { rom.as_ptr() as *const c_void },
            size: rom.len(),
            meta: std::ptr::null(),
        };
        let loaded = (core.load_game)(&game);
        check(loaded, "retro_load_game accepts the ROM");
        if !loaded {
            // A refused load is a clean, expected outcome (e.g. a HW-render core
            // denied its GL context); running the core anyway is undefined.
            println!("\nSPIKE PART 1: core declined the game — see declined env commands above");
            std::process::exit(1);
        }

        let mut av = std::mem::zeroed::<SystemAvInfo>();
        (core.get_system_av_info)(&mut av);
        println!(
            "  av: {}x{} @ {:.2} fps, audio {:.0} Hz",
            av.geometry.base_width, av.geometry.base_height, av.timing.fps, av.timing.sample_rate
        );

        // --- boot + render proof ---
        let t0 = Instant::now();
        for _ in 0..warmup {
            (core.run)();
        }
        let wall = t0.elapsed().as_secs_f64();
        let emulated = warmup as f64 / av.timing.fps;
        let speed = emulated / wall;
        {
            let st = STATE.lock().unwrap();
            check(st.frames >= warmup, &format!("video callback fired every frame ({}/{warmup})", st.frames));
            check(st.audio_frames > 0, &format!("audio callback delivered samples ({})", st.audio_frames));
            let lum = luminance(&st);
            check(lum > 8.0, &format!("frame {} renders non-black (mean luminance {:.1}, {}x{})", warmup, lum, st.width, st.height));
        }
        check(speed > 1.0, &format!("faster than real time headless ({:.1}x: {warmup} frames in {:.2}s)", speed, wall));

        // --- save-state round trip + determinism ---
        let size = (core.serialize_size)();
        check(size > 0, &format!("serialize_size > 0 ({size} bytes)"));
        let mut state = vec![0u8; size];
        check((core.serialize)(state.as_mut_ptr() as *mut c_void, size), "retro_serialize succeeds");

        for _ in 0..replay {
            (core.run)();
        }
        let hash_a = frame_hash(&STATE.lock().unwrap());

        check((core.unserialize)(state.as_ptr() as *const c_void, size), "retro_unserialize succeeds");
        for _ in 0..replay {
            (core.run)();
        }
        let hash_b = frame_hash(&STATE.lock().unwrap());
        check(
            hash_a == hash_b,
            &format!("replaying {replay} frames after state load reproduces the identical frame ({hash_a:016x})"),
        );

        (core.unload_game)();
        (core.deinit)();
    }

    if failures > 0 {
        println!("\nSPIKE PART 1: {failures} FAILURE(S)");
        std::process::exit(1);
    }
    println!("\nSPIKE PART 1 PASSED");
}
