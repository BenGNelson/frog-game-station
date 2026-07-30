// Audio: the core's samples → ring → cpal, with the jitter buffer the Mac
// validation proved out, plus the one thing the spike didn't need — a volume
// gain the pause menu can drive.
//
// Contracts preserved verbatim from the spike:
//  - ring capped at ~1s of 48k stereo (backstop, never grows unbounded)
//  - after an underrun, HOLD and emit silence until ~40ms of core-rate audio
//    has refilled — occasional quiet beats crackle, and stale samples are
//    never repeated
//  - no output device (headless CI) ⇒ run silent, never fail

use std::collections::VecDeque;
use std::sync::atomic::{AtomicU32, AtomicU64, Ordering};
use std::sync::Mutex;

pub static RING: Mutex<VecDeque<i16>> = Mutex::new(VecDeque::new());
pub static FRAMES_IN: AtomicU64 = AtomicU64::new(0);
pub static UNDERRUNS: AtomicU64 = AtomicU64::new(0);
// Volume 0.0..=1.0 as f32 bits; the player seeds it from settings on boot.
static GAIN: AtomicU32 = AtomicU32::new(0x3f80_0000); // 1.0f32

pub fn set_gain(level: f32) {
    GAIN.store(level.clamp(0.0, 1.0).to_bits(), Ordering::Relaxed);
}

fn gain() -> f32 {
    f32::from_bits(GAIN.load(Ordering::Relaxed))
}

/// The backstop: audio can never hoard more than ~1s of 48k stereo.
const RING_CAP: usize = 48000 * 2;

fn trim(a: &mut VecDeque<i16>) {
    while a.len() > RING_CAP {
        a.pop_front();
    }
}

pub unsafe extern "C" fn audio_sample(l: i16, r: i16) {
    FRAMES_IN.fetch_add(1, Ordering::Relaxed);
    let mut a = RING.lock().unwrap();
    a.push_back(l);
    a.push_back(r);
    // The batch path has always trimmed; this one hadn't, so a core that pushes
    // one frame at a time could grow the ring without bound.
    trim(&mut a);
}

pub unsafe extern "C" fn audio_sample_batch(data: *const i16, frames: usize) -> usize {
    FRAMES_IN.fetch_add(frames as u64, Ordering::Relaxed);
    let s = std::slice::from_raw_parts(data, frames * 2);
    let mut a = RING.lock().unwrap();
    a.extend(s.iter().copied());
    trim(&mut a);
    frames
}

/// Open the default output device at its own rate, resampling from the core's.
/// Returns None (silently) when no device exists — the session keeps running.
pub fn start(core_rate: f64) -> Option<cpal::Stream> {
    use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
    RING.lock().unwrap().clear();
    let host = cpal::default_host();
    let device = host.default_output_device()?;
    let config = device.default_output_config().ok()?;
    let device_rate = config.sample_rate().0 as f64;
    let channels = config.channels() as usize;
    let ratio = core_rate / device_rate; // source frames consumed per output frame
    // The two numbers behind the N64 audio defect (docs/TODO.md): consumption is
    // pinned to the core's DECLARED rate — the callback runs at device_rate and
    // each output frame eats `ratio` source frames, so the product is exactly
    // core_rate — while mupen64plus-next actually pushes ~51.6 kHz against a
    // declared 44.1 kHz. Nothing else in the app can show you that pair.
    if std::env::var("FROG_EMU_TRACE").ok().as_deref() == Some("1") {
        eprintln!(
            "[emu] audio core {core_rate:.0} Hz -> device {device_rate:.0} Hz \
             ({channels}ch, ratio {ratio:.4})"
        );
    }
    let mut src_pos: f64 = 0.0;
    let low_water = (core_rate * 0.04) as usize * 2; // ~40ms of core-rate stereo
    let mut holding = true;
    let stream = device
        .build_output_stream(
            &config.into(),
            move |out: &mut [f32], _| {
                let g = gain();
                let mut ring = RING.lock().unwrap();
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
                    while src_pos >= 1.0 && ring.len() >= 2 {
                        ring.pop_front();
                        ring.pop_front();
                        src_pos -= 1.0;
                    }
                    let (l, r) = if ring.len() >= 4 {
                        let f = src_pos as f32;
                        let l0 = ring[0] as f32;
                        let r0 = ring[1] as f32;
                        let l1 = ring[2] as f32;
                        let r1 = ring[3] as f32;
                        ((l0 + (l1 - l0) * f) / 32768.0, (r0 + (r1 - r0) * f) / 32768.0)
                    } else {
                        UNDERRUNS.fetch_add(1, Ordering::Relaxed);
                        holding = true;
                        (0.0, 0.0)
                    };
                    frame[0] = l * g;
                    for c in frame.iter_mut().skip(1) {
                        *c = r * g;
                    }
                    src_pos += ratio;
                }
            },
            |e| eprintln!("[emu] audio error: {e}"),
            None,
        )
        .ok()?;
    stream.play().ok()?;
    Some(stream)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn gain_clamps_to_unit_range() {
        set_gain(1.7);
        assert_eq!(gain(), 1.0);
        set_gain(-0.3);
        assert_eq!(gain(), 0.0);
        set_gain(0.5);
        assert_eq!(gain(), 0.5);
        set_gain(1.0);
    }
}
