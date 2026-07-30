# Frog Game Station — Known issues

Defects and platform limits that are known, reproduced, and **not yet fixed**. Each
entry records what was measured, what has already been ruled out, and where the next
lead points — so nobody re-chases a dead end.

Severity is about impact on play: **blocking** (a system is unusable), **degraded**
(it plays, but wrong), **cosmetic**, or **platform limit** (not fixable here).

| # | Issue | Systems | Severity |
|---|---|---|---|
| 1 | [Native N64 audio runs ~17% fast](#1-native-n64-audio-runs-17-fast) | N64 (desktop app) | Degraded |
| 2 | [The DS stylus does nothing](#2-the-ds-stylus-does-nothing) | DS (desktop app) | Blocking |
| 3 | [Disc-era playback is broken in desktop browsers](#3-disc-era-playback-is-broken-in-desktop-browsers) | N64/DS/PS1 (web) | Blocking |
| 4 | [Large ROMs cannot load on iOS](#4-large-roms-cannot-load-on-ios) | PS1, big DS carts (iOS) | Platform limit |
| 5 | [Sega Master System crashes mid-play on iPhone](#5-sega-master-system-crashes-mid-play-on-iphone) | SMS (iOS) | Blocking |
| 6 | [The offline error takes ~99s to appear](#6-the-offline-error-takes-99s-to-appear) | All (web) | Degraded |
| 7 | [N64 shows a green-black strip at the bottom](#7-n64-shows-a-green-black-strip-at-the-bottom) | N64 | Cosmetic |
| 8 | [The Quit confirm's focused button is hard to identify](#8-the-quit-confirms-focused-button-is-hard-to-identify) | All | Cosmetic |
| 9 | [One pre-v0.9.0 save state will not open on the phone](#9-one-pre-v090-save-state-will-not-open-on-the-phone) | N64 | Cosmetic |

---

## 1. Native N64 audio runs ~17% fast

**The core produces about 17% more audio than it declares.** Pre-existing, not a
Phase 3 regression — the ring was already pegged on v0.8.2. Two attempted fixes
measured well and still sounded wrong, which is the tell that the measurements were
not testing the thing that matters.

**Measured on an M4 (Mario Kart 64, `scripts/dev-desktop.sh --trace`):** the core
declares `timing.sample_rate` 44100 and actually pushes **~51,600 frames/s**
(`audio_in` in the frame trace). The device runs 48000/2ch, so `ratio` 0.9187 pins
consumption to exactly 44,100 — the ring gains ~7,500 frames a second, pegs at its
96,000 cap, and drops the oldest samples forever after. That is ~1s of latency plus
continuous dropouts, which reads to the ear as "running fast".

**Video is NOT affected** — measured 60.15 fps against a 59.94 NTSC target (+0.35%).
Don't re-chase this; it was ruled out.

**Also ruled out:** no mid-session `SET_SYSTEM_AV_INFO` rate change (the host's drift
warning never fired); core options are v1 `SET_VARIABLES` only, where
first-value-is-default is the spec, so nothing is being silently flipped.

**Untested, and the best next lead:** macOS forces `mupen64plus-rsp-plugin=cxd4`
(LLE RSP, see `default_options`). With HLE RSP the core's high-level audio path
resamples to the declared rate; LLE may emit at the console's native AI clock
(`vi_clock / (dacrate + 1)` ≈ 51,570 Hz, which matches the measurement almost
exactly). **Run the A/B** — one attempt produced no data because the session hit the
dev double-mount race. Note that 859 samples/frame at 60 fps is consistent with a
51,570 Hz source, so the rate may well be honest and the declaration simply wrong.

**Second lead, if the rate is honest:** the resampler lerps between two frames
(`ring[0..4]`), so at a ratio above 1.0 it SKIPS source frames with no filtering —
textbook aliasing, which sounds like distorted music and a rough voice while ring
occupancy looks perfectly healthy. The reported crackle is concentrated on dense
audio (loading screen, engine roar), which fits aliasing better than starvation.
**Verify by decoding captured output, not by watching the buffer** — that is the
mistake both attempts made.

**Prior art** is in `git stash` ("wip: n64 audio rate-steering (backlogged)"):
occupancy-steered then measured-rate resampling, with tests. Attempt 1 warbled (±10%
proportional term = ±1.5 semitones); attempt 2 held pitch to ±0.5% and parked the ring
at 2× target, but still sounded off. Kept from that work: the `audio_in`/rate traces,
and a real bug fix — `audio_sample` never trimmed the ring, so a core pushing one
frame at a time could grow it without bound.

`FROG_EMU_TRACE=1` prints the declared/device pair and the core's real production rate.

## 2. The DS stylus does nothing

Chrono Trigger's "Touch to start" cannot be dismissed by touching (A/Enter work).
**Narrowed, not fixed.**

The `FROG_EMU_TRACE` stylus trace in `set_pointer` proves the webview → command →
letterbox chain is CORRECT — a real click logs
`stylus css(400,527) x2 -> picture(0.276,0.659) rect(213,0,2133x1600)`, and the
arithmetic checks out. So the pointer reaches `input::pointer` with good coordinates
and the bug is downstream: how melonDS is fed or polled.

**Next:** look at `DEVICE_POINTER`/`POINTER_COUNT` in `input::state`, whether the core
needs `retro_set_controller_port_device(0, RETRO_DEVICE_POINTER)`, and whether
`clear_snapshot()` (which zeroes `POINTER_DOWN` along with the pad) is firing mid-play.

## 3. Disc-era playback is broken in desktop browsers

**Two distinct problems.** The strategic response to the first is that the native
desktop app, not the browser, is the real home for these systems — see
`docs/NATIVE_APP_PLAN.md`.

**Desktop Mac browsers black-screen the big cores at the engine start screen.** Safari
AND Firefox, all PS1 and DS ROMs, and N64 too, on a machine with RAM to spare. This is
NOT a memory problem — it is a core/WebGL/WASM compatibility failure, and the same
ROMs work headless (software GL). Load-bearing clue: **N64 works on iOS Safari but not
Mac Safari** — the engine serves parallel_n64 to mobile and mupen64plus_next to
desktop, so the leading hypothesis is "mupen64plus_next fails on desktop macOS WebGL;
force parallel_n64 everywhere and re-test." Confirming it needs the browser console
error (Firefox Cmd+Opt+K).

**iOS has a memory ceiling** for ROMs ≥ ~300 MB — see issue 4.

## 4. Large ROMs cannot load on iOS

Confirmed on an iPad: a 459 MB PS1 `.chd` and a 512 MB DS `.nds` both die — the tab
hits WebKit's per-tab memory ceiling loading the ROM into the WASM heap (the transient
double-copy during load roughly doubles it). Both boot fine on desktop Chrome (proven
headlessly), so this is a hard platform limit, not a bug.

**Shipped mitigations** (2026-07-24): a **load watchdog** turns the infinite hang into
an honest "this game didn't load — plays best on a computer or TV" after 75s, and the
game page shows a **large-game heads-up** on touch devices (ROM ≥ `LARGE_ROM_BYTES`,
300 MB).

**Not solved, and probably not solvable in-browser:** actually playing these on iOS.
Possible future angles — a smaller-footprint core, or accepting these as
couch/desktop-only and gating them out of the phone UI (capability gating already
does the latter for PS1 and DS on touch). The 300 MB threshold wants calibrating
against medium DS carts (Chrono Trigger 128 MB, Mario Kart DS 32 MB should be fine)
on real hardware.

## 5. Sega Master System crashes mid-play on iPhone

Reported 2026-07-26: Sonic (SMS) crashed after about a minute of play in the iPhone
PWA. The same session played a GBA and an N64 game fine, so it is system-specific,
not the player.

**First diagnostic pass:** reproduce with the iPhone tethered to Safari's Web
Inspector for the console/crash line; check whether the SMS core OOMs or throws; try
the same ROM on an iPad and in desktop Safari to size the blast radius. If it is the
core, the levers are core options or pointing SMS at a different engine core.

Worth actually fixing, unlike the disc era: the cartridge tier is the PWA's home turf
under the platform-responsibility split.

## 6. The offline error takes ~99s to appear

When the server is genuinely down, the library waits out the full retry backoff before
giving up, so an offline server looks like a slow one for a minute and a half.

**The fix is already sitting there:** the `OnlineProvider` health probe fails in ~4s
and the "Offline" chip already renders off it, so surface the error from that instead
of from the backoff running out. Deliberately parked when the retry fix shipped — the
honest error was the win, its latency is the polish.

## 7. N64 shows a green-black strip at the bottom

A roughly 1/3-inch strip at the bottom of the screen. Three fixes attempted, none
landed, so the diagnosis is still open:

1. The player swaps theme-color to black — no change.
2. The player wrapper was already `bg-black` with safe-area padding.
3. mupen64plus overscan crop (`OverscanBottom=12`, kept — harmless and standard) — no
   change.

Never reproduces headlessly (software GL renders those regions clean black).

**Next diagnostic step:** record which device/browser it appears on, plus a photo of
the strip, then bisect between iOS PWA letterbox chrome (the manifest
`background_color` is pond green `#0b1512` — a suspect if it is the iPad) and in-frame
rendering.

## 8. The Quit confirm's focused button is hard to identify

**Root cause:** focus is encoded in the SAME channel (accent colour) that the danger
variant already uses for meaning. `Button.jsx` gives `solid` a glow in its own accent,
so focusing the red Quit button draws a red glow on red and vanishes, while the quiet
"Keep playing" gets a clearly visible jade ring. The two states speak different
languages and the important one is mute.

**Recommendation:** give focus its own constant channel — a 2px outline in one cursor
colour at `outline-offset: 3px`, identical on both variants (an outline sits outside
the fill, so unlike an inset ring it survives a solid background) — plus dim the
unfocused sibling to ~60% so the pair reads as figure/ground. Keep the scale nudge.

Lands in `Button.jsx`, so it touches every focus cursor in the app: its own commit,
and re-check the other panels.

## 9. One pre-v0.9.0 save state will not open on the phone

Every state written before v0.9.0 by the NATIVE player is raw core bytes rather than
RASTATE — in practice exactly one, a Mario Kart 64 state from the Phase 2a validation.
The desktop still loads it (the unwrap passes non-container bytes through, and that
path is tested), but the web player cannot.

Not worth a migration for a single slot: re-save it in the desktop app and the problem
is gone. Listed so it is not rediscovered as a bug.
