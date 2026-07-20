// Pure helpers for the Library (owned-content hub). The pages just render.
import { API_BASE } from './useApi.js'

// A constant-palette accent for the games section. Constant RGB (not a theme
// token) so the colour survives a theme swap, the same rule the back-lit radiance
// motif follows. `rgb` feeds the glow/backdrop helpers; `text` tints the Lucide
// icon. Kept as a keyed lookup (with a neutral default) so callers stay uniform.
const SECTION_ACCENTS = {
  games: { rgb: '139,92,246', text: 'text-violet-300' },
}
const _DEFAULT_ACCENT = { rgb: '148,163,184', text: 'text-slate-300' }
export function sectionAccent(key) {
  return SECTION_ACCENTS[key] || _DEFAULT_ACCENT
}

// Where the EmulatorJS engine + cores load from. Default: self-hosted at
// /emulatorjs/ (populate with scripts/fetch-emulatorjs.sh — a pinned, gitignored
// bundle, so nothing third-party is committed and play time makes no external
// calls). To use the official pinned CDN instead, set this to
// 'https://cdn.emulatorjs.org/4.2.3/data/'. emulator.html allowlists both forms.
export const EMULATORJS_DATA = '/emulatorjs/'

// The engine's loader script, under the configured base. When the base is a local
// path (the self-hosted default), the app can HEAD this to detect an engine that
// hasn't been fetched yet (scripts/fetch-emulatorjs.sh) and show a friendly notice
// instead of a silently-broken player. A remote CDN base is assumed present (a
// cross-origin HEAD would be unreliable, and the CDN engine works out of the box).
export const ENGINE_LOADER_URL = `${EMULATORJS_DATA}loader.js`
export function engineIsLocal() {
  return EMULATORJS_DATA.startsWith('/')
}

// URL the backend streams an item's bytes from. Range-capable, so a reader or
// emulator can fetch only the bytes it needs (matters for big PDFs later).
export function fileUrl(section, id) {
  return `${API_BASE}/library/file?section=${encodeURIComponent(section)}&id=${encodeURIComponent(id)}`
}

// Proxied + cached box art for a game (404 → caller shows a placeholder).
// A game's cover. `v` is the user-set cover version (a game's `cover_v`, the custom
// cover's mtime): when present it rides the URL as `&v=…`, which is the ONLY way to
// bust the cover's 30-day `immutable` cache after someone sets a new cover from an
// in-game frame — same fixed URL, so without it the old art would be pinned for a month.
export function coverUrl(id, v) {
  const base = `${API_BASE}/library/games/cover?id=${encodeURIComponent(id)}`
  return v ? `${base}&v=${v}` : base
}

// Set a game's cover from a captured frame (a PNG Blob) — stored server-side and served
// ahead of libretro art. Resolves to the response so the caller can read the new cover_v.
export function postCover(id, blob) {
  const body = new FormData()
  body.append('id', id)
  body.append('cover', blob, 'cover.png')
  return fetch(`${API_BASE}/library/games/cover`, { method: 'POST', body })
}

// Drop a game's user-set cover, reverting to its libretro/sidecar art.
export function deleteCover(id) {
  return fetch(`${API_BASE}/library/games/cover?id=${encodeURIComponent(id)}`, { method: 'DELETE' })
}

// Server-side save states for a game (roam across devices).
export function saveStatesUrl(id) {
  return `${API_BASE}/library/games/save-states?id=${encodeURIComponent(id)}`
}
// The state blob — what EJS_loadStateURL fetches to resume into a state.
export function saveStateUrl(id, slot) {
  return `${API_BASE}/library/games/save-state?id=${encodeURIComponent(id)}&slot=${encodeURIComponent(slot)}`
}
// A save state's screenshot (detail-page thumbnail).
export function saveStateShotUrl(id, slot) {
  return `${API_BASE}/library/games/save-state/screenshot?id=${encodeURIComponent(id)}&slot=${encodeURIComponent(slot)}`
}
// Rename / annotate / pin a save slot (POST {id, slot, label, note, pinned}).
export function saveStateMetaUrl() {
  return `${API_BASE}/library/games/save-states/meta`
}

// A game's rich IGDB metadata (screenshots/summary/genres/rating) for the game
// screen. Returns {matched:false} for a ROM hack / not-looked-up / no-key game;
// the frontend renders its basic layout then.
export function gameMetaUrl(id) {
  return `${API_BASE}/library/games/meta?id=${encodeURIComponent(id)}`
}
// One IGDB image (cover or screenshot) for a game, by its IGDB image id — proxied
// + cached WebP. The id must be one the game's metadata references (server-checked).
export function igdbShotUrl(id, imageId) {
  return `${API_BASE}/library/games/screenshot?id=${encodeURIComponent(id)}&shot=${encodeURIComponent(imageId)}`
}
// The IGDB match candidates the matcher shortlisted for a game (for "Wrong game?").
export function gameCandidatesUrl(id) {
  return `${API_BASE}/library/games/meta/candidates?id=${encodeURIComponent(id)}`
}
// The IGDB matcher's progress + whether creds are configured — the settings screen
// polls this. A BARE path (no API_BASE) because it's read through useApi, which
// prepends the base itself (unlike the plain-fetch helpers above/below).
export const GAME_META_STATUS_PATH = '/library/games/meta/status'
// Kick a one-off IGDB matching pass now (the settings "re-scan" button). Returns
// { started, reason?, status } — the pass runs server-side; poll the status path.
export function postMetaRescan() {
  return fetch(`${API_BASE}/library/games/meta/rescan`, { method: 'POST' })
}
// Manually fix a game's IGDB match: an igdbId re-matches to it, null clears to the
// basic page. Resolves when the server has stored it (caller then refetches meta).
export function postGameMatch(id, igdbId, isHack = false) {
  return fetch(`${API_BASE}/library/games/meta`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id, igdb_id: igdbId, is_hack: isHack }),
  })
}

// Per-game play-time totals, most-played first — the source for each game page's
// play-time line. Fetched directly (not via useApi)
// so the shelf can reload it a beat after mount: the session that just ended is
// reported by a sendBeacon during the player's teardown, which can land AFTER this
// first read, so a single delayed re-read catches it without a loading flash.
export function fetchPlayStats() {
  return fetch(`${API_BASE}/library/games/play-stats`).then((r) => (r.ok ? r.json() : null))
}

// Report a finished session's elapsed play-time so the backend can add it to the
// game's running total. Fire-and-forget and built to survive the very unload that
// usually triggers it (quitting a game): sendBeacon first, keepalive fetch as the
// fallback. Too-short/absurd values are sanitised server-side, so callers don't have to.
export function postPlayTime(id, core, ms) {
  const body = JSON.stringify({ id, core: core || null, ms: Math.round(ms) })
  const url = `${API_BASE}/library/games/play-time`
  if (navigator.sendBeacon) {
    const ok = navigator.sendBeacon(url, new Blob([body], { type: 'application/json' }))
    if (ok) return
  }
  fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
    keepalive: true,
  }).catch(() => {})
}

// A game's in-game battery save (SRAM) — the game's OWN save (e.g. Pokemon's
// "Save"), one per game, stored server-side so it roams. GET serves it, POST
// (multipart) overwrites it. The emulator captures + restores it.
export function gameSramUrl(id) {
  return `${API_BASE}/library/games/sram?id=${encodeURIComponent(id)}`
}

// The isolated player page (public/emulator.html) for a game item. Running
// EmulatorJS inside an iframe keeps its window globals + teardown out of the SPA.
export function playerSrc(item, data = EMULATORJS_DATA) {
  const q = new URLSearchParams({
    core: item.core,
    rom: fileUrl('games', item.id),
    data,
  })
  q.set('gid', item.id) // game id, so the emulator can upload save states for it
  if (item.name) q.set('name', item.name) // EJS_gameName — avoids an "undefined" title
  if (item.loadStateUrl) q.set('loadstate', item.loadStateUrl) // resume into a saved state
  return `/emulator.html?${q.toString()}`
}

// Natural string compare so chapter files order 1,2,…,10 (not 1,10,2) and are
// case-insensitive — used to sequence an audiobook's chapter files.
export function naturalCompare(a, b) {
  return (a || '').localeCompare(b || '', undefined, { numeric: true, sensitivity: 'base' })
}

// --- offline emulator (ROMs) -----------------------------------------------
// The shared EmulatorJS engine assets a game needs (cached once, not per-game).
// Captured live from a real game load. The host page (emulator.html) is matched
// by bare path in the SW since it's requested with per-game query params.
export const EMULATOR_ENGINE_URLS = [
  '/emulator.html',
  `${EMULATORJS_DATA}loader.js`,
  `${EMULATORJS_DATA}emulator.min.js`,
  `${EMULATORJS_DATA}emulator.min.css`,
  `${EMULATORJS_DATA}localization/en-US.json`,
  `${EMULATORJS_DATA}compression/extract7z.js`,
]

// EmulatorJS maps our system core name to the libretro core file it loads by
// DEFAULT (the first entry in its per-system core table, src/emulator.js) — so
// the offline cache fetches the same .data the online loader does. Note segaMS
// defaults to smsplus (not genesis_plus_gx, which Genesis/Game Gear use).
const LIBRETRO_CORE = {
  gb: 'gambatte',
  gbc: 'mgba',
  gba: 'mgba',
  nes: 'fceumm',
  snes: 'snes9x',
  segaMD: 'genesis_plus_gx',
  segaMS: 'smsplus',
  segaGG: 'genesis_plus_gx',
}

// The per-game offline URLs: the ROM + its core (both non-thread variants, since
// iOS may pick either) + the core's report. The shared engine is separate.
export function gameOfflineUrls(id, core) {
  const lib = LIBRETRO_CORE[core] || core
  return [
    fileUrl('games', id),
    `${EMULATORJS_DATA}cores/${lib}-wasm.data`,
    `${EMULATORJS_DATA}cores/${lib}-legacy-wasm.data`,
    `${EMULATORJS_DATA}cores/reports/${lib}.json`,
  ]
}

// --- Games: per-system drill-in ---------------------------------------------
// Frog Game Station browses one system at a time (Game Boy alone has hundreds of titles). These
// pure helpers shape the data behind that; the components just draw it.

// The letter buckets, in display order: A–Z then '#' (numeric/other titles) last.
// Frog Game Station's game-list letter rail (GameList.jsx) reads it.
export const ALPHABET = [...'ABCDEFGHIJKLMNOPQRSTUVWXYZ', '#']

// One system's games, alphabetised by title (natural compare so "Pokemon 2"
// orders before "Pokemon 10"). → items[]
export function systemGames(items, label) {
  return (items ?? [])
    .filter((it) => (it.label || 'Other') === label)
    .sort((a, b) => naturalCompare(a.name, b.name))
}

// The scrubber bucket for a title: its uppercase first A–Z letter, else '#'
// (numbers, symbols, non-latin, empty). Diacritics are stripped first (NFD
// decomposes 'É' → 'E' + combining mark) so an accented title buckets under its
// base letter — matching how systemGames natural-sorts it (sensitivity 'base').
// → 'A'..'Z' | '#'
export function letterOf(name) {
  const c = (name || '').trim().normalize('NFD').charAt(0).toUpperCase()
  return c >= 'A' && c <= 'Z' ? c : '#'
}
