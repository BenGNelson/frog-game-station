// Which player backend this build targets. The web build (default) plays through
// the in-browser EmulatorJS iframe and ships the PWA machinery (service worker,
// install nudge, offline downloads). The desktop build (`VITE_TARGET=desktop`,
// set by the Tauri shell's build scripts) is the same UI in a native window: no
// service worker — so no install nudge and no offline-download affordance (the
// worker is the only thing that can serve a download back) — and, from Phase 2,
// a native emulator core behind the same screens.
//
// A build-time flag rather than runtime `window.__TAURI__` sniffing: the desktop
// app is a separate artifact anyway, the flag is deterministic under test, and
// dead branches tree-shake out of each build.
export function isNative() {
  return import.meta.env.VITE_TARGET === 'desktop'
}
