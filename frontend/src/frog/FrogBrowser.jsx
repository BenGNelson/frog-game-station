import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { X, Search as SearchIcon, Plane, Settings as SettingsIcon, Shuffle } from 'lucide-react'
import { useApi, API_BASE } from '../lib/useApi.js'
import { isNative } from '../lib/playerBackend.js'
import { deviceClass, offeredHere, playableHere, systemOffered } from '../lib/systemCapabilities.js'
import { libraryStatus } from '../lib/libraryStatus.js'
import { useOnline } from '../lib/online.jsx'
import { useDownloadedEntries } from '../lib/useDownloaded.js'
import { useDownload } from '../lib/useDownload.js'
import {
  systemGames, gameOfflineUrls, saveStatesUrl, gameMetaUrl, gameCandidatesUrl, gameMetaSearchUrl,
  postGameMatch, GAME_META_STATUS_PATH, fetchPlayStats, postMetaRescan, fetchContinue, fetchFacets,
} from '../lib/library.js'
import { rematchOptions } from './rematch.js'
import { readSettings, writeSettings, TOUCH_OPACITY_LEVELS, nearestOpacityLevel } from '../lib/playerSettings.js'
import { isFavorite, toggleFavorite, mirrorFavorites, favoritesMigrated, markFavoritesMigrated } from '../lib/favorites.js'
import { setStateMeta } from '../lib/saveStates.js'
import {
  ensureEmulatorEngine, cacheGameSram, allEntries, getEstimate, shellBytes, gameSavesBytes,
  summarizeStorage, auditStorage, removeDownload, clearGameSaves, downloadKey,
} from '../lib/offlineStore.js'
import { offlineGamesToItems } from './offline.js'
import { getRecent, recordPlayed, mergeRecents } from '../lib/recentGames.js'
import {
  fetchCollections, postFinished, postTag, deleteTag, cleanTag, tagsForGame, mergeCollections, TAG_MAXLEN,
  FAVORITES_TAG, visibleTags,
} from '../lib/collections.js'
import { getFavorites } from '../lib/favorites.js'
import { getRecentSearches, recordSearch, removeRecentSearch } from '../lib/recentSearches.js'
import { moveInRails, reconcileShelfFocus } from '../lib/gridNav.js'
import { playForAction } from '../lib/sfx.js'
import { applyDeferredSwReload } from '../lib/swReload.js'
import { useGamepad } from '../lib/useGamepad.js'
import { mediaMatches } from '../lib/useMediaQuery.js'
import { SkeletonLine } from '../components/ui.jsx'
import ButtonLegend from '../player/ButtonLegend.jsx'
import {
  defaultFrogMode,
  nextFrogMode,
  usesNativeKeyboard,
  showsPadLegend,
  isTouchMode,
  hidesIdleCursor,
} from './input.js'
import { isMousePointer, pointerMoved } from '../lib/pointer.js'
import { useIdleCursor } from '../lib/useIdleCursor.js'
import { FROG, systemStyle, FONT_DISPLAY, focusRing } from './theme.js'
import Caustics from './Caustics.jsx'
import Screensaver from './Screensaver.jsx'
import { LilyPads, Firefly, Dragonfly } from './pond.jsx'
import { useDozing } from '../lib/dayNight.js'
import { buildShelf, hydrate, stepLetter, collectionGames, facetGames } from './shelf.js'
import { searchGames, suggestedSearches, matches, KEYS, gridMove } from './search.js'
import { ROWS as KB_ROWS, keyAt, moveKey, applyKey, appendChar, deleteChar } from '../lib/keyboard.js'
import Frog, { FrogMark, Reflected } from './Frog.jsx'
import Boot from './Boot.jsx'
import Shelf from './Shelf.jsx'
import InstallNudge from './InstallNudge.jsx'
import FinishToast from './FinishToast.jsx'
import Search from './Search.jsx'
import SettingsPanel from './Settings.jsx'
import StoragePanel from './Storage.jsx'
import StatsPanel from './Stats.jsx'
import { buildStats } from './stats.js'
import GameScreen from './GameScreen.jsx'
import GameList, { GameListHeader, CollectionListHeader, FacetListHeader } from './GameList.jsx'
import './frog.css'

// FROG GAME STATION — the games browser.
//
// One screen at a time, one thing in focus, everything reachable from a D-pad
// without ever touching the glass. It's a front-end for a couch and a controller —
// and, equally, for a thumb on a phone: the same screens adapt to touch rather than
// forking into a separate layout.
//
// It owns the navigation for the whole browser; the screens under it are drawn from
// props and hold no state of their own. That's what lets the controller, the arrow
// keys and a mouse all drive the same code with none of them a special case, and
// it's what will make lifting this folder into its own repo a copy rather than a
// rewrite.
// The actions that move the shelf. 'search' is handled before we ever get here (it
// opens a whole screen); everything else — the triggers, a stray button — is inert,
// and inert must mean inert, not "quietly re-render into an identical focus object".
const MOVES = new Set(['up', 'down', 'left', 'right', 'railPrev', 'railNext'])

// The save-state note length cap, by code point — kept in one place so the on-screen
// keyboard and the persist-on-close trim can't drift apart (the tag/label cap is
// TAG_MAXLEN, shared from collections.js for the same reason).
const NOTE_MAXLEN = 280
// Idle time on a browse screen before the pond takes over (the screensaver).
const SAVER_IDLE_MS = 3 * 60 * 1000

// Frog Game Station's place, held for the life of the tab rather than the life of the component.
//
// This has to live outside React. FrogBrowser UNMOUNTS every time you launch a game
// (the player is a different route), so with `useState` alone, quitting a game would
// replay the whole boot animation, ask you to PRESS A again, and dump you back on
// rail zero — having forgotten which system you were three hundred games into. The
// boot is once per app open; your place survives a session.
//
// `mode` rides along for the same reason: a couch session would otherwise come back from
// every game in whatever the pointer kind implies (desktop on a laptop) and show no
// legend until the next button press. It is a tab-lifetime singleton by design — tap the
// glass once on a hybrid device and touch mode persists across route changes within that
// tab, until a pad press or a real mouse move corrects it.
const place = { booted: false, screen: 'shelf', system: null, collection: null, facet: null, focus: { rail: 0, index: 0 }, row: 0, mode: null }

export default function FrogBrowser() {
  const navigate = useNavigate()
  // A service-worker takeover that happened mid-game deferred its reload — apply
  // it now, before this (post-game) mount renders with mismatched assets.
  useEffect(() => {
    applyDeferredSwReload()
  }, [])
  const { online } = useOnline()

  // Re-fetch the library once the server becomes reachable again, so Frog Game Station opened in
  // airplane mode fills in the full library on its own when the network returns —
  // WITHOUT polling, which would churn a steady online session's data every interval
  // (each poll a fresh array ref, yanking the game list's scroll back to focus). The
  // nonce, ignored by the API, re-runs the one-shot fetch on the offline→online edge
  // and only there.
  const [reloadNonce, setReloadNonce] = useState(0)
  const wasOnline = useRef(online)
  useEffect(() => {
    if (online && !wasOnline.current) setReloadNonce((n) => n + 1)
    wasOnline.current = online
  }, [online])
  const { data, loading, error: libraryError, retrying } = useApi(
    `/library/games${reloadNonce ? `?r=${reloadNonce}` : ''}`,
    0
  )
  // The manual lever, for when the backoff has given up. Same nonce the
  // offline→online edge uses, so there is one refetch path, not two.
  const retryLibrary = useCallback(() => setReloadNonce((n) => n + 1), [])
  const apiItems = data?.items ?? []
  // Which systems' BIOS files the server holds ({psx: true}) — decides whether a
  // launch passes the BIOS URL or lets the core's HLE stand in. Memoized so the
  // play() callback's identity only changes when the answer does.
  const biosMap = useMemo(() => data?.bios ?? {}, [data])

  // The fallback when the API gives us nothing: the games you've DOWNLOADED (the
  // on-device manifest, via the shared hook the rest of the Library uses). `null`
  // until the read resolves, so we can tell "still reading" from "nothing downloaded".
  const entries = useDownloadedEntries()
  const offlineItems = useMemo(() => (entries === null ? null : offlineGamesToItems(entries)), [entries])

  // The live library wins WHENEVER it has answered — the item source is NOT gated on
  // the health probe, so a flaky /health check can never hide a reachable library
  // behind the downloaded-only view. Only when the API has handed us nothing do we
  // fall back to the downloaded games. Memoized (keyed on the fetch payload + the
  // downloaded set, both stable between polls) so `items` keeps a stable reference —
  // otherwise a fresh array every render churns every `items`-keyed memo below and
  // yanks the game list's scroll/focus.
  const allItems = useMemo(() => {
    const api = data?.items ?? []
    return api.length ? api : offlineItems ?? []
  }, [data, offlineItems])
  // What this device is OFFERED — the one filter behind every browse surface
  // (rails, lists, search, similar, shuffle all derive from `items`). On touch
  // the disc-era systems drop out entirely (lib/systemCapabilities.js); the full
  // library stays in `allItems` for the surfaces that describe the COLLECTION
  // rather than offer a game (the favorites mirror, the pond stats).
  const deviceCaps = useMemo(() => deviceClass(), [])
  const items = useMemo(
    () => (deviceCaps === 'touch' ? allItems.filter((g) => offeredHere(g.core, deviceCaps)) : allItems),
    [allItems, deviceCaps]
  )
  // Skeleton only while we truly have nothing to show and a source might still
  // land; an honest error only once every source has answered and failed. Keyed
  // on `items` (not the API alone) so a reconnect refetch keeps the offline shelf
  // up rather than flashing a skeleton over it. The rule itself lives in
  // lib/libraryStatus.js, where it can be read and tested on its own.
  const status = libraryStatus({
    itemCount: items.length,
    loading,
    retrying,
    offlineResolved: offlineItems !== null,
    error: libraryError,
  })
  const booting = status === 'booting'
  const libraryUnreachable = status === 'unreachable'
  // The chip means "you're seeing downloaded games only because the server is
  // unreachable" — precisely when the probe says offline AND the API gave us nothing.
  const offline = !online && !apiItems.length

  // 'boot' → 'shelf' ⇄ 'games'; 'search'/'detail'/'settings' are transient overlays.
  // A remembered place can point at a system this device doesn't offer (the gate is
  // per-device — lib/systemCapabilities.js); restoring it would strand the games
  // screen on an empty list with no rail tile to escape through, so it falls back
  // to the shelf instead.
  const placeSystemGated = place.system && !systemOffered(place.system, deviceCaps)
  const [screen, setScreen] = useState(
    place.booted ? (place.screen === 'games' && placeSystemGated ? 'shelf' : place.screen) : 'boot'
  )
  const [system, setSystem] = useState(placeSystemGated ? null : place.system)
  // The 'games' screen shows one system's games OR one collection's — never both. Which
  // it is comes down to whether a collection tag is set (openSystem / openCollection each
  // clear the other), so the screen, the header, and the list styling all fork on this.
  const [collectionTag, setCollectionTag] = useState(place.collection)
  // …OR one facet's (a tapped genre/franchise chip) — the third, equally exclusive
  // dress of the same 'games' screen.
  const [facetView, setFacetView] = useState(place.facet)

  const [focus, setFocus] = useState(place.focus)
  const [memory, setMemory] = useState({})
  const [row, setRow] = useState(place.row) // focus within a system's game list

  // Until the user drives the cursor themselves, focus should follow the TOP rail so the
  // async history rails (Jump back in first, then Favorites) land UNDER it — instead of the
  // `systems` placeholder that renders before the library resolves locking the cursor onto
  // Game Boy. A restored non-default position (returning from a game) counts as already
  // driven, so it's preserved as-is; any real move/hover flips this on (see below).
  const focusDriven = useRef(place.focus.rail !== 0 || place.focus.index !== 0)

  // Search is transient — a fresh keyboard every time you open it, never restored.
  // `query` is the string you're building; `zone` is which half of the screen has the
  // cursor (the keyboard grid or the results); `from` is where to land when you close.
  const [query, setQuery] = useState('')
  const [zone, setZone] = useState('grid')
  const [keyIndex, setKeyIndex] = useState(0)
  const [resultRow, setResultRow] = useState(0)
  const [searchFrom, setSearchFrom] = useState('shelf')
  // Your recent searches — shown in the results zone while the query is empty, so a
  // query you already found your way through is one press away. Refreshed from storage
  // each time search opens.
  const [recentSearches, setRecentSearches] = useState(() => getRecentSearches())

  // Settings is a transient overlay (like search/detail): which screen it was opened
  // over, which of its two rows has the cursor, the player input-mode preference it
  // surfaces, and whether a re-scan was just kicked (before the status poll shows it).
  const [settingsFrom, setSettingsFrom] = useState('shelf')
  const [settingsFocus, setSettingsFocus] = useState('igdb')
  const [inputMode, setInputModeState] = useState(() => readSettings(localStorage).inputMode)
  const [navSfx, setNavSfxState] = useState(() => readSettings(localStorage).navSfx)
  const [touchOpacity, setTouchOpacityState] = useState(() => readSettings(localStorage).touchOpacity)
  const [rescanBusy, setRescanBusy] = useState(false)
  // Downloads & Storage — an overlay one level deeper (opened from Settings; B / ✕
  // return there). `storageData` is the summarizeStorage view, re-gathered on open and
  // after every removal; `storageAudit` is null | 'busy' | the auditStorage verdict.
  const [storageFocus, setStorageFocus] = useState('verify')
  // Pond stats — same one-level-under-Settings overlay shape as storage.
  const [statsFocus, setStatsFocus] = useState('pond')
  const [storageData, setStorageData] = useState(null)
  const [storageAudit, setStorageAudit] = useState(null)
  const [storageRefresh, setStorageRefresh] = useState(0)
  // The IGDB matcher status — polled only while the settings screen is up (one cheap
  // fetch otherwise); useApi pauses when the tab is hidden.
  const igdbStatus = useApi(GAME_META_STATUS_PATH, screen === 'settings' ? 4000 : 0)

  // Touch, pad or desktop. Opens from the pointer kind and what this tab was last in,
  // then every real input keeps it honest — a gamepad button flips to pad, a finger to
  // touch, a mouse to desktop. Each thing the mode decides is asked BY NAME below; a
  // single `native` boolean used to stand in for all of them, which is how the legend
  // ended up naming controller buttons to people holding a mouse.
  const [mode, setMode] = useState(() => defaultFrogMode(mediaMatches('(pointer: coarse)'), place.mode))
  place.mode = mode
  const native = usesNativeKeyboard(mode)
  const padLegend = showsPadLegend(mode)

  // Fade the mouse out on the browse screens too, not just over a game. The shelf is
  // where a couch session actually spends its time, and a cursor parked on a tile is as
  // distracting there as it is in play. Only while a pad is driving — in desktop mode the
  // cursor is the instrument, and in touch mode there is none to hide.
  useIdleCursor({ enabled: hidesIdleCursor(mode) })

  // Which keyboard the OPEN search screen uses, snapshotted when it opens rather than
  // read live. If it tracked `mode`, tapping a 6×6 grid key with a finger (which flips
  // mode to touch on pointerdown) would unmount the grid before the tap's click landed
  // — the key would be lost. Frozen per session, the grid stays put; the tap types.
  const [searchNative, setSearchNative] = useState(false)

  // The game page ('detail' screen). `detailGame` is the game being viewed, `detailFrom`
  // the screen to return to. Its focus is two zones — the actions row and the save list
  // — mirroring search's grid⇄results. `confirm` guards a destructive action (delete a
  // save / remove a download) behind one deliberate step.
  const [detailGame, setDetailGame] = useState(null)
  const [detailFrom, setDetailFrom] = useState('shelf')
  const [detailFocus, setDetailFocus] = useState({ zone: 'actions', index: 0 })
  const [confirm, setConfirm] = useState(null)
  const [saves, setSaves] = useState([])
  const [savesLoading, setSavesLoading] = useState(false)
  const [savesRefresh, setSavesRefresh] = useState(0)
  // The open game's rich IGDB metadata (screenshots/summary/genres/rating). `null`
  // until it lands / when the game isn't matched or IGDB isn't configured — in which
  // case GameScreen renders its basic layout (a ROM hack looks exactly like today).
  const [meta, setMeta] = useState(null)
  // A screenshot opened fullscreen: its index into meta.screenshot_ids, or null.
  const [lightbox, setLightbox] = useState(null)
  // The trailer overlay: an index into the game's IGDB videos, or null when closed.
  const [trailer, setTrailer] = useState(null)
  // The game hero's active background screenshot — it slowly crossfades on its own
  // (and the D-pad can peek). Owned here so the auto-advance pauses while the lightbox
  // is open and resets when you open a different game.
  const [heroSlide, setHeroSlide] = useState(0)
  // The "Wrong game?" picker: null, or { candidates, current, matched, index }. Bumping
  // metaRefresh re-fetches the open game's meta after a manual re-match/clear.
  const [rematch, setRematch] = useState(null)
  const [tagPicker, setTagPicker] = useState(null) // { index } while the picker is open (index -1 = the "new" row)
  const [saveEditor, setSaveEditor] = useState(null) // { slot, index, label, note, pinned }
  // The on-screen keyboard, opened OVER the tag picker / save editor when a controller
  // needs to write free text (a new collection, a save's name/note). `target` says which
  // field the committed text lands in; `text`/`shift`/`pos` are the board's own state.
  const [keyboard, setKeyboard] = useState(null) // { target, text, shift, pos, max } | null
  const [metaRefresh, setMetaRefresh] = useState(0)

  // Per-game play-time totals (the game-page play-time line). FrogBrowser
  // remounts on every game launch, so a session that just ended is picked up on return.
  // But that session is reported by a sendBeacon during the player's teardown, which can
  // land just after this first read — so re-read once shortly after mount to catch it,
  // updating state only on success (no loading flash, and offline just leaves it empty).
  const [playStatItems, setPlayStatItems] = useState([])
  useEffect(() => {
    let alive = true
    const load = () =>
      fetchPlayStats()
        .then((d) => alive && d && setPlayStatItems(d.items ?? []))
        .catch(() => {})
    load()
    const t = setTimeout(load, 1500)
    return () => {
      alive = false
      clearTimeout(t)
    }
  }, [])
  const playStatsById = useMemo(
    () => new Map(playStatItems.map((s) => [s.id, s])),
    [playStatItems]
  )

  // Collections: the finished flag + free-form tags, server-owned so they roam. Fetched
  // once on mount; edits (on the game page) update this optimistically so the shelf's
  // Finished / per-tag rails reflect a change the instant you make it, without a round-trip.
  const [collections, setCollections] = useState({ finished: [], tags: {}, hacks: {} })
  // Bumped when a game is newly marked FINISHED, to fire the one-shot celebration toast.
  const [finishTick, setFinishTick] = useState(0)
  // Finished-membership mirrored in a ref so the celebrate trigger decides from live truth,
  // not a stale render closure — synced from collections after each commit, and updated
  // synchronously on toggle so two taps in one frame can't double-fire or miss.
  const finishedRef = useRef(collections.finished)
  useEffect(() => {
    finishedRef.current = collections.finished
  }, [collections.finished])
  // Whether the mount GET has SUCCEEDED. FrogBrowser REMOUNTS on every game launch, so a
  // collection list re-entered right after quitting a game would, for one render, see the
  // empty starting `collections` and wrongly read as "this collection is empty". This
  // tells the list "still loading" so it holds that message until real data lands — and,
  // crucially, only a SUCCESSFUL load flips it (a failed/offline fetch leaves it false, so
  // an intact collection is never falsely reported emptied; it stays a loading state).
  const [collectionsLoaded, setCollectionsLoaded] = useState(false)
  // Games the user has optimistically edited since the mount GET was issued. The GET's
  // response predates those writes, so it's MERGED (not applied wholesale): the server
  // fills in every untouched game, but a touched game keeps its local membership — so a
  // slow GET can't clobber an edit, nor can skipping it lose the rest of the collections.
  // Per-dimension (see mergeCollections): touching a game in one dimension must not make
  // a slow mount GET drop its memberships in the others.
  const collectionsDirty = useRef({ finished: new Set(), tags: new Set(), hacks: new Set() })
  useEffect(() => {
    let alive = true
    fetchCollections()
      .then((d) => {
        // Only real data counts as "loaded" — a non-ok GET resolves to null (see
        // fetchCollections), and treating that as loaded is exactly what would surface an
        // intact collection as "emptied" on a post-launch remount while the backend blips.
        if (alive && d) {
          setCollections((local) => mergeCollections(d, local, collectionsDirty.current))
          setCollectionsLoaded(true)
        }
      })
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [])
  const finishedSet = useMemo(() => new Set(collections.finished), [collections.finished])

  // The IGDB browse facets (genre/franchise → ids) behind the game page's tappable
  // chips. One-shot like collections; a failure just means chips lead to short lists.
  const [facets, setFacets] = useState({ genres: {}, franchises: {} })
  useEffect(() => {
    let alive = true
    fetchFacets().then((d) => alive && d && setFacets(d))
    return () => {
      alive = false
    }
  }, [reloadNonce])

  // The server's "recently played" (games with saves) — one of Jump back in's three
  // sources. Re-fetched on the offline→online edge with the library (same nonce);
  // failure just leaves [] and the rail falls back to this device's own recents.
  const [serverContinue, setServerContinue] = useState([])
  useEffect(() => {
    let alive = true
    fetchContinue().then((d) => alive && d && setServerContinue(d.items ?? []))
    return () => {
      alive = false
    }
  }, [reloadNonce])

  // Favorites roam as the reserved collections tag. While the server list is loaded
  // it is the truth; until then (or offline) the localStorage mirror stands in.
  const favIds = collections.tags[FAVORITES_TAG] ?? []
  const favMarkers = useMemo(
    () => (collectionsLoaded ? favIds.map((id) => ({ id })) : getFavorites()),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [collectionsLoaded, collections.tags]
  )
  // Keep the offline mirror in step with the server — and, ONCE per device, push any
  // pre-roaming local stars up first (the union migration). Pushing only once matters:
  // doing it every load would let this device's stale mirror resurrect stars that were
  // unstarred on another device.
  useEffect(() => {
    if (!collectionsLoaded) return
    if (!favoritesMigrated()) {
      markFavoritesMigrated()
      const localOnly = getFavorites().filter((g) => !favIds.includes(g.id))
      if (localOnly.length) {
        for (const g of localOnly) postTag(g.id, FAVORITES_TAG)
        setCollections((c) => ({
          ...c,
          tags: { ...c.tags, [FAVORITES_TAG]: [...localOnly.map((g) => g.id), ...(c.tags[FAVORITES_TAG] ?? [])] },
        }))
        return // mirror on the next pass, once the pushed stars are in state
      }
    }
    // A failed library fetch would hydrate every favorite away — don't wipe the
    // mirror over that; an actually-empty server list still clears it. Mirrors
    // the UNFILTERED library on purpose: a phone must not prune the disc-era
    // stars it merely doesn't offer out of its own offline favorites mirror.
    if (!allItems.length && favIds.length) return
    mirrorFavorites(hydrate(allItems, favIds.map((id) => ({ id }))))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [collectionsLoaded, collections.tags, allItems])
  // The ROM-hack map (game_id → base game's name), for the "HACK" badges across the
  // browsing surfaces. Server-owned like the rest of collections, so a game marked a hack
  // on the couch reads as one on the phone.
  const hacks = collections.hacks || {}
  const hackSet = useMemo(() => new Set(Object.keys(hacks)), [hacks])

  // Jump back in, cross-device: this device's launches merged with the server's
  // continue list and play-stamps — newest wins, so a session on the couch surfaces
  // here on the phone (and offline the local list carries the rail alone).
  const recents = useMemo(
    () => mergeRecents(getRecent(), serverContinue, playStatItems),
    [serverContinue, playStatItems]
  )
  const rails = useMemo(
    () => buildShelf(items, recents, favMarkers, collections),
    [items, recents, favMarkers, collections]
  )
  // Pond stats, derived only while the screen is up — every source is already here.
  // Over the UNFILTERED library: the pond describes the collection, and the totals
  // should read the same on every device (and match the server's matched-count in
  // Settings) even where the disc era isn't offered.
  const stats = useMemo(
    () => (screen === 'stats' ? buildStats(allItems, playStatItems, collections, facets) : null),
    [screen, allItems, playStatItems, collections, facets]
  )
  // The 'games' screen's list: a collection's members (naturally sorted, spanning
  // systems) when a tag is open, otherwise the focused system's games.
  const games = useMemo(
    () =>
      facetView
        ? facetGames(items, facets, facetView)
        : collectionTag
          ? collectionGames(items, collections.tags, collectionTag)
          : system
            ? systemGames(items, system)
            : [],
    [items, system, collectionTag, facetView, facets, collections.tags]
  )
  // Searched across EVERY system, not just the open one — from the shelf you haven't
  // picked a console yet, and "which box is Zelda in" is exactly what search is for.
  const results = useMemo(() => searchGames(items, query), [items, query])
  // First-run starter searches, shown when there's no query AND no recent history.
  const suggestions = useMemo(() => suggestedSearches(items), [items])

  // The game page's offline download — same state machine (and single-writer rule) as
  // the rest of the Library, via the shared hook. Keyed on the open game; harmless when
  // none is open (empty id → idle).
  const dlItem = detailGame
    ? {
        section: 'games',
        id: detailGame.id,
        name: detailGame.name,
        core: detailGame.core,
        urls: gameOfflineUrls(detailGame.id, detailGame.core),
      }
    : { section: 'games', id: '', urls: [] }
  const dl = useDownload(dlItem, async () => {
    await ensureEmulatorEngine()
    if (detailGame) await cacheGameSram(detailGame.id) // seed the in-game save for offline resume
  })

  // The open game's save states, fetched straight (not via useApi) so it only fires when
  // a game is actually open, and re-fetches after a delete.
  const savesGameRef = useRef(null)
  useEffect(() => {
    if (!detailGame) {
      setSaves([])
      savesGameRef.current = null
      return
    }
    // Clear ONLY on a real game switch — never on a post-delete refetch (the optimistic
    // update already narrowed the list) — so one game's snapshots never flash under
    // another game's cover.
    if (savesGameRef.current !== detailGame.id) setSaves([])
    savesGameRef.current = detailGame.id
    let alive = true
    setSavesLoading(true)
    fetch(saveStatesUrl(detailGame.id))
      .then((r) => (r.ok ? r.json() : { states: [] }))
      .then((d) => alive && (setSaves(d.states ?? []), setSavesLoading(false)))
      .catch(() => alive && (setSaves([]), setSavesLoading(false)))
    return () => {
      alive = false
    }
  }, [detailGame, savesRefresh])

  // The open game's IGDB metadata, fetched when a game page opens (guarded like the
  // saves fetch so one game's data never flashes under another's cover). A failure
  // (offline, or the endpoint 404s) just leaves `meta` null → the basic page.
  const metaGameRef = useRef(null)
  useEffect(() => {
    if (!detailGame) {
      setMeta(null)
      metaGameRef.current = null
      return
    }
    if (metaGameRef.current !== detailGame.id) setMeta(null)
    metaGameRef.current = detailGame.id
    let alive = true
    fetch(gameMetaUrl(detailGame.id))
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => alive && setMeta(d))
      .catch(() => alive && setMeta(null))
    return () => {
      alive = false
    }
  }, [detailGame, metaRefresh])

  // The screenshots the game screen shows (only when IGDB matched this game). Drives
  // both the strip's focus range and the fullscreen lightbox.
  const shots = meta?.matched ? meta.screenshot_ids ?? [] : []
  // The game's IGDB trailers — gated on the live-network probe, because the button
  // opens a YouTube embed and an offline "Trailer" that spins forever is worse than
  // no button. Empty ⇒ the action and its focus slot simply don't exist.
  const trailerVideos = online && meta?.matched ? meta.videos ?? [] : []
  // The actions row's last index: Play / Favorite / Download / Finished, + Trailer.
  // Desktop builds hide Download (no service worker means a download could never be
  // served back — see lib/playerBackend.js), so every later index shifts down one;
  // GameScreen computes the same shift from the same build flag.
  const dlShift = isNative() ? 1 : 0
  const actionsMax = (trailerVideos.length ? 4 : 3) - dlShift
  // "More like this": IGDB's similar-game ids for the open game, re-hydrated against
  // the live library (same pattern as the shelf's recents/favorites) so a tile is
  // always a real, playable game with the library's own name — and games that have
  // since left simply drop out. Empty until a matched game carries a similar list.
  const similar = useMemo(() => {
    const ids = meta?.matched ? meta.similar ?? [] : []
    // The ids are bare game_ids; wrap them as markers for the shared re-hydrator.
    return ids.length ? hydrate(items, ids.map((id) => ({ id }))) : []
  }, [meta, items])
  // The vertical focus order on the game page — actions, then the screenshot strip
  // (only if there are shots), then the save list (only if there are saves), then the
  // "more like this" rail. up/down cross between whichever zones are present; left/right
  // move within actions/screens/similar.
  // Whether a "Wrong game?" / "Find on IGDB" fix control is offered (there's a
  // candidate shortlist to fix the match against).
  const canRematch = !!meta?.can_rematch
  // The tappable browse chips on the game page: the series first, then each genre.
  // Only for matched games — an unmatched ROM has nothing to browse by.
  const detailFacets = useMemo(() => {
    if (!meta?.matched) return []
    const f = []
    if (meta.franchise) f.push({ kind: 'franchise', value: meta.franchise })
    for (const g of meta.genres ?? []) f.push({ kind: 'genre', value: g })
    return f
  }, [meta])
  // The open game's collection state, derived from the shared `collections`.
  const detailFinished = detailGame ? finishedSet.has(detailGame.id) : false
  // Favorited, derived the same way (the reserved tag), so the star reflects a change
  // made on another device the moment collections load; offline it reads the mirror.
  const detailFavorited = detailGame
    ? collectionsLoaded
      ? favIds.includes(detailGame.id)
      : isFavorite(detailGame.id)
    : false
  const detailTags = useMemo(
    () => (detailGame ? tagsForGame(collections.tags, detailGame.id) : []),
    [collections.tags, detailGame]
  )
  const allTags = useMemo(
    () => visibleTags(collections.tags), // the reserved favorites tag never reaches the picker
    [collections.tags]
  )
  // A hack whose base ROM you own gets a one-press "Based on <base>" hop (its own zone).
  // Validated against the LIVE library: the server resolves base_game_id off igdb_meta,
  // which can outlive the ROM on disk — so a base that has left the library becomes plain
  // text, never a focusable link that goes nowhere.
  const detailBaseId =
    meta?.is_hack && meta?.base_game_id && items.some((x) => x.id === meta.base_game_id)
      ? meta.base_game_id
      : null
  const detailZones = useMemo(() => {
    const z = []
    if (shots.length) z.push('hero') // the banner sits above the actions
    z.push('actions')
    if (detailBaseId) z.push('base') // "Based on <base>", just under the actions
    if (detailFacets.length) z.push('facets') // the browse chips, under the About block
    if (canRematch) z.push('fix') // the "Wrong game?" control, below the facts
    z.push('tags') // "Collections" — always available (you can always tag a game)
    if (saves.length) z.push('saves')
    if (similar.length) z.push('similar') // the rail at the foot of the page
    return z
  }, [shots.length, detailBaseId, detailFacets.length, canRematch, saves.length, similar.length])

  // Slowly crossfade the hero's background through the screenshots. Paused while the
  // lightbox is open (you're looking at one) and under reduced-motion (leave it still).
  // Local UI churn only — it never refetches, so it can't disturb scroll/data.
  useEffect(() => {
    if (screen !== 'detail' || lightbox !== null || trailer !== null || shots.length < 2) return
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches) return
    const t = setInterval(() => setHeroSlide((i) => (i + 1) % shots.length), 5000)
    return () => clearInterval(t)
  }, [screen, lightbox, trailer, shots.length])

  useEffect(() => {
    if (screen === 'boot') return
    // Never persist 'search' as the screen: it's a transient overlay with no saved
    // query, so restoring it after a game launch would drop you on an empty keyboard.
    // Persist the screen it was opened over instead.
    // 'search' and 'detail' are transient overlays with no saved contents — persist the
    // screen they were opened over, so a game launch restores you there, not to an empty
    // keyboard or a stale game page. A game page opened FROM search resolves one more hop
    // (detailFrom==='search' → the screen search itself was opened over), or quitting the
    // game would strand you on a blank keyboard.
    const persistScreen =
      screen === 'search'
        ? searchFrom
        : screen === 'settings' || screen === 'storage' || screen === 'stats' // all open from settings, so they resolve the same hop
          ? settingsFrom
          : screen === 'detail'
            ? detailFrom === 'search'
              ? searchFrom
              : detailFrom
            : screen
    Object.assign(place, { booted: true, screen: persistScreen, system, collection: collectionTag, facet: facetView, focus, row })
  })

  // Typing narrows the list under the cursor: keep the result focus in range, and if
  // the list empties out from under the results zone, hand the cursor back to the keys.
  // Inert while the query is EMPTY: the results zone then holds recents / suggestions (not
  // `results`, which is always [] then), whose cursor the nav handlers manage — so a
  // background library poll (a fresh `results` identity) can't yank a controller off them.
  useEffect(() => {
    if (!query) return
    setResultRow((i) => Math.min(i, Math.max(0, results.length - 1)))
    if (!results.length) setZone((z) => (z === 'results' ? 'grid' : z))
  }, [results, query])

  // Reconcile focus with whatever the rails just became.
  //
  // The rails CHANGE SHAPE after the shelf is already interactive — not just once when
  // the library resolves (Jump back in / Favorites appearing) but again as the async
  // per-tag collection rails land. Keeping focus.rail as a bare index
  // would let a rail inserted AHEAD of you slide the highlight onto a different game. So
  // we keep focus on the SAME rail by identity: find where its id moved to, and only
  // fall back to index-clamping when that rail is gone (or on the first resolve).
  const prevRails = useRef(rails)
  useEffect(() => {
    const prev = prevRails.current
    prevRails.current = rails
    setFocus((f) => reconcileShelfFocus(prev, rails, f, focusDriven.current))
  }, [rails])

  // Same for the game list: a system with 25 games can't hold a cursor at row 300.
  useEffect(() => {
    setRow((i) => Math.min(i, Math.max(0, games.length - 1)))
  }, [games])

  const play = useCallback(
    (game, slot) => {
      if (!game) return
      // A desktop browser lists the disc era but can't run it (that's what the
      // native player is for) — the game page says so; this is the backstop for
      // every other way in (pad, keyboard, a rail card).
      if (!playableHere(game.core, deviceCaps)) return
      recordPlayed(game)
      // `size` rides along for the player's huge-ROM blob bypass; the BIOS URL is
      // passed only when the server actually holds this system's file (else the
      // core's built-in HLE BIOS stands in).
      const bios =
        game.core === 'psx' && biosMap.psx
          ? `&bios=${encodeURIComponent(`${API_BASE}/library/bios?system=psx`)}`
          : ''
      const q = `id=${encodeURIComponent(game.id)}&core=${encodeURIComponent(game.core)}&name=${encodeURIComponent(
        game.name || ''
      )}&label=${encodeURIComponent(game.label || '')}${game.cover_v ? `&coverv=${game.cover_v}` : ''}${
        game.size ? `&size=${game.size}` : ''
      }${bios}`
      // A `slot` launches into that snapshot; without one it's a plain boot on the
      // game's own in-game (battery) save. Play with no slot is deliberately the default
      // — restoring an older snapshot would roll the battery save back to whenever it
      // was taken, the exact way you lose an afternoon.
      navigate(`/play?${q}${slot ? `&slot=${encodeURIComponent(slot)}` : ''}`)
    },
    [navigate, biosMap]
  )

  const openSystem = useCallback((label) => {
    setSystem(label)
    setCollectionTag(null) // the three list dresses are mutually exclusive views
    setFacetView(null)
    setRow(0)
    setScreen('games')
  }, [])

  // Open a collection as the full letter-railed list (the 'games' screen, in collection
  // dress). Clears the system for the same reason openSystem clears the collection.
  const openCollection = useCallback((tag) => {
    setCollectionTag(tag)
    setSystem(null)
    setFacetView(null)
    setRow(0)
    setScreen('games')
  }, [])

  // Open a facet ({kind: 'genre'|'franchise', value}) as the full list — the game
  // page's chips land here. Same dress as a collection (games span machines).
  const openFacet = useCallback((view) => {
    setFacetView(view)
    setSystem(null)
    setCollectionTag(null)
    setRow(0)
    setScreen('games')
  }, [])

  const openSearch = useCallback(() => {
    // openSearch only ever fires from a non-search screen (the toggle calls closeSearch
    // otherwise), so the screen we're leaving IS where to return to.
    setSearchFrom(screen)
    setQuery('')
    setKeyIndex(0)
    setResultRow(0)
    setZone('grid')
    setRecentSearches(getRecentSearches()) // pick up searches recorded since last open
    // Freeze the keyboard kind for this search session (see `searchNative`).
    setSearchNative(usesNativeKeyboard(mode))
    setScreen('search')
  }, [screen, mode])

  const closeSearch = useCallback(() => setScreen(searchFrom), [searchFrom])

  // Open a game from the results — remember the query that found it first (a search
  // that actually led somewhere is the one worth keeping; empties are ignored).
  const openFromSearch = (game) => {
    setRecentSearches(recordSearch(query))
    openDetail(game, 'search')
  }
  // Tapping/selecting a recent search re-runs it: drop it into the query and let the
  // normal typing flow take over (results fill; Down/RB steps into them).
  const applyRecentQuery = (q) => {
    setQuery(q)
    setZone('grid')
    setResultRow(0)
    setKeyIndex(0)
  }
  const removeRecent = (q) => setRecentSearches(removeRecentSearch(q))

  // Settings, opened over whatever screen you were on (so B / ✕ returns there).
  const openSettings = useCallback(() => {
    setSettingsFrom(screen)
    setSettingsFocus('igdb')
    setScreen('settings')
  }, [screen])
  const closeSettings = useCallback(() => setScreen(settingsFrom), [settingsFrom])

  // Downloads & Storage, one level under Settings. Opening re-measures from scratch —
  // stale figures on a screen about "what's on this device" would defeat its point.
  const openStorage = useCallback(() => {
    setStorageData(null)
    setStorageAudit(null)
    setStorageFocus('verify')
    setStorageRefresh((n) => n + 1)
    setScreen('storage')
  }, [])
  const closeStorage = useCallback(() => {
    setConfirm(null)
    setScreen('settings')
  }, [])
  const openStats = useCallback(() => {
    setStatsFocus('pond')
    setScreen('stats')
  }, [])
  const closeStats = useCallback(() => setScreen('settings'), [])
  const storageVerify = async () => {
    setStorageAudit('busy')
    try {
      setStorageAudit(await auditStorage())
    } catch {
      setStorageAudit(null)
    }
  }
  // The guarded removals land here from the confirm gate. Removing the OPEN game's
  // download routes through the dl hook so the game page's button resets with it;
  // "remove all" clears every download, the shared engine, and the captured saves.
  const storageConfirmYes = async () => {
    const c = confirm
    setConfirm(null)
    if (!c) return
    try {
      if (c.kind === 'storageAll') {
        for (const e of storageData?.items ?? []) await removeDownload(e.key)
        await removeDownload(downloadKey('emulator', 'engine'))
        await clearGameSaves()
        if (detailGame) await dl.remove() // harmless if it wasn't downloaded; resets the button
      } else if (c.kind === 'storageRemove') {
        if (detailGame && c.key === downloadKey('games', detailGame.id)) await dl.remove()
        else await removeDownload(c.key)
      }
    } finally {
      setStorageAudit(null) // the verdict described a cache that just changed
      setStorageRefresh((n) => n + 1)
    }
  }

  // Gather the summary while the screen is up (and again after each removal). A failure
  // (no Cache API in an odd embed) still resolves to an all-zero summary, never a spinner.
  useEffect(() => {
    if (screen !== 'storage') return
    let alive = true
    Promise.all([allEntries(), getEstimate(), shellBytes(), gameSavesBytes()])
      .then(([entries, estimate, shell, saves]) => alive && setStorageData(summarizeStorage(entries, estimate, shell, saves)))
      .catch(() => alive && setStorageData(summarizeStorage([], {}, 0, 0)))
    return () => {
      alive = false
    }
  }, [screen, storageRefresh])

  // The storage screen's vertical focus order: each downloaded game, then the actions.
  const storageRows = useMemo(
    () => [...(storageData?.items ?? []).map((e) => e.key), 'verify', 'removeAll'],
    [storageData]
  )
  // A removal can delete the row under the cursor — park it back on Verify.
  useEffect(() => {
    if (screen === 'storage' && !storageRows.includes(storageFocus)) setStorageFocus('verify')
  }, [screen, storageRows, storageFocus])
  // Persist the player input-mode preference and reflect it in the toggle at once.
  const setInputMode = (m) => {
    writeSettings(localStorage, { inputMode: m })
    setInputModeState(m)
  }
  const setNavSfx = (v) => {
    writeSettings(localStorage, { navSfx: v })
    setNavSfxState(v)
    if (v) playForAction('confirm', true) // a blip on enable, so it's audible immediately
  }
  // Persist to the SAME `frog.player` blob the player reads, so a change here takes effect
  // the next time a game is launched (the player mounts fresh and re-reads it).
  const setTouchOpacity = (v) => {
    writeSettings(localStorage, { touchOpacity: v })
    setTouchOpacityState(v)
  }
  // Kick a one-off matching pass. Guarded so a double-press or a press while a pass is
  // already running is a no-op; the status poll then shows the progress.
  const doRescan = async () => {
    const s = igdbStatus.data
    if (rescanBusy || !s?.configured || s?.running) return
    setRescanBusy(true)
    try {
      await postMetaRescan()
    } catch {
      /* transient — the button re-enables and the poll reflects reality */
    }
    setRescanBusy(false)
  }

  // The game page. Opens over whatever screen you were on (so B returns there), lands
  // focus on Play, and reads the game's current favourite state.
  const openDetail = (game, from) => {
    if (!game) return
    setDetailGame(game)
    setDetailFrom(from)
    setDetailFocus({ zone: 'actions', index: 0 })
    setConfirm(null)
    setLightbox(null)
    setTrailer(null)
    setRematch(null)
    setTagPicker(null)
    setSaveEditor(null)
    setKeyboard(null)
    setHeroSlide(0)
    // Clear the previous game's metadata SYNCHRONOUSLY here, not only in the fetch
    // effect (which runs after paint): otherwise the new game's page renders for one
    // frame with the last game's hero/summary/genres before its own meta lands.
    setMeta(null)
    metaGameRef.current = null
    setScreen('detail')
  }
  const closeDetail = () => {
    setConfirm(null)
    setLightbox(null)
    setTrailer(null)
    setRematch(null)
    setTagPicker(null)
    setSaveEditor(null)
    setKeyboard(null)
    setScreen(detailFrom)
  }
  // "Surprise me": jump to a random title's page. Opens the game page (not straight into
  // play) so a roll you didn't want costs one B, not a launch. The `from` is where B
  // lands: a RE-ROLL while a game page is already open must keep that page's OWN origin —
  // passing 'detail' here would make B a no-op (closeDetail → the screen you're on) and
  // get persisted as a bogus restore screen. Only fires from the browsing screens (see
  // the dispatcher), so `screen` is 'shelf' | 'games' | 'detail' by the time we're here.
  const openRandom = () => {
    if (!items.length) return
    const g = items[Math.floor(Math.random() * items.length)]
    openDetail(g, screen === 'detail' ? detailFrom : screen)
  }

  // The one place the shelf decides what picking an item DOES, so a controller A and a
  // mouse click can't drift apart: a system tile opens its system, a "see all" tile opens
  // the collection list, a Jump-back-in card resumes straight into play (no page between),
  // and anything else opens the game page. (Y / 'alt' is deliberately NOT this — it always
  // opens the page, even for a Jump card — so it stays a separate branch.)
  const pickShelfItem = (rail, item) => {
    if (!item) return
    if (item.action === 'random') return openRandom()
    if (rail.kind === 'system') {
      if (item.count > 0) openSystem(item.label)
    } else if (item.seeAll) {
      openCollection(item.tag)
    } else if (rail.id === 'jump' && playableHere(item.core, deviceCaps)) {
      play(item)
    } else openDetail(item, 'shelf')
    // A "Jump back in" card for a game this device can't run (a PlayStation
    // session roamed over from the desktop app) opens its PAGE instead — where
    // the Play button says "Plays on desktop" and why. A card that did nothing
    // at all would just read as broken.
  }

  // Star / unstar: the server tag is the roaming truth (optimistic, same dirty-tracked
  // path as any collection edit), and the localStorage mirror is kept in step so an
  // offline session still reads and flips the star.
  const toggleFav = () => {
    if (!detailGame) return
    toggleFavorite(detailGame) // the offline mirror
    toggleGameTag(FAVORITES_TAG) // the roaming truth (optimistic + POST/DELETE)
  }

  // Hop from a hack to the base game it's based on. One place (the controller 'base' zone
  // and the mouse/touch prop both call it), inheriting this page's origin so Back returns
  // where you came from — the same convention openRematch keeps.
  const openBase = (baseId) => {
    const g = baseId && items.find((x) => x.id === baseId)
    if (g) openDetail(g, detailFrom)
  }

  // Collections edits for the open game, all optimistic: update `collections` at once so
  // the button/chips and the shelf rails react immediately, then fire the write. `id`
  // captured up front so a game-switch mid-write can't retarget it, and added to
  // `collectionsDirty` so a still-in-flight mount GET merges around it (never over it).
  // The toggles read membership from the FUNCTIONAL state and fire the write from that
  // same value, so a rapid double-tap toggles true→false→… (and posts to match) rather
  // than both reads seeing the stale pre-render membership. The write is idempotent, so a
  // dev StrictMode double-invoke of the updater is harmless.
  const toggleFinished = () => {
    if (!detailGame) return
    const id = detailGame.id
    // Celebrate only the false→true mark (never the un-mark). Decide from the ref — kept in
    // sync and updated here — so a double-tap can't celebrate an un-mark or miss a mark.
    const wasFinished = finishedRef.current.includes(id)
    finishedRef.current = wasFinished
      ? finishedRef.current.filter((x) => x !== id)
      : [id, ...finishedRef.current]
    if (!wasFinished) setFinishTick((t) => t + 1)
    collectionsDirty.current.finished.add(id)
    setCollections((c) => {
      const next = !c.finished.includes(id)
      postFinished(id, next)
      return {
        ...c,
        finished: next ? [id, ...c.finished.filter((g) => g !== id)] : c.finished.filter((g) => g !== id),
      }
    })
  }
  const addGameTag = (raw) => {
    if (!detailGame) return
    const tag = cleanTag(raw)
    if (!tag) return
    const id = detailGame.id
    collectionsDirty.current.tags.add(id)
    setCollections((c) => {
      const members = c.tags[tag] || []
      if (members.includes(id)) return c
      postTag(id, tag)
      return { ...c, tags: { ...c.tags, [tag]: [id, ...members] } }
    })
  }
  // The picker's A / tap: add the tag if this game lacks it, remove it if it has it —
  // decided from the functional state so a double-tap doesn't add twice.
  const toggleGameTag = (tag) => {
    if (!detailGame) return
    const id = detailGame.id
    collectionsDirty.current.tags.add(id)
    setCollections((c) => {
      const has = (c.tags[tag] || []).includes(id)
      const members = has ? (c.tags[tag] || []).filter((g) => g !== id) : [id, ...(c.tags[tag] || [])]
      const tags = { ...c.tags }
      if (members.length) tags[tag] = members
      else delete tags[tag] // the tag disappears when its last member leaves
      if (has) deleteTag(id, tag)
      else postTag(id, tag)
      return { ...c, tags }
    })
  }
  const startOrRemoveDownload = () => {
    // A press while it's already working (or still checking) is a no-op — otherwise a
    // controller A would kick a SECOND downloadJob for the same game (the touch button's
    // `disabled` guards only the click path, not this one).
    if (dl.state === 'downloading' || dl.state === 'checking') return
    if (dl.state === 'done') setConfirm({ kind: 'download' })
    else dl.start()
  }
  const requestDeleteSave = (slot) => setConfirm({ kind: 'save', slot })

  // The save-state editor (rename / annotate / pin). All its state lives here (like the
  // rematch/tag pickers): the modal is presentational and reports edits back. `index` is
  // the D-pad ring over its two toggles — 0 = pin, 1 = delete; the name/note are the
  // native fields a keyboard/thumb drives.
  const openSaveEditor = (snap) => {
    if (!snap) return
    const orig = { label: snap.label || '', note: snap.note || '', pinned: !!snap.pinned }
    setSaveEditor({ slot: snap.slot, index: 0, ...orig, orig })
  }
  const editSaveField = (patch) => setSaveEditor((e) => (e ? { ...e, ...patch } : e))
  // Persist on close — but only if something actually changed, so opening a save just to
  // look at it is a read (no write, no re-sort). When it did change, optimistically
  // re-label/re-sort the open list (pinned first, then newest) so it shows at once.
  const closeSaveEditor = () => {
    const e = saveEditor
    setSaveEditor(null)
    if (!e || !detailGame) return
    const label = cleanTag(e.label) // same collapse/cap as tags; empty → default name
    // Cap by CODE POINT (spread) to match Python's slice, like cleanTag — so an emoji
    // note near the cap truncates the same on both ends.
    const note = [...(e.note || '').trim()].slice(0, NOTE_MAXLEN).join('') || null
    const pinned = !!e.pinned
    const o = e.orig
    if (label === o.label && (note || '') === (o.note || '') && pinned === o.pinned) return // unchanged
    setSaves((list) =>
      list
        .map((s) => (s.slot === e.slot ? { ...s, label: label || null, note, pinned } : s))
        .sort((a, b) => Number(!!b.pinned) - Number(!!a.pinned) || Number(b.slot) - Number(a.slot))
    )
    setStateMeta(detailGame.id, e.slot, { label, note, pinned })
  }
  // Delete from within the editor: close it, then route through the same guarded confirm.
  const deleteFromEditor = () => {
    const slot = saveEditor?.slot
    setSaveEditor(null)
    if (slot) requestDeleteSave(slot)
  }

  // The on-screen keyboard. Opened from a field the controller can't type into
  // directly — the new-collection name, a save's label or note — seeded with that
  // field's current text and a per-target length cap (the same caps the commit paths
  // enforce). It sits OVER the picker/editor that opened it and hands its text back on
  // Done. A finger never gets here: touch keeps the native fields.
  const KB_MAX = { tag: TAG_MAXLEN, saveLabel: TAG_MAXLEN, saveNote: NOTE_MAXLEN, baseSearch: 60 }
  const openKeyboard = (target) => {
    const seed =
      target === 'saveLabel' ? saveEditor?.label || ''
      : target === 'saveNote' ? saveEditor?.note || ''
      : target === 'baseSearch' ? rematch?.query || ''
      : ''
    setKeyboard({ target, text: seed, shift: false, pos: { r: 0, c: 0 }, max: KB_MAX[target] ?? 40 })
  }
  const commitKeyboard = () => {
    const kb = keyboard
    setKeyboard(null)
    if (!kb) return
    if (kb.target === 'tag') addGameTag(kb.text)
    else if (kb.target === 'saveLabel') editSaveField({ label: kb.text })
    else if (kb.target === 'saveNote') editSaveField({ note: kb.text })
    else if (kb.target === 'baseSearch') runBaseSearch(kb.text)
  }
  // Activate a key (from A on the cursor, or a mouse click on any key). A `done` key
  // commits and closes; everything else edits the text and moves the cursor to it.
  const pressKeyboardKey = (r, c) => {
    if (!keyboard) return
    const next = applyKey(keyboard, keyAt({ r, c }), { maxLen: keyboard.max })
    if (next.done) commitKeyboard()
    else setKeyboard((k) => (k ? { ...k, text: next.text, shift: next.shift, pos: { r, c } } : k))
  }
  const deleteSave = async (slot) => {
    // Drop the row at once (optimistic): the focus-clamp effect then moves the cursor off
    // it this render, so a confirm-press in the delete's round-trip window can't launch
    // the player into the snapshot that's on its way out. The refetch reconciles after.
    setSaves((list) => list.filter((snap) => snap.slot !== slot))
    try {
      await fetch(`${saveStatesUrl(detailGame.id)}&slot=${encodeURIComponent(slot)}`, { method: 'DELETE' })
    } finally {
      setSavesRefresh((n) => n + 1)
    }
  }
  const confirmYes = () => {
    if (!confirm) return
    if (confirm.kind === 'download') dl.remove()
    else deleteSave(confirm.slot)
    setConfirm(null)
  }

  // The "Wrong game?" picker's navigable option list — shared with the dialog via
  // `rematchOptions` (frog/rematch.js) so the controller index and the rendered rows never
  // drift: candidate games, then base-game search results, a "search" row, then "Clear"
  // (only when matched). Index -1 is the "It's a ROM hack" toggle above the list.
  const openRematch = () => {
    if (!detailGame) return
    const gid = detailGame.id
    const matched = !!meta?.matched
    // Guard against a game switch mid-fetch (like the meta/saves fetches): only open
    // the picker if we're still on the game it was requested for — otherwise a slow
    // response would open game A's candidates over game B and a pick would mis-write.
    // `hack` starts from the game's current state, so re-opening the picker on a hack
    // shows the toggle already on. `index: -1` is the hack toggle row above the list.
    const isHack = !!meta?.is_hack
    const land = (d) => {
      if (metaGameRef.current !== gid) return
      const cands = d.candidates ?? []
      // Land on the first candidate so the common "fix a wrong match" flow is unchanged;
      // the "It's a ROM hack" toggle sits one Up above it (index -1). With no candidates
      // to pick, start on the toggle since it's the only thing to touch.
      setRematch({
        candidates: cands, current: d.current ?? null, confidence: d.confidence ?? null,
        matched, hack: isHack,
        searchResults: [], searching: false, query: '',
        index: cands.length ? 0 : -1,
      })
    }
    fetch(gameCandidatesUrl(gid))
      .then((r) => (r.ok ? r.json() : { candidates: [], current: null }))
      .then(land)
      .catch(() => land({ candidates: [], current: null }))
  }
  // Apply a pick: an igdbId re-matches (as a hack when `isHack`), null clears. Close +
  // refetch the game's meta on success so the page redraws as the newly-chosen game (or
  // the basic page), and optimistically update the hack map so the badges react at once.
  // On failure (IGDB unreachable → 502) keep the dialog open with an error rather than
  // closing silently and leaving the user thinking the fix took.
  const applyMatch = async (igdbId, isHack = false, baseName = null) => {
    const gid = detailGame?.id
    if (!gid) return
    setRematch((r) => (r ? { ...r, busy: true, error: null } : r))
    try {
      const res = await postGameMatch(gid, igdbId, isHack)
      if (!res.ok) throw new Error('re-match failed')
      // Optimistic hack-map update: mark this game dirty (so a slow mount GET merges
      // around it) and set/clear its badge. The meta refetch fills the authoritative
      // base name + owned-base deep-link.
      collectionsDirty.current.hacks.add(gid)
      setCollections((c) => {
        const nextHacks = { ...(c.hacks || {}) }
        if (igdbId != null && isHack) nextHacks[gid] = baseName || nextHacks[gid] || '…'
        else delete nextHacks[gid]
        return { ...c, hacks: nextHacks }
      })
      setRematch(null)
      setHeroSlide(0)
      setMetaRefresh((n) => n + 1)
    } catch {
      setRematch((r) => (r ? { ...r, busy: false, error: 'Couldn’t update — try again.' } : r))
    }
  }
  // Search IGDB by a typed title (the picker's "search for a game" path) — for a ROM whose
  // filename matched no candidates, so it can still be linked to a base game. Results land
  // in the same option list as the candidates; the cursor jumps to the first one. Guards a
  // game switch mid-fetch like openRematch does, and narrows to the ROM's platform.
  const runBaseSearch = async (query) => {
    const gid = detailGame?.id
    if (!gid) return
    setRematch((r) => (r ? { ...r, searching: true, error: null, query } : r))
    try {
      const res = await fetch(gameMetaSearchUrl(query, detailGame?.label))
      const data = res.ok ? await res.json() : { results: [] }
      if (metaGameRef.current !== gid) return
      setRematch((r) => {
        if (!r) return r
        const have = new Set((r.candidates || []).map((c) => c.id))
        const results = (data.results || []).filter((c) => !have.has(c.id))
        // Land on the first fresh result (candidates come first in the option list).
        return { ...r, searchResults: results, searching: false,
          index: results.length ? (r.candidates || []).length : r.index }
      })
    } catch {
      if (metaGameRef.current !== gid) return
      setRematch((r) => (r ? { ...r, searching: false, error: 'Search failed — try again.' } : r))
    }
  }

  // Keep the game-page focus valid as its zones change: a save-list delete shrinks
  // the list, and meta arriving (or a game switch) adds/removes the screenshot strip.
  // Clamp the index and, when a zone empties, hand the cursor to the nearest one above.
  useEffect(() => {
    setDetailFocus((f) => {
      // The Trailer button (index 4) can vanish under the cursor — meta re-resolving,
      // or the network dropping — so the actions row clamps like the lists do.
      if (f.zone === 'actions') return f.index <= actionsMax ? f : { zone: 'actions', index: actionsMax }
      if (f.zone === 'tags') return { zone: 'tags', index: 0 } // always present, single target
      // The hero / base / fix controls are single targets; if they went away, fall to actions.
      if (f.zone === 'hero') return shots.length ? { zone: 'hero', index: 0 } : { zone: 'actions', index: 0 }
      if (f.zone === 'base') return detailBaseId ? { zone: 'base', index: 0 } : { zone: 'actions', index: 0 }
      if (f.zone === 'facets') {
        if (detailFacets.length === 0) return { zone: 'actions', index: 0 }
        return f.index < detailFacets.length ? f : { zone: 'facets', index: detailFacets.length - 1 }
      }
      if (f.zone === 'fix') return canRematch ? { zone: 'fix', index: 0 } : { zone: 'actions', index: 0 }
      // The two list zones clamp their index and fall to actions when they empty.
      if (f.zone === 'similar') {
        if (similar.length === 0) return { zone: 'actions', index: 0 }
        return f.index < similar.length ? f : { zone: 'similar', index: similar.length - 1 }
      }
      // saves
      if (saves.length === 0) return { zone: 'actions', index: 0 }
      return f.index < saves.length ? f : { zone: 'saves', index: saves.length - 1 }
    })
  }, [saves, shots.length, detailBaseId, detailFacets.length, canRematch, similar.length, actionsMax])

  // Append a key, but only if it keeps the list alive — the same dead-key rule the
  // grid dims by, enforced here so you physically cannot type into an empty result
  // set (whether by pad or by a laptop keyboard). Functional update so a fast typist
  // never races a stale `query`.
  const typeKey = useCallback(
    (ch) => {
      setQuery((q) => (items.some((g) => matches(g.name, q + ch)) ? q + ch : q))
      setZone('grid')
    },
    [items]
  )

  // Everything the controller can do, in one place, keyed by which screen is up.
  // Held in a ref so the poll loop is installed once and never re-installed mid-press.
  const act = useRef(() => {})
  act.current = (action) => {
    if (screen === 'boot') return
    // Nothing to point at yet. Without this, presses land against the skeleton's
    // placeholder rails and strand focus the moment the real ones arrive.
    if (booting) return

    // The soft navigation blip (opt-in, off by default). Fired here — before the
    // per-screen handling — so a move/confirm/back clicks the same way on every screen.
    playForAction(action, navSfx)

    // A confirm dialog on the game page traps ALL input until it's resolved (A yes /
    // B no) — ahead of even the global X-search toggle, or X would slip past it and
    // leave the dialog stranded open behind the search screen.
    if (screen === 'detail' && confirm) {
      if (action === 'confirm') confirmYes()
      else if (action === 'back') setConfirm(null)
      return
    }

    // A fullscreen screenshot also traps input: left/right page through the shots,
    // B / A closes. Ahead of the search toggle for the same reason as the confirm.
    if (screen === 'detail' && lightbox !== null) {
      if (action === 'left') setLightbox((i) => Math.max(0, i - 1))
      else if (action === 'right') setLightbox((i) => Math.min(shots.length - 1, i + 1))
      else if (action === 'back' || action === 'confirm') setLightbox(null)
      return
    }

    // The fullscreen trailer, same trap: left/right switch videos, B closes. A is left
    // to the embedded player (play/pause lives inside the frame, not with us).
    if (screen === 'detail' && trailer !== null) {
      if (action === 'left') setTrailer((i) => Math.max(0, i - 1))
      else if (action === 'right') setTrailer((i) => Math.min(trailerVideos.length - 1, i + 1))
      else if (action === 'back') setTrailer(null)
      return
    }

    // The "Wrong game?" picker traps input too: up/down move the highlight, A picks
    // (re-match / clear / open the base-game search), B cancels. Gated on !keyboard so
    // that when the on-screen keyboard is open OVER the picker (base-game search), the
    // keyboard trap below owns the pad instead.
    if (screen === 'detail' && rematch && !keyboard) {
      const opts = rematchOptions(rematch)
      // index -1 is the "It's a ROM hack" toggle above the candidate list.
      if (action === 'up') setRematch((r) => ({ ...r, index: Math.max(-1, r.index - 1) }))
      else if (action === 'down') setRematch((r) => ({ ...r, index: Math.min(opts.length - 1, r.index + 1) }))
      else if (action === 'confirm') {
        if (rematch.index < 0) {
          setRematch((r) => ({ ...r, hack: !r.hack })) // toggle hack mode
        } else {
          const o = opts[rematch.index]
          if (o?.type === 'search') openKeyboard('baseSearch')
          // A hack borrows the chosen candidate's art but keeps its own name; 'clear'
          // (use the basic page) is never a hack.
          else if (o) applyMatch(o.type === 'clear' ? null : o.id, o.type === 'clear' ? false : rematch.hack, o.name)
        }
      } else if (action === 'back') setRematch(null)
      return
    }

    // The on-screen keyboard traps input ahead of the picker/editor it sits over:
    // the D-pad walks the board, A presses the lit key, B peels a character (empty →
    // cancel back to the field), and a Done key commits.
    if (screen === 'detail' && keyboard) {
      if (action === 'up' || action === 'down' || action === 'left' || action === 'right') {
        setKeyboard((k) => (k ? { ...k, pos: moveKey(k.pos, action) } : k))
      } else if (action === 'confirm') {
        pressKeyboardKey(keyboard.pos.r, keyboard.pos.c)
      } else if (action === 'back') {
        if (keyboard.text) setKeyboard((k) => (k ? deleteChar(k) : k))
        else setKeyboard(null)
      }
      return
    }

    // The tag picker traps input: up/down walk the "new collection" row (index -1) and
    // the EXISTING tags below it; A opens the keyboard on the new row, or toggles this
    // game's membership on a tag; B closes.
    if (screen === 'detail' && tagPicker) {
      const n = allTags.length
      // The "new collection" row (index -1) exists only in pad mode; in touch mode the
      // native field stands in its place, so the D-pad floor stays at 0 there and can't
      // land on an unrendered row (which would pop the on-screen keyboard over the input).
      const floor = native ? 0 : -1
      if (action === 'up') setTagPicker((t) => ({ index: Math.max(floor, t.index - 1) }))
      else if (action === 'down') setTagPicker((t) => ({ index: Math.min(n - 1, t.index + 1) }))
      else if (action === 'confirm') {
        if (tagPicker.index < 0) openKeyboard('tag')
        else {
          const tag = allTags[tagPicker.index]
          if (tag) toggleGameTag(tag)
        }
      } else if (action === 'back') setTagPicker(null)
      return
    }

    // The save-state editor traps input: up/down move over its four rows (0 = name,
    // 1 = note, 2 = pin, 3 = delete), A activates (name/note open the keyboard), B
    // closes (persisting).
    if (screen === 'detail' && saveEditor) {
      if (action === 'up') setSaveEditor((e) => ({ ...e, index: Math.max(0, e.index - 1) }))
      else if (action === 'down') setSaveEditor((e) => ({ ...e, index: Math.min(3, e.index + 1) }))
      else if (action === 'confirm') {
        if (saveEditor.index === 0) openKeyboard('saveLabel')
        else if (saveEditor.index === 1) openKeyboard('saveNote')
        else if (saveEditor.index === 2) editSaveField({ pinned: !saveEditor.pinned })
        else deleteFromEditor()
      } else if (action === 'back') closeSaveEditor()
      return
    }

    // X is search from anywhere, and X again closes it — a toggle you can find with
    // one thumb without reading the legend.
    if (action === 'search') {
      screen === 'search' ? closeSearch() : openSearch()
      return
    }

    // Settings from anywhere, and again to close. There's no free face button for it,
    // so it rides the app's existing "hold ☰ for the menu" gesture (the same one that
    // opens the pause menu in the player) — plus ',' on a keyboard.
    if (action === 'settingsToggle') {
      screen === 'settings' ? closeSettings() : screen === 'storage' ? closeStorage() : screen === 'stats' ? closeStats() : openSettings()
      return
    }

    // R3 / R is "surprise me" — a random game's page. Limited to the browsing screens
    // (the shelf, a game list, or an already-open game page for a re-roll): on Settings
    // or Search a stray stick-click shouldn't yank you out of a focused task, and the
    // trap screens (confirm / lightbox / rematch) already returned above. Swallowed
    // (not fallen through) on the other screens so it's never a half-handled action.
    if (action === 'random') {
      if (screen === 'shelf' || screen === 'games' || screen === 'detail') openRandom()
      return
    }

    if (screen === 'search') {
      // The results zone shows game matches while you're typing, your recent searches when
      // the query is empty, and — on a first run with no history yet — a few suggested
      // searches. The same cursor/zone machinery drives all three.
      const emptyRows = recentSearches.length ? recentSearches.map((r) => r.q) : suggestions
      const searchRows = query ? results.length : emptyRows.length
      const pickSearchRow = () => {
        if (query) {
          if (results[resultRow]) openFromSearch(results[resultRow])
        } else {
          const q = emptyRows[resultRow]
          if (q) applyRecentQuery(q)
        }
      }
      if (zone === 'grid') {
        switch (action) {
          case 'confirm':
            typeKey(KEYS[keyIndex])
            return
          // B peels back one layer at a time: a typed character, then (empty) out of
          // search entirely. Never a dead end.
          case 'back':
            query ? setQuery((q) => q.slice(0, -1)) : closeSearch()
            return
          // The shoulder is the express lane to the results — one press, from any key,
          // instead of walking Down through every row. The spatial Down-exit below
          // still works for the thumb that expects it.
          case 'railNext':
            if (searchRows) {
              setZone('results')
              setResultRow(0)
            }
            return
          case 'up':
          case 'down':
          case 'left':
          case 'right': {
            const move = gridMove(keyIndex, action)
            if (move.exit === 'results') {
              // Down off the bottom row drops into the results — but only if there are
              // any; otherwise the keyboard keeps the cursor rather than stranding it.
              if (searchRows) {
                setZone('results')
                setResultRow(0)
              }
            } else {
              setKeyIndex(move.index)
            }
            return
          }
          default:
        }
        return
      }

      // The results zone.
      switch (action) {
        case 'confirm':
        case 'alt':
          pickSearchRow()
          return
        // Up off the top row hands the cursor back to the keyboard — the mirror of the
        // down-press that brought you here. Decide the zone OUTSIDE the setState updater
        // so the updater stays pure (StrictMode double-invokes it).
        case 'up':
        case 'left':
          if (resultRow <= 0) setZone('grid')
          else setResultRow((i) => i - 1)
          return
        case 'down':
        case 'right':
          setResultRow((i) => Math.min(searchRows - 1, i + 1))
          return
        // The shoulder that took you here takes you back.
        case 'railPrev':
        case 'back':
          setZone('grid')
          return
        default:
      }
      return
    }

    // Settings: a vertical row per card, up/down between them. On the IGDB card A
    // re-scans; on the segmented rows A / left-right cycle the value; on the storage
    // card A steps into the Downloads & Storage screen. B closes.
    if (screen === 'settings') {
      const rows = ['igdb', 'inputMode', 'sound', 'touch', 'storage', 'stats']
      const idx = rows.indexOf(settingsFocus)
      const modes = ['auto', 'touch', 'pad']
      const cycleMode = (dir) =>
        setInputMode(modes[(modes.indexOf(inputMode) + dir + modes.length) % modes.length])
      // Touch-opacity as a stepped level (Faint→Soft→Bold→Solid). left/right clamp at the
      // ends; A cycles forward with wrap so it always changes something. A legacy value
      // that isn't one of the levels falls back to the default step.
      const levels = TOUCH_OPACITY_LEVELS.map((l) => l.value)
      const here = levels.indexOf(nearestOpacityLevel(touchOpacity))
      const stepOpacity = (dir, wrap = false) => {
        const next = wrap
          ? (here + dir + levels.length) % levels.length
          : Math.min(levels.length - 1, Math.max(0, here + dir))
        setTouchOpacity(levels[next])
      }
      switch (action) {
        case 'back':
          closeSettings()
          return
        case 'up':
          setSettingsFocus(rows[Math.max(0, idx - 1)])
          return
        case 'down':
          setSettingsFocus(rows[Math.min(rows.length - 1, idx + 1)])
          return
        case 'confirm':
          if (settingsFocus === 'igdb') doRescan()
          else if (settingsFocus === 'inputMode') cycleMode(1)
          else if (settingsFocus === 'sound') setNavSfx(!navSfx)
          else if (settingsFocus === 'touch') stepOpacity(1, true)
          else if (settingsFocus === 'storage') openStorage()
          else openStats()
          return
        case 'left':
          if (settingsFocus === 'inputMode') cycleMode(-1)
          else if (settingsFocus === 'sound') setNavSfx(false)
          else if (settingsFocus === 'touch') stepOpacity(-1)
          return
        case 'right':
          if (settingsFocus === 'inputMode') cycleMode(1)
          else if (settingsFocus === 'sound') setNavSfx(true)
          else if (settingsFocus === 'touch') stepOpacity(1)
          return
        default:
      }
      return
    }

    // Downloads & Storage: a vertical list — each downloaded game, then Verify, then
    // Remove all. A on a game asks first; B backs out to Settings. The confirm gate,
    // when up, traps all input (same shape as the game page's).
    if (screen === 'storage') {
      if (confirm) {
        if (action === 'confirm') storageConfirmYes()
        else if (action === 'back') setConfirm(null)
        return
      }
      const idx = Math.max(0, storageRows.indexOf(storageFocus))
      switch (action) {
        case 'back':
          closeStorage()
          return
        case 'up':
          setStorageFocus(storageRows[Math.max(0, idx - 1)])
          return
        case 'down':
          setStorageFocus(storageRows[Math.min(storageRows.length - 1, idx + 1)])
          return
        case 'confirm': {
          if (storageFocus === 'verify') storageVerify()
          else if (storageFocus === 'removeAll') {
            const d = storageData
            if (d && (d.items.length || d.engineBytes || d.gameSavesBytes)) setConfirm({ kind: 'storageAll' })
          } else {
            const e = (storageData?.items ?? []).find((x) => x.key === storageFocus)
            if (e) setConfirm({ kind: 'storageRemove', key: e.key, name: e.name })
          }
          return
        }
        default:
      }
      return
    }

    // Pond stats: a read-only card walk — up/down move (which scrolls the focused
    // card into view), B backs out to Settings. Nothing here commits anything.
    if (screen === 'stats') {
      const rows = ['pond', 'time', 'trophies', ...(stats?.genres?.length ? ['genres'] : [])]
      const idx = Math.max(0, rows.indexOf(statsFocus))
      if (action === 'back') closeStats()
      else if (action === 'up') setStatsFocus(rows[Math.max(0, idx - 1)])
      else if (action === 'down') setStatsFocus(rows[Math.min(rows.length - 1, idx + 1)])
      return
    }

    // The game page. (A confirm dialog / open lightbox, if up, was handled at the top.)
    // Zones stack vertically: actions → screens (screenshot strip) → saves, with only
    // the present ones in `detailZones`. up/down step between zones; left/right move
    // within actions or the screenshot strip.
    if (screen === 'detail') {
      const f = detailFocus
      const zi = detailZones.indexOf(f.zone)
      const above = zi > 0 ? detailZones[zi - 1] : null
      const below = zi >= 0 && zi < detailZones.length - 1 ? detailZones[zi + 1] : null
      switch (action) {
        case 'back':
          closeDetail()
          return
        case 'confirm':
          if (f.zone === 'hero') {
            if (shots.length) setLightbox(heroSlide) // open the hero's shots fullscreen
          } else if (f.zone === 'base') {
            openBase(detailBaseId) // hop to the base game this hack is based on
          } else if (f.zone === 'facets') {
            if (detailFacets[f.index]) openFacet(detailFacets[f.index]) // browse this genre/series
          } else if (f.zone === 'fix') {
            openRematch()
          } else if (f.zone === 'actions') {
            if (f.index === 0) play(detailGame)
            else if (f.index === 1) toggleFav()
            else if (!isNative() && f.index === 2) startOrRemoveDownload()
            else if (f.index === 3 - dlShift) toggleFinished()
            else if (trailerVideos.length) setTrailer(0)
          } else if (f.zone === 'tags') {
            setTagPicker({ index: native ? 0 : -1 })
          } else if (f.zone === 'similar') {
            // Open the picked similar game. Inherit THIS page's origin (never 'detail')
            // so Back returns to the screen you came from, not a dead-ended game page —
            // the same reasoning as openRandom.
            if (similar[f.index]) openDetail(similar[f.index], detailFrom)
          } else if (f.zone === 'saves' && saves[f.index]) {
            play(detailGame, saves[f.index].slot)
          }
          return
        // Y opens the focused snapshot's editor (rename / note / pin / delete) — only in
        // the save zone. (Delete now lives inside that editor, behind the same confirm.)
        case 'alt':
          if (f.zone === 'saves' && saves[f.index]) openSaveEditor(saves[f.index])
          return
        // On the hero, ◀▶ peek through the background screenshots; in the actions row
        // they move between the buttons.
        case 'left':
          if (f.zone === 'hero') setHeroSlide((i) => (i - 1 + shots.length) % shots.length)
          else if (f.zone === 'actions') setDetailFocus((p) => ({ zone: 'actions', index: Math.max(0, p.index - 1) }))
          else if (f.zone === 'facets') setDetailFocus((p) => ({ zone: 'facets', index: Math.max(0, p.index - 1) }))
          else if (f.zone === 'similar') setDetailFocus((p) => ({ zone: 'similar', index: Math.max(0, p.index - 1) }))
          return
        case 'right':
          if (f.zone === 'hero') setHeroSlide((i) => (i + 1) % shots.length)
          else if (f.zone === 'actions') setDetailFocus((p) => ({ zone: 'actions', index: Math.min(actionsMax, p.index + 1) }))
          else if (f.zone === 'facets') setDetailFocus((p) => ({ zone: 'facets', index: Math.min(detailFacets.length - 1, p.index + 1) }))
          else if (f.zone === 'similar') setDetailFocus((p) => ({ zone: 'similar', index: Math.min(similar.length - 1, p.index + 1) }))
          return
        case 'up':
          // Within the save list, up walks the list first; at its top (and from any
          // other zone) it crosses to the zone above.
          if (f.zone === 'saves' && f.index > 0) setDetailFocus((p) => ({ zone: 'saves', index: p.index - 1 }))
          else if (above) setDetailFocus({ zone: above, index: 0 })
          return
        case 'down':
          // Within the save list, down walks the list first; at its bottom (and from any
          // other zone) it crosses to the zone below — the mirror of `up`. Without the
          // "not yet at the end" guard, focus would stick in the saves list and never
          // reach the "More like this" rail beneath it.
          if (f.zone === 'saves' && f.index < saves.length - 1) setDetailFocus((p) => ({ zone: 'saves', index: p.index + 1 }))
          else if (below) setDetailFocus({ zone: below, index: 0 })
          return
        default:
      }
      return
    }

    if (screen === 'shelf') {
      switch (action) {
        case 'confirm': {
          const rail = rails[focus.rail]
          pickShelfItem(rail, rail?.items?.[focus.index])
          return
        }
        case 'back':
          // The shelf is home — there's nowhere above it to go.
          return
        case 'alt': {
          const rail = rails[focus.rail]
          const item = rail?.items?.[focus.index]
          // Y opens a game's page; on the "see all" tile it opens the collection list.
          if (item?.seeAll) openCollection(item.tag)
          else if (rail?.kind === 'game' && item) openDetail(item, 'shelf')
          return
        }
        default: {
          // Only the directions move the shelf. Falling through to moveInRails with
          // (say) 'search' returns a fresh focus object that's identical but not the
          // same reference — which re-renders and fires a redundant smooth scroll on
          // every press of a button that's supposed to do nothing here.
          if (!MOVES.has(action)) return
          focusDriven.current = true // the user is steering now — stop auto-following the top rail
          const next = moveInRails(rails, focus, action, memory)
          setMemory(next.memory)
          setFocus(next.focus)
        }
      }
      return
    }

    // The games list.
    const last = games.length - 1
    const clamp = (i) => Math.max(0, Math.min(last, i))
    switch (action) {
      case 'confirm':
      case 'alt':
        if (games[row]) openDetail(games[row], 'games')
        return
      case 'back':
        setScreen('shelf')
        return
      case 'up':
      case 'left':
        setRow((i) => clamp(i - 1))
        return
      case 'down':
      case 'right':
        setRow((i) => clamp(i + 1))
        return
      // The shoulders skip a screenful; the triggers skip a letter. Sixty presses to
      // reach the S's is what makes a big library feel like a punishment.
      case 'railPrev':
        setRow((i) => clamp(i - 10))
        return
      case 'railNext':
        setRow((i) => clamp(i + 10))
        return
      case 'jumpPrev':
      case 'jumpNext':
        setRow((i) => stepLetter(games, i, action === 'jumpNext' ? 1 : -1))
        return
      default:
    }
  }

  // Hooks must all run before the boot-screen early return below — this one rides
  // with the saver block so the shelf's night flourishes can read it.
  const dozing = useDozing()

  // ── The screensaver: the pond after a few idle minutes on any browse screen. ──
  // Any input wakes it; the waking press is swallowed so it can't also navigate.
  // Reduced motion never auto-starts it, and the boot screen keeps its own scene.
  const [saver, setSaver] = useState(false)
  const saverRef = useRef(false)
  saverRef.current = saver
  const lastInputRef = useRef(Date.now())
  // Two different things, deliberately not one function. Everything you do postpones the
  // pond; only some of it is safe to DISMISS the pond with.
  const noteActivity = useCallback(() => {
    lastInputRef.current = Date.now()
  }, [])
  const wakeSaver = useCallback(() => {
    lastInputRef.current = Date.now()
    if (saverRef.current) setSaver(false)
  }, [])

  useEffect(() => {
    // A key, a MOUSE move or a wheel may dismiss from here: none of them has a trailing
    // event that could land on something once the pond unmounts. The key is also stopped
    // so the press that wakes the pond doesn't also navigate the shelf behind it.
    //
    // `pointermove` MUST be gated on the pointer being a mouse. A finger is not: a real
    // tap is pointerdown → pointermove ×N (the slop your hand adds) → pointerup → click,
    // so an ungated move here dismisses the pond mid-tap and hands the trailing click
    // straight to the tile underneath — the exact bug this whole change exists to kill,
    // just needing a few pixels of jitter instead of a perfectly still finger.
    //
    // The consequence, chosen deliberately: a finger DRAGGED across the pond (past the
    // slop, so no click follows) leaves it up until you tap. A pond that needs one more
    // tap is a great deal better than a pond that opens a random console.
    const wake = (e) => {
      if (e.type === 'pointermove' && !isMousePointer(e)) return
      if (saverRef.current && e.type === 'keydown') e.stopPropagation()
      wakeSaver()
    }
    // A PRESS may not. A tap is pointerdown → pointerup → click, and dismissing on the
    // first of those unmounts the overlay mid-gesture and lets iOS retarget the trailing
    // click onto whatever shelf tile is now under the finger. So a press only postpones
    // the pond here; the pond's own onClick dismisses it, on the gesture's terminal
    // event, while it is still the top element. Same rule as Boot.jsx.
    const dismissing = ['keydown', 'pointermove', 'wheel']
    dismissing.forEach((t) => window.addEventListener(t, wake, { capture: true }))
    window.addEventListener('pointerdown', noteActivity, { capture: true, passive: true })
    return () => {
      dismissing.forEach((t) => window.removeEventListener(t, wake, { capture: true }))
      window.removeEventListener('pointerdown', noteActivity, { capture: true })
    }
  }, [wakeSaver, noteActivity])

  useEffect(() => {
    if (screen === 'boot') return
    const tick = setInterval(() => {
      if (
        !saverRef.current &&
        document.visibilityState === 'visible' &&
        Date.now() - lastInputRef.current > SAVER_IDLE_MS &&
        !window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
      ) {
        setSaver(true)
      }
    }, 15_000)
    return () => clearInterval(tick)
  }, [screen])

  useGamepad({
    onAction: (a) => {
      if (saverRef.current) return wakeSaver()
      lastInputRef.current = Date.now()
      act.current(a)
    },
    // Any button on a sleeping pad is how we learn a controller exists at all — iOS
    // never fires `gamepadconnected` until then. On the boot screen that press is
    // also the "press A" that dismisses it.
    onPadButton: () => {
      if (saverRef.current) return wakeSaver()
      setMode((m) => nextFrogMode(m, 'pad'))
      setScreen((s) => (s === 'boot' ? 'shelf' : s))
    },
    onMenuAction: (a) => {
      if (saverRef.current) return wakeSaver()
      if (a === 'start') act.current('confirm')
      // Hold ☰ opens Settings — mirrors the player, where a hold opens the pause menu.
      else if (a === 'pauseMenu') act.current('settingsToggle')
    },
  })

  // Keyboard parity, so a desktop drives it identically. Frog Game Station is a controller app,
  // but "I'm at my laptop and I want to check something" must not require a pad.
  // Held in a ref because the listener is installed once — reading `screen`/`typeKey`
  // straight from the closure would freeze them at their first-render values.
  // A physical Backspace should always EDIT the query — delete a character, or close
  // search when there's nothing left — never just hop between zones the way pad-B does.
  const del = () => {
    if (query) {
      setQuery((q) => q.slice(0, -1))
      setZone('grid')
    } else {
      closeSearch()
    }
  }
  const kbd = useRef({})
  kbd.current = {
    screen,
    typeKey,
    del,
    // The on-screen keyboard's physical-key path (see the handler below). Held here for
    // the same reason as `typeKey`: the listener is installed once and must read live state.
    kbActive: !!keyboard,
    kbChar: (ch) => setKeyboard((k) => (k ? appendChar(k, ch, { maxLen: k.max }) : k)),
    kbDel: () => setKeyboard((k) => (k ? deleteChar(k) : k)),
    kbCommit: commitKeyboard,
    kbCancel: () => setKeyboard(null),
  }
  useEffect(() => {
    const onKey = (e) => {
      // The native search field (touch mode, but reachable with a Magic Keyboard)
      // owns its own text keys — typing, Backspace, the arrows-as-caret-movement.
      // Routing those through the grid handler too would double-type or hijack the
      // caret. Escape is the exception: the field has no way to close search, so let
      // it through to toggle search shut.
      const tag = e.target?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA') {
        // Only Escape from the SEARCH field is forwarded (to close search — it has no
        // other exit). The modal fields (tag picker, save-state editor) own their own
        // Escape via onKeyDown, so a note textarea's Enter/letters/arrows never leak out
        // to the grid handler and get dispatched as app actions.
        if (e.key === 'Escape' && kbd.current.screen === 'search') {
          e.preventDefault()
          act.current('search')
        }
        return
      }
      // The on-screen keyboard takes physical keys directly (parity with the search
      // grid): a real keyboard types straight into the draft — case and all — Backspace
      // deletes, Enter commits, Escape cancels. The arrow keys are left to fall through
      // to the action map below, so a keyboard can still walk the board's cursor the way
      // a D-pad does; only the text keys are consumed here.
      if (kbd.current.kbActive) {
        // A Cmd/Ctrl/Alt chord is a browser/OS shortcut (reload, paste, select-all),
        // not text — let it through untouched rather than swallowing it as a stray letter.
        if (e.metaKey || e.ctrlKey || e.altKey) return
        if (e.key.length === 1) {
          e.preventDefault()
          kbd.current.kbChar(e.key)
          return
        }
        if (e.key === 'Backspace') {
          e.preventDefault()
          kbd.current.kbDel()
          return
        }
        if (e.key === 'Enter') {
          e.preventDefault()
          kbd.current.kbCommit()
          return
        }
        if (e.key === 'Escape') {
          e.preventDefault()
          kbd.current.kbCancel()
          return
        }
        // fall through: arrows (and PageUp/Down) reach `act` and move the cursor
      }
      // On the search screen a real keyboard should just... type, bypassing the grid —
      // but never eat a Cmd/Ctrl/Alt shortcut (paste, reload) as a query character.
      if (kbd.current.screen === 'search') {
        if (e.metaKey || e.ctrlKey || e.altKey) return
        if (e.key.length === 1 && /[a-z0-9]/i.test(e.key)) {
          e.preventDefault()
          kbd.current.typeKey(e.key.toUpperCase())
          return
        }
        if (e.key === 'Backspace') {
          e.preventDefault()
          kbd.current.del()
          return
        }
      }
      const map = {
        ArrowUp: 'up',
        ArrowDown: 'down',
        ArrowLeft: 'left',
        ArrowRight: 'right',
        Enter: 'confirm',
        Escape: 'back',
        Delete: 'alt', // the game page: delete the focused save
        PageUp: 'railPrev',
        PageDown: 'railNext',
        '/': 'search',
        ',': 'settingsToggle', // the desk mirror of hold-☰
        r: 'random', // R3's keyboard twin (search types its own letters before this)
        R: 'random',
      }
      const a = map[e.key]
      if (!a) return
      e.preventDefault()
      act.current(a)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // A finger on the glass means touch mode — even on an iPad that a moment ago had a
  // controller driving it. A mouse means desktop, by the same rule. The mirror of the
  // pad-button flip above, and the whole mode machine lives in these two places.
  //
  // POINTER EVENTS ONLY — never `mousemove`/`mousedown`. iOS Safari synthesises legacy
  // mouse events after every tap, so a mousemove listener would flip an iPhone from touch
  // to desktop on each tap, unmounting the native search field mid-tap. Pointer events
  // carry `pointerType`; the compatibility events do not, which is what makes them
  // separable at all.
  //
  // The move is gated on the real-movement guard as well: the pad's own scrollIntoView
  // slides content under a resting cursor and produces a move at identical coordinates,
  // and that must not read as "the user picked up the mouse".
  useEffect(() => {
    const onPointerDown = (e) => {
      if (e.pointerType === 'touch') setMode((m) => nextFrogMode(m, 'touch'))
      else if (isMousePointer(e)) setMode((m) => nextFrogMode(m, 'mouse'))
    }
    const onPointerMove = (e) => {
      if (isMousePointer(e) && pointerMoved(e)) setMode((m) => nextFrogMode(m, 'mouse'))
    }
    window.addEventListener('pointerdown', onPointerDown)
    window.addEventListener('pointermove', onPointerMove)
    return () => {
      window.removeEventListener('pointerdown', onPointerDown)
      window.removeEventListener('pointermove', onPointerMove)
    }
  }, [])

  if (screen === 'boot') return <Boot onDone={() => setScreen('shelf')} />

  // What the pond light is coloured by: the open system, the result you're pointing
  // at while searching (jade until you've pointed at one), or the shelf's focus.
  const focusedSystem =
    screen === 'games'
      ? // A collection spans systems, so the pond follows the focused game's own machine;
        // a system list is simply that system.
        collectionTag
        ? games[row]?.label ?? null
        : system
      : screen === 'detail'
        ? detailGame?.label
        : screen === 'search'
          ? zone === 'results' && results[resultRow]
            ? results[resultRow].label
            : null
          : hovered(rails, focus)
  const accent = systemStyle(focusedSystem).accent

  return (
    <div
      data-testid="frog"
      // select-none across the browse chrome, the same way the player does it. This is a
      // console UI: a click-drag across a tile should never leave a blue selection behind,
      // and the game page's hero is a clickable div wrapping the title, so a drag there
      // used to select the text AND still open the lightbox on mouseup.
      //
      // Genuine PROSE opts back in with `select-text` (the game summary and About, the
      // wiki reader, the Pokédex). A blanket rule that made the wiki uncopyable would be
      // a worse bug than the one it fixes.
      className="frog-root fixed inset-0 z-50 flex select-none flex-col overflow-hidden"
      style={{
        // Feed the palette token to the CSS ground rule, so the default background stays
        // single-sourced from FROG.ground while the phone media query overrides to #000.
        '--frog-ground': FROG.ground,
        paddingTop: 'env(safe-area-inset-top)',
        paddingLeft: 'env(safe-area-inset-left)',
        paddingRight: 'env(safe-area-inset-right)',
        // The bottom inset clears the iOS home indicator. When the legend bar is shown
        // (pad only) IT owns that inset (folded into its own paddingBottom below), so the
        // root drops it here to avoid stacking a second gap under the bar. Whenever the
        // legend is hidden — touch, and now desktop — the root carries the inset itself.
        // Keyed on the legend rather than on the keyboard fork, because the legend is the
        // thing that actually owns it: an iPad in desktop mode has no legend and still has
        // a home indicator to clear.
        paddingBottom: padLegend ? 0 : 'env(safe-area-inset-bottom)',
      }}
    >
      {/* Ambient caustics — the pond's own slow shimmer. Full strength on the shelf at
          rest; dimmed while browsing a list or searching (content needs more quiet),
          tinted to the screen's system so the water follows the machine. The player
          keeps a still ground. Sits under the pond light. */}
      {(screen === 'shelf' || screen === 'games' || screen === 'search') && (
        <Caustics accent={accent} strength={screen === 'shelf' ? 1 : 0.6} />
      )}

      {/* Pond life, shelf only — lily pads adrift, a firefly after bedtime, and
          (rarely) a dragonfly crossing. All decoration: hidden from AT, no hit area. */}
      {screen === 'shelf' && (
        <>
          <LilyPads accent={accent} />
          {dozing && <Firefly />}
          <Dragonfly accent={accent} />
        </>
      )}

      {/* "Install me" — only on the shelf, only on the touch path (where the legend
          is hidden, so there's no bar to overlap, and where installing unlocks the
          full-screen/offline home-screen app), and never in the desktop app (it IS
          installed). Renders null unless the browser actually offers install and it
          hasn't been dismissed. */}
      {screen === 'shelf' && isTouchMode(mode) && !isNative() && <InstallNudge />}

      {/* One-shot "you finished a game" celebration — fires from the game page, but lives
          at the root so it rides above whatever's on screen and survives the page's zones. */}
      <FinishToast tick={finishTick} />

      {/* The pond after you've wandered off — any input wakes it (and is swallowed). */}
      {saver && <Screensaver onWake={wakeSaver} />}

      {/* The pond light. It takes the colour of whatever is in focus, which is the
          single cheapest way to make a machine feel *selected* rather than outlined. */}
      <div
        className="pointer-events-none absolute inset-0 transition-[background] duration-500"
        style={{ background: `radial-gradient(120% 80% at 50% 100%, rgba(${accent}, 0.14), transparent 70%)` }}
      />

      {/* The chrome wears the focused machine's colour too: a hairline under the header
          that recolours with everything else, so "this machine" reaches the top edge. */}
      <header
        className="relative flex items-center justify-between gap-4 px-6 py-3 transition-[box-shadow] duration-500"
        style={{ boxShadow: `inset 0 -1px 0 rgba(${accent}, 0.45), 0 7px 20px -14px rgba(${accent}, 0.6)` }}
      >
        {screen === 'games' && facetView ? (
          <FacetListHeader view={facetView} count={games.length} />
        ) : screen === 'games' && collectionTag ? (
          <CollectionListHeader tag={collectionTag} count={games.length} loading={!collectionsLoaded} />
        ) : screen === 'games' && system ? (
          <GameListHeader system={system} count={games.length} />
        ) : (
          <div className="flex min-w-0 items-center gap-2">
            <FrogMark size={22} className="shrink-0" style={{ color: `rgb(${FROG.jade})` }} />
            <span
              className="truncate text-sm font-semibold tracking-[0.16em]"
              style={{ color: FROG.ink, fontFamily: FONT_DISPLAY }}
            >
              FROG GAME STATION
              {/* The section is redundant with the screen itself, so it only rides along
                  where there's room — hidden on a phone so the name never truncates. */}
              {(screen === 'search' || screen === 'settings' || screen === 'storage' || screen === 'stats') && (
                <span className="hidden sm:inline">
                  {screen === 'search' ? ' · SEARCH' : screen === 'settings' ? ' · SETTINGS' : screen === 'storage' ? ' · STORAGE' : ' · STATS'}
                </span>
              )}
            </span>
          </div>
        )}

        <div className="flex shrink-0 items-center gap-2">
          {/* Offline: the shelf is built from downloaded games only, so say so — an
              otherwise-sparse shelf reads as "broken" without it. Shown only when we
              actually fell back (the server's unreachable AND gave us nothing), never
              while a reachable library is on screen. */}
          {offline && (
            <span
              data-testid="frog-offline"
              className="flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-medium tracking-wide"
              style={{ background: `rgba(${FROG.amber}, 0.12)`, color: `rgb(${FROG.amber})` }}
            >
              <Plane className="h-3 w-3" aria-hidden="true" />
              Offline
            </span>
          )}

          {/* Search, reachable by thumb. On a pad it's X (and the legend says so); by
              touch there was no way in at all until this button — the header only had
              the ✕. Hidden on the search screen itself, where the ✕ becomes "close". */}
          {screen !== 'search' && screen !== 'detail' && (
            <button
              onClick={openSearch}
              className="rounded-full p-2"
              style={{ background: FROG.panel, color: FROG.soft }}
              aria-label="Search games"
            >
              <SearchIcon className="h-5 w-5" aria-hidden="true" />
            </button>
          )}

          {/* Surprise me — a random pick, reachable by thumb. On a pad it's R3 (and the
              legend says so); by touch there was no route to it at all. Only on the
              browsing screens, where openRandom has somewhere to land. */}
          {(screen === 'shelf' || screen === 'games') && (
            <button
              onClick={openRandom}
              className="rounded-full p-2"
              style={{ background: FROG.panel, color: FROG.soft }}
              aria-label="Surprise me — open a random game"
            >
              <Shuffle className="h-5 w-5" aria-hidden="true" />
            </button>
          )}

          {/* Settings — a header entry point (there's no dedicated pad button for it,
              so the gear is how both thumb and cursor reach it). Hidden on the overlay
              screens that own the ✕. */}
          {screen !== 'search' && screen !== 'detail' && screen !== 'settings' && screen !== 'storage' && screen !== 'stats' && (
            <button
              onClick={openSettings}
              className="rounded-full p-2"
              style={{ background: FROG.panel, color: FROG.soft }}
              aria-label="Settings"
            >
              <SettingsIcon className="h-5 w-5" aria-hidden="true" />
            </button>
          )}

          {screen !== 'shelf' && (
            <button
              onClick={() => {
                if (screen === 'search') closeSearch()
                else if (screen === 'detail') closeDetail()
                else if (screen === 'settings') closeSettings()
                else if (screen === 'storage') closeStorage()
                else if (screen === 'stats') closeStats()
                else if (screen === 'games') setScreen('shelf')
              }}
              className="rounded-full p-2"
              style={{ background: FROG.panel, color: FROG.soft }}
              aria-label={
                screen === 'search'
                  ? 'Close search'
                  : screen === 'detail'
                    ? 'Back'
                    : screen === 'settings'
                      ? 'Close settings'
                      : screen === 'storage'
                        ? 'Close storage'
                        : screen === 'stats'
                          ? 'Close stats'
                          : 'Back to the shelf'
              }
            >
              <X className="h-5 w-5" aria-hidden="true" />
            </button>
          )}
        </div>
      </header>

      {booting ? (
        <div className="flex-1 space-y-4 px-6 pt-6">
          <SkeletonLine className="h-4 w-40" />
          <div className="flex gap-3">
            {Array.from({ length: 6 }, (_, i) => (
              <div key={i} className="h-32 flex-1 animate-pulse rounded-2xl" style={{ background: FROG.panel }} />
            ))}
          </div>
        </div>
      ) : libraryUnreachable ? (
        // Say what actually happened. This used to render as an ordinary empty
        // library — indistinguishable from owning no games — so the only way out
        // looked like restarting the app.
        <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center">
          <p className="text-lg font-semibold" style={{ color: FROG.ink }}>Couldn’t reach your library</p>
          <p className="max-w-sm text-sm leading-relaxed" style={{ color: FROG.faint }}>
            The server didn’t answer. It may still be starting up — that’s common right
            after an update.
          </p>
          <button
            data-testid="frog-library-retry"
            onClick={retryLibrary}
            autoFocus
            className="mt-1 rounded-xl px-5 py-2.5 text-sm font-semibold"
            style={{ background: `rgb(${FROG.jade})`, color: FROG.ground, boxShadow: focusRing() }}
          >
            Try again
          </button>
        </div>
      ) : screen === 'search' ? (
        <Search
          query={query}
          results={results}
          allGames={items}
          zone={zone}
          keyIndex={keyIndex}
          resultRow={resultRow}
          native={searchNative}
          onKey={(i) => {
            setKeyIndex(i)
            setZone('grid')
          }}
          onResult={(i) => {
            setResultRow(i)
            setZone('results')
          }}
          // The native keyboard hands over the whole string at once (type, paste,
          // autocorrect), so it sets the query directly rather than one dead-key-guarded
          // character at a time the way the grid does.
          onType={setQuery}
          // The mouse's delete and clear. `del` is the same one Backspace uses, so the
          // three ways of taking a letter back can't drift; clear only ever runs with a
          // non-empty query (the buttons don't render otherwise), so unlike `del` it has
          // no close-the-screen branch to worry about.
          onBackspace={del}
          onClear={() => {
            setQuery('')
            setZone('grid')
          }}
          onPick={(game, ch) => (ch != null ? typeKey(ch) : openFromSearch(game))}
          recent={recentSearches}
          suggestions={suggestions}
          onRecent={applyRecentQuery}
          onRemoveRecent={removeRecent}
        />
      ) : screen === 'settings' ? (
        <SettingsPanel
          status={igdbStatus.data}
          loading={igdbStatus.loading}
          focus={settingsFocus}
          onFocus={setSettingsFocus}
          onRescan={doRescan}
          rescanBusy={rescanBusy}
          inputMode={inputMode}
          onInputMode={setInputMode}
          navSfx={navSfx}
          onNavSfx={setNavSfx}
          touchOpacity={touchOpacity}
          onTouchOpacity={setTouchOpacity}
          onStorage={openStorage}
          onStats={openStats}
        />
      ) : screen === 'storage' ? (
        <StoragePanel
          data={storageData}
          audit={storageAudit}
          focus={storageFocus}
          onFocus={setStorageFocus}
          onRemove={(e) => setConfirm({ kind: 'storageRemove', key: e.key, name: e.name })}
          onVerify={storageVerify}
          onRemoveAll={() => setConfirm({ kind: 'storageAll' })}
          confirm={confirm?.kind === 'storageRemove' || confirm?.kind === 'storageAll' ? confirm : null}
          onConfirmYes={storageConfirmYes}
          onConfirmNo={() => setConfirm(null)}
        />
      ) : screen === 'stats' && stats ? (
        <StatsPanel stats={stats} focus={statsFocus} onFocus={setStatsFocus} />
      ) : screen === 'detail' && detailGame ? (
        <GameScreen
          game={detailGame}
          meta={meta}
          native={native}
          favorited={detailFavorited}
          saves={saves}
          loadingSaves={savesLoading}
          similar={similar}
          playMs={playStatsById.get(detailGame.id)?.play_ms}
          plays={playStatsById.get(detailGame.id)?.plays}
          lastPlayedMs={playStatsById.get(detailGame.id)?.updated_ms}
          finished={detailFinished}
          tags={detailTags}
          allTags={allTags}
          tagPicker={tagPicker}
          keyboard={keyboard}
          download={dl}
          focus={detailFocus}
          confirm={confirm}
          lightbox={lightbox}
          slide={heroSlide}
          canRematch={canRematch}
          rematch={rematch}
          onOpenSimilar={(g) => openDetail(g, detailFrom)}
          onToggleFinished={toggleFinished}
          onOpenTags={() => setTagPicker({ index: native ? 0 : -1 })}
          onToggleTag={toggleGameTag}
          onAddTag={addGameTag}
          onOpenNewTag={() => openKeyboard('tag')}
          onTagPickerFocus={(index) => setTagPicker({ index })}
          onCloseTags={() => setTagPicker(null)}
          onKeyboardHover={(r, c) => setKeyboard((k) => (k ? { ...k, pos: { r, c } } : k))}
          onKeyboardPress={pressKeyboardKey}
          onCloseKeyboard={() => setKeyboard(null)}
          onOpenSaveLabelKb={() => openKeyboard('saveLabel')}
          onOpenSaveNoteKb={() => openKeyboard('saveNote')}
          onOpenRematch={openRematch}
          onRematchHover={(index) => setRematch((r) => (r ? { ...r, index } : r))}
          onRematchPick={(igdbId, isHack, name) => applyMatch(igdbId, isHack, name)}
          onRematchToggleHack={() => setRematch((r) => (r ? { ...r, hack: !r.hack } : r))}
          onRematchSearch={(q) => (q != null ? runBaseSearch(q) : openKeyboard('baseSearch'))}
          onRematchCancel={() => setRematch(null)}
          baseGameId={detailBaseId}
          onOpenBase={openBase}
          onFocus={(zone, index) => setDetailFocus({ zone, index })}
          onPlay={() => play(detailGame)}
          onPlaySlot={(slot) => play(detailGame, slot)}
          onToggleFavorite={toggleFav}
          onDownload={startOrRemoveDownload}
          saveEditor={saveEditor}
          onOpenSaveEditor={openSaveEditor}
          onEditSaveField={editSaveField}
          onSaveEditorFocus={(index) => setSaveEditor((e) => (e ? { ...e, index } : e))}
          onDeleteFromEditor={deleteFromEditor}
          onCloseSaveEditor={closeSaveEditor}
          onOpenShot={(index) => setLightbox(index)}
          onCloseLightbox={() => setLightbox(null)}
          onLightboxNav={(dir) =>
            setLightbox((i) => Math.max(0, Math.min(shots.length - 1, i + dir)))
          }
          facets={detailFacets}
          onOpenFacet={openFacet}
          videos={trailerVideos}
          trailer={trailer}
          onOpenTrailer={() => setTrailer(0)}
          onCloseTrailer={() => setTrailer(null)}
          onTrailerNav={(dir) =>
            setTrailer((i) => Math.max(0, Math.min(trailerVideos.length - 1, i + dir)))
          }
          onConfirmYes={confirmYes}
          onConfirmNo={() => setConfirm(null)}
        />
      ) : screen === 'games' ? (
        <GameList
          system={system}
          collection={collectionTag || (facetView ? facetView.value : null)}
          loading={!!collectionTag && !collectionsLoaded}
          games={games}
          focus={row}
          finishedIds={finishedSet}
          hackIds={hackSet}
          onFocus={setRow}
          onPick={(g) => openDetail(g, 'games')}
        />
      ) : items.length === 0 ? (
        <EmptyLibrary
          online={online}
          needsIgdbKey={igdbStatus.data ? !igdbStatus.data.configured : false}
        />
      ) : (
        <Shelf
          rails={rails}
          focus={focus}
          finishedIds={finishedSet}
          hackIds={hackSet}
          // When the controller legend is showing the shelf top-aligns and adds breathing
          // room so "Jump back in" clears the header and the last system row clears the
          // legend. No legend, no need — desktop mode gets the centred layout back.
          padded={padLegend}
          onFocus={(rail, index) => { focusDriven.current = true; setFocus({ rail, index }) }}
          onPick={pickShelfItem}
        />
      )}

      {/* The controller legend. It names A/B/X/Y, so it shows ONLY when a controller is
          actually driving. A thumb doesn't need it (tappable tiles, the header
          search/close and tap-to-play are self-evident) and a mouse doesn't have the
          buttons it names. It returns the instant a pad button is pressed. */}
      {padLegend && (
      <ButtonLegend
        data-testid="frog-legend"
        className="relative py-3"
        style={{
          borderTop: `1px solid ${FROG.line}`,
          // The legend owns the bottom safe-area inset (the root drops it while the legend is
          // shown). Folding it into the bar's own paddingBottom keeps the gap ABOVE the bar
          // (py-3 = 0.75rem) and the gap BELOW it equal on a device with no home indicator
          // (desktop/TV, where the controller lives) — the inset only adds where iOS needs it.
          paddingBottom: 'calc(0.75rem + env(safe-area-inset-bottom))',
        }}
        hints={
          screen === 'search'
            ? zone === 'grid'
              ? [
                  { button: 'A', label: 'Type' },
                  // With an empty query B exits one layer — label it 'Back', not a second
                  // 'Close', so it doesn't read as a duplicate of X's 'Close'.
                  { button: 'B', label: query ? 'Delete' : 'Back' },
                  { button: 'RB', label: 'Results' },
                  { button: 'X', label: 'Close' },
                ]
              : [
                  { button: 'A', label: 'Open' },
                  { button: 'LB', label: 'Keys' },
                  { button: 'X', label: 'Close' },
                ]
            : screen === 'detail'
              ? keyboard
                ? [
                    { button: 'A', label: 'Press' },
                    { button: 'B', label: keyboard.text ? 'Delete' : 'Cancel' },
                    { button: 'D-pad', label: 'Move' },
                  ]
                : confirm
                ? [
                    { button: 'A', label: 'Confirm' },
                    { button: 'B', label: 'Cancel' },
                  ]
                : lightbox !== null
                  ? [
                      { button: 'B', label: 'Close' },
                      { button: 'D-pad', label: 'Browse' },
                    ]
                  : trailer !== null
                  ? [
                      { button: 'B', label: 'Close' },
                      ...(trailerVideos.length > 1 ? [{ button: 'D-pad', label: 'Videos' }] : []),
                    ]
                  : rematch
                    ? [
                        { button: 'A', label: rematch.index < 0 ? 'Toggle' : 'Choose' },
                        { button: 'B', label: 'Cancel' },
                        { button: 'D-pad', label: 'Move' },
                      ]
                    : tagPicker
                      ? [
                          { button: 'A', label: tagPicker.index < 0 ? 'Type' : 'Toggle' },
                          { button: 'B', label: 'Done' },
                          { button: 'D-pad', label: 'Move' },
                        ]
                      : saveEditor
                        ? [
                            {
                              button: 'A',
                              label: ['Name', 'Note', 'Pin', 'Delete'][saveEditor.index] ?? 'Select',
                            },
                            { button: 'B', label: 'Done' },
                            { button: 'D-pad', label: 'Move' },
                          ]
                        : [
                          {
                            button: 'A',
                            label:
                              detailFocus.zone === 'saves'
                                ? 'Load'
                                : detailFocus.zone === 'hero'
                                  ? 'Screenshots'
                                  : detailFocus.zone === 'base'
                                    ? 'Base game'
                                    : detailFocus.zone === 'facets'
                                      ? 'Browse'
                                    : detailFocus.zone === 'fix'
                                      ? 'Fix match'
                                      : detailFocus.zone === 'similar'
                                        ? 'Open'
                                        : detailFocus.zone === 'tags'
                                          ? 'Collections'
                                          : 'Select',
                          },
                          { button: 'B', label: 'Back' },
                          ...(detailFocus.zone === 'saves' ? [{ button: 'Y', label: 'Edit' }] : []),
                          { button: 'D-pad', label: detailFocus.zone === 'hero' ? 'Peek' : 'Move' },
                        ]
              : screen === 'settings'
                ? [
                    { button: 'A', label: 'Select' },
                    { button: 'B', label: 'Close' },
                    { button: 'D-pad', label: 'Move' },
                  ]
                : screen === 'storage'
                  ? confirm
                    ? [
                        { button: 'A', label: 'Confirm' },
                        { button: 'B', label: 'Cancel' },
                      ]
                    : [
                        { button: 'A', label: storageFocus === 'verify' ? 'Verify' : 'Remove' },
                        { button: 'B', label: 'Back' },
                        { button: 'D-pad', label: 'Move' },
                      ]
                : screen === 'stats'
                  ? [
                      { button: 'B', label: 'Back' },
                      { button: 'D-pad', label: 'Move' },
                    ]
                : screen === 'games'
                  ? [
                      { button: 'A', label: 'Open' },
                      { button: 'B', label: 'Shelf' },
                      { button: 'X', label: 'Find' },
                      // The two-tier fast-scroll, both tiers now visible: bumpers skip a
                      // screenful, triggers jump a letter. LB/RB used to be undiscoverable.
                      { button: 'LB/RB', label: 'Skip' },
                      { button: 'LT/RT', label: 'Letter' },
                      { button: 'R3', label: 'Random' },
                      { button: '☰', label: 'Hold: Settings' },
                    ]
                  : [
                      // Trimmed to fit one line on a couch width — D-pad "Move" is self-evident,
                      // so it's dropped to keep the bar from wrapping to a second (tall) row.
                      { button: 'A', label: 'Open' },
                      { button: 'X', label: 'Find' },
                      { button: 'R3', label: 'Random' },
                      { button: '☰', label: 'Hold: Settings' },
                    ]
        }
      />
      )}
    </div>
  )
}

// The system the shelf's focus implies — a system tile is itself; a game is the
// machine it runs on.
function hovered(rails, focus) {
  return rails?.[focus.rail]?.items?.[focus.index]?.label ?? null
}

// The first-run / empty shelf. Rather than a row of greyed-out "empty" systems —
// which reads like a bug — the pond is simply quiet: a dozing frog over its
// reflection, and a plain-language nudge toward what to configure (the ROM folder,
// plus IGDB creds when those aren't set either). Offline with nothing downloaded gets
// its own honest line.
function EmptyLibrary({ online, needsIgdbKey = false }) {
  const Chip = ({ children }) => (
    <code
      className="rounded px-1.5 py-0.5 text-[0.8em]"
      style={{ background: FROG.panel, color: FROG.ink }}
    >
      {children}
    </code>
  )
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-6 px-8 pb-16 text-center">
      <Reflected>
        <Frog size={120} asleep />
      </Reflected>
      <div className="max-w-sm space-y-2">
        <h2 className="text-lg font-semibold" style={{ color: FROG.ink }}>
          {online ? 'The pond’s quiet' : 'You’re offline'}
        </h2>
        <p className="text-sm leading-relaxed" style={{ color: FROG.soft }}>
          {online
            ? 'No games on the shelf yet. Point Frog at a folder of ROMs and they’ll hop right in.'
            : 'No downloaded games to play offline. Reconnect to browse your library.'}
        </p>
        {online && (
          <p className="pt-1 text-xs leading-relaxed" style={{ color: FROG.faint }}>
            Set <Chip>ROMS_DIR</Chip> in your <Chip>.env</Chip> to your ROM folder, then
            restart the stack.
          </p>
        )}
        {online && needsIgdbKey && (
          <p className="text-xs leading-relaxed" style={{ color: FROG.faint }}>
            For cover art and rich game details, add <Chip>IGDB_CLIENT_ID</Chip> and{' '}
            <Chip>IGDB_CLIENT_SECRET</Chip> too — Frog matches every game once they’re set.
          </p>
        )}
      </div>
    </div>
  )
}

