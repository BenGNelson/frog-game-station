// Minimal hand-written libretro FFI — just the slice of the API this host uses.
// The libretro ABI is C, version 1, and stable; the full header is ~2000 lines but a
// frontend needs ~18 symbols and a handful of environment commands to run a core.
#![allow(dead_code)]

use std::os::raw::{c_char, c_uint, c_void};

pub const API_VERSION: c_uint = 1;

// Environment commands (RETRO_ENVIRONMENT_*)
pub const ENV_GET_CAN_DUPE: c_uint = 3;
pub const ENV_GET_SYSTEM_DIRECTORY: c_uint = 9;
pub const ENV_SET_PIXEL_FORMAT: c_uint = 10;
pub const ENV_GET_VARIABLE: c_uint = 15;
pub const ENV_SET_VARIABLES: c_uint = 16;
pub const ENV_GET_VARIABLE_UPDATE: c_uint = 17;
pub const ENV_GET_LOG_INTERFACE: c_uint = 27;
pub const ENV_GET_SAVE_DIRECTORY: c_uint = 31;
pub const ENV_SET_HW_RENDER: c_uint = 14;
pub const ENV_GET_AUDIO_VIDEO_ENABLE: c_uint = 47;
pub const ENV_GET_PREFERRED_HW_RENDER: c_uint = 56;
pub const ENV_EXPERIMENTAL: c_uint = 0x10000;

// retro_hw_context_type
pub const HW_CONTEXT_OPENGL: c_uint = 1;
pub const HW_CONTEXT_OPENGL_CORE: c_uint = 3;

// RETRO_DEVICE_*
pub const DEVICE_JOYPAD: c_uint = 1;
pub const DEVICE_ANALOG: c_uint = 5;

// RETRO_DEVICE_ID_JOYPAD_*
pub const JOYPAD_B: c_uint = 0;
pub const JOYPAD_Y: c_uint = 1;
pub const JOYPAD_SELECT: c_uint = 2;
pub const JOYPAD_START: c_uint = 3;
pub const JOYPAD_UP: c_uint = 4;
pub const JOYPAD_DOWN: c_uint = 5;
pub const JOYPAD_LEFT: c_uint = 6;
pub const JOYPAD_RIGHT: c_uint = 7;
pub const JOYPAD_A: c_uint = 8;
pub const JOYPAD_X: c_uint = 9;
pub const JOYPAD_L: c_uint = 10;
pub const JOYPAD_R: c_uint = 11;
pub const JOYPAD_L2: c_uint = 12;
pub const JOYPAD_R2: c_uint = 13;

// RETRO_DEVICE_INDEX_ANALOG_* / RETRO_DEVICE_ID_ANALOG_*
pub const ANALOG_LEFT: c_uint = 0;
pub const ANALOG_X: c_uint = 0;
pub const ANALOG_Y: c_uint = 1;

// RETRO_MEMORY_* — the SRAM region (the battery save that roams with the phone).
pub const MEMORY_SAVE_RAM: c_uint = 0;

/// retro_variable — the legacy core-options handshake: SET_VARIABLES hands the
/// frontend an array of {key, "Description; default|opt|..."}; GET_VARIABLE asks
/// for the current value of one key (pointer must stay valid frontend-side).
#[repr(C)]
pub struct RetroVariable {
    pub key: *const c_char,
    pub value: *const c_char,
}

/// Signals a hardware-rendered frame in the video_refresh callback.
pub const HW_FRAME_BUFFER_VALID: *const c_void = usize::MAX as *const c_void;

pub type HwContextResetFn = unsafe extern "C" fn();
pub type HwGetCurrentFramebufferFn = unsafe extern "C" fn() -> usize;
pub type HwGetProcAddressFn = unsafe extern "C" fn(sym: *const c_char) -> *const c_void;

/// retro_hw_render_callback — the contract for cores that render with the host's GL
/// context (mupen64plus_next et al). The core fills most fields in SET_HW_RENDER;
/// the host fills `get_current_framebuffer` + `get_proc_address` and calls
/// `context_reset` once the context exists.
#[repr(C)]
pub struct HwRenderCallback {
    pub context_type: c_uint,
    pub context_reset: Option<HwContextResetFn>,
    pub get_current_framebuffer: Option<HwGetCurrentFramebufferFn>,
    pub get_proc_address: Option<HwGetProcAddressFn>,
    pub depth: bool,
    pub stencil: bool,
    pub bottom_left_origin: bool,
    pub version_major: c_uint,
    pub version_minor: c_uint,
    pub cache_context: bool,
    pub context_destroy: Option<HwContextResetFn>,
    pub debug_context: bool,
}

// retro_pixel_format
pub const PIXFMT_0RGB1555: c_uint = 0;
pub const PIXFMT_XRGB8888: c_uint = 1;
pub const PIXFMT_RGB565: c_uint = 2;

#[repr(C)]
pub struct SystemInfo {
    pub library_name: *const c_char,
    pub library_version: *const c_char,
    pub valid_extensions: *const c_char,
    pub need_fullpath: bool,
    pub block_extract: bool,
}

#[repr(C)]
pub struct GameGeometry {
    pub base_width: c_uint,
    pub base_height: c_uint,
    pub max_width: c_uint,
    pub max_height: c_uint,
    pub aspect_ratio: f32,
}

#[repr(C)]
pub struct SystemTiming {
    pub fps: f64,
    pub sample_rate: f64,
}

#[repr(C)]
pub struct SystemAvInfo {
    pub geometry: GameGeometry,
    pub timing: SystemTiming,
}

#[repr(C)]
pub struct GameInfo {
    pub path: *const c_char,
    pub data: *const c_void,
    pub size: usize,
    pub meta: *const c_char,
}

pub type EnvironmentFn = unsafe extern "C" fn(cmd: c_uint, data: *mut c_void) -> bool;
pub type VideoRefreshFn = unsafe extern "C" fn(data: *const c_void, width: c_uint, height: c_uint, pitch: usize);
pub type AudioSampleFn = unsafe extern "C" fn(left: i16, right: i16);
pub type AudioSampleBatchFn = unsafe extern "C" fn(data: *const i16, frames: usize) -> usize;
pub type InputPollFn = unsafe extern "C" fn();
pub type InputStateFn = unsafe extern "C" fn(port: c_uint, device: c_uint, index: c_uint, id: c_uint) -> i16;

/// The dlopen'd core: every symbol the host calls, resolved once.
pub struct Core {
    _lib: libloading::Library, // keeps the dylib alive for the symbols' lifetime
    pub api_version: unsafe extern "C" fn() -> c_uint,
    pub init: unsafe extern "C" fn(),
    pub deinit: unsafe extern "C" fn(),
    pub set_environment: unsafe extern "C" fn(EnvironmentFn),
    pub set_video_refresh: unsafe extern "C" fn(VideoRefreshFn),
    pub set_audio_sample: unsafe extern "C" fn(AudioSampleFn),
    pub set_audio_sample_batch: unsafe extern "C" fn(AudioSampleBatchFn),
    pub set_input_poll: unsafe extern "C" fn(InputPollFn),
    pub set_input_state: unsafe extern "C" fn(InputStateFn),
    pub get_system_info: unsafe extern "C" fn(*mut SystemInfo),
    pub get_system_av_info: unsafe extern "C" fn(*mut SystemAvInfo),
    pub load_game: unsafe extern "C" fn(*const GameInfo) -> bool,
    pub unload_game: unsafe extern "C" fn(),
    pub run: unsafe extern "C" fn(),
    pub reset: unsafe extern "C" fn(),
    pub serialize_size: unsafe extern "C" fn() -> usize,
    pub serialize: unsafe extern "C" fn(*mut c_void, usize) -> bool,
    pub unserialize: unsafe extern "C" fn(*const c_void, usize) -> bool,
    // The SRAM window: the spike never needed these; the player's roaming does.
    pub get_memory_data: unsafe extern "C" fn(c_uint) -> *mut c_void,
    pub get_memory_size: unsafe extern "C" fn(c_uint) -> usize,
}

impl Core {
    pub fn load(path: &str) -> Result<Core, Box<dyn std::error::Error>> {
        unsafe {
            let lib = libloading::Library::new(path)?;
            macro_rules! sym {
                ($name:literal) => {
                    *lib.get(concat!($name, "\0").as_bytes())?
                };
            }
            Ok(Core {
                api_version: sym!("retro_api_version"),
                init: sym!("retro_init"),
                deinit: sym!("retro_deinit"),
                set_environment: sym!("retro_set_environment"),
                set_video_refresh: sym!("retro_set_video_refresh"),
                set_audio_sample: sym!("retro_set_audio_sample"),
                set_audio_sample_batch: sym!("retro_set_audio_sample_batch"),
                set_input_poll: sym!("retro_set_input_poll"),
                set_input_state: sym!("retro_set_input_state"),
                get_system_info: sym!("retro_get_system_info"),
                get_system_av_info: sym!("retro_get_system_av_info"),
                load_game: sym!("retro_load_game"),
                unload_game: sym!("retro_unload_game"),
                run: sym!("retro_run"),
                reset: sym!("retro_reset"),
                serialize_size: sym!("retro_serialize_size"),
                serialize: sym!("retro_serialize"),
                unserialize: sym!("retro_unserialize"),
                get_memory_data: sym!("retro_get_memory_data"),
                get_memory_size: sym!("retro_get_memory_size"),
                _lib: lib,
            })
        }
    }
}
