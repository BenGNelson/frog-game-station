import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { X, Search as SearchIcon, Plane, Settings as SettingsIcon } from 'lucide-react'
import { useApi } from '../lib/useApi.js'
import { useOnline } from '../lib/online.jsx'
import { useDownloadedEntries } from '../lib/useDownloaded.js'
import { useDownload } from '../lib/useDownload.js'
import {
  systemGames, gameOfflineUrls, saveStatesUrl, gameMetaUrl, gameCandidatesUrl, postGameMatch,
  GAME_META_STATUS_PATH, fetchPlayStats, postMetaRescan,
} from '../lib/library.js'
import { readSettings, writeSettings } from '../lib/playerSettings.js'
import { isFavorite, toggleFavorite } from '../lib/favorites.js'
import { setStateMeta } from '../lib/saveStates.js'
import { ensureEmulatorEngine, cacheGameSram } from '../lib/offlineStore.js'
import { offlineGamesToItems } from './offline.js'
import { getRecent, recordPlayed } from '../lib/recentGames.js'
import {
  fetchCollections, postFinished, postTag, deleteTag, cleanTag, tagsForGame, mergeCollections, TAG_MAXLEN,
} from '../lib/collections.js'
import { getFavorites } from '../lib/favorites.js'
import { getRecentSearches, recordSearch, removeRecentSearch } from '../lib/recentSearches.js'
import { moveInRails } from '../lib/gridNav.js'
import { playForAction } from '../lib/sfx.js'
import { useGamepad } from '../lib/useGamepad.js'
import { mediaMatches } from '../lib/useMediaQuery.js'
import { SkeletonLine } from '../components/ui.jsx'
import ButtonLegend from '../player/ButtonLegend.jsx'
import { defaultFrogMode, nextFrogMode, usesNativeKeyboard } from './input.js'
import { FROG, systemStyle } from './theme.js'
import { buildShelf, hydrate, stepLetter, collectionGames } from './shelf.js'
import { searchGames, matches, KEYS, gridMove } from './search.js'
import { ROWS as KB_ROWS, keyAt, moveKey, applyKey, appendChar, deleteChar } from '../lib/keyboard.js'
import Frog, { FrogMark, Reflected } from './Frog.jsx'
import Boot from './Boot.jsx'
import Shelf from './Shelf.jsx'
import Search from './Search.jsx'
import SettingsPanel from './Settings.jsx'
import GameScreen from './GameScreen.jsx'
import GameList, { GameListHeader, CollectionListHeader } from './GameList.jsx'
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

// Frog Game Station's place, held for the life of the tab rather than the life of the component.
//
// This has to live outside React. FrogBrowser UNMOUNTS every time you launch a game
// (the player is a different route), so with `useState` alone, quitting a game would
// replay the whole boot animation, ask you to PRESS A again, and dump you back on
// rail zero — having forgotten which system you were three hundred games into. The
// boot is once per app open; your place survives a session.
const place = { booted: false, screen: 'shelf', system: null, collection: null, focus: { rail: 0, index: 0 }, row: 0 }

export default function FrogBrowser() {
  const navigate = useNavigate()
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
  const { data, loading } = useApi(`/library/games${reloadNonce ? `?r=${reloadNonce}` : ''}`, 0)
  const apiItems = data?.items ?? []

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
  const items = useMemo(() => {
    const api = data?.items ?? []
    return api.length ? api : offlineItems ?? []
  }, [data, offlineItems])
  // Skeleton only while we truly have nothing to show and a source might still land.
  // Keyed on `items` (not the API alone) so a reconnect refetch keeps the offline
  // shelf up rather than flashing a skeleton over it.
  const booting = !items.length && (loading || offlineItems === null)
  // The chip means "you're seeing downloaded games only because the server is
  // unreachable" — precisely when the probe says offline AND the API gave us nothing.
  const offline = !online && !apiItems.length

  // 'boot' → 'shelf' ⇄ 'games'; 'search'/'detail'/'settings' are transient overlays.
  const [screen, setScreen] = useState(place.booted ? place.screen : 'boot')
  const [system, setSystem] = useState(place.system)
  // The 'games' screen shows one system's games OR one collection's — never both. Which
  // it is comes down to whether a collection tag is set (openSystem / openCollection each
  // clear the other), so the screen, the header, and the list styling all fork on this.
  const [collectionTag, setCollectionTag] = useState(place.collection)

  const [focus, setFocus] = useState(place.focus)
  const [memory, setMemory] = useState({})
  const [row, setRow] = useState(place.row) // focus within a system's game list

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
  const [rescanBusy, setRescanBusy] = useState(false)
  // The IGDB matcher status — polled only while the settings screen is up (one cheap
  // fetch otherwise); useApi pauses when the tab is hidden.
  const igdbStatus = useApi(GAME_META_STATUS_PATH, screen === 'settings' ? 4000 : 0)

  // Touch vs pad. Opens from the pointer kind (a phone starts in touch), then every
  // real input keeps it honest — a gamepad button flips to pad, a finger back to
  // touch. It decides the two places a finger and a D-pad disagree: the search
  // keyboard (native vs the 6×6 grid) and whether the controller legend even shows.
  const [mode, setMode] = useState(() => defaultFrogMode(mediaMatches('(pointer: coarse)')))
  const native = usesNativeKeyboard(mode)

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
  const [favorited, setFavorited] = useState(false)
  const [saves, setSaves] = useState([])
  const [savesLoading, setSavesLoading] = useState(false)
  const [savesRefresh, setSavesRefresh] = useState(0)
  // The open game's rich IGDB metadata (screenshots/summary/genres/rating). `null`
  // until it lands / when the game isn't matched or IGDB isn't configured — in which
  // case GameScreen renders its basic layout (a ROM hack looks exactly like today).
  const [meta, setMeta] = useState(null)
  // A screenshot opened fullscreen: its index into meta.screenshot_ids, or null.
  const [lightbox, setLightbox] = useState(null)
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

  // Per-game play-time totals (the "Most played" rail + the game-page line). FrogBrowser
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
  // The ROM-hack map (game_id → base game's name), for the "HACK" badges across the
  // browsing surfaces. Server-owned like the rest of collections, so a game marked a hack
  // on the couch reads as one on the phone.
  const hacks = collections.hacks || {}
  const hackSet = useMemo(() => new Set(Object.keys(hacks)), [hacks])

  const rails = useMemo(
    () => buildShelf(items, getRecent(), getFavorites(), playStatItems, collections),
    [items, playStatItems, collections]
  )
  // The 'games' screen's list: a collection's members (naturally sorted, spanning
  // systems) when a tag is open, otherwise the focused system's games.
  const games = useMemo(
    () => (collectionTag ? collectionGames(items, collections.tags, collectionTag) : system ? systemGames(items, system) : []),
    [items, system, collectionTag, collections.tags]
  )
  // Searched across EVERY system, not just the open one — from the shelf you haven't
  // picked a console yet, and "which box is Zelda in" is exactly what search is for.
  const results = useMemo(() => searchGames(items, query), [items, query])

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
  // The open game's collection state, derived from the shared `collections`.
  const detailFinished = detailGame ? finishedSet.has(detailGame.id) : false
  const detailTags = useMemo(
    () => (detailGame ? tagsForGame(collections.tags, detailGame.id) : []),
    [collections.tags, detailGame]
  )
  const allTags = useMemo(
    () => Object.keys(collections.tags).sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase())),
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
    if (canRematch) z.push('fix') // the "Wrong game?" control, below the facts
    z.push('tags') // "Collections" — always available (you can always tag a game)
    if (saves.length) z.push('saves')
    if (similar.length) z.push('similar') // the rail at the foot of the page
    return z
  }, [shots.length, detailBaseId, canRematch, saves.length, similar.length])

  // Slowly crossfade the hero's background through the screenshots. Paused while the
  // lightbox is open (you're looking at one) and under reduced-motion (leave it still).
  // Local UI churn only — it never refetches, so it can't disturb scroll/data.
  useEffect(() => {
    if (screen !== 'detail' || lightbox !== null || shots.length < 2) return
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches) return
    const t = setInterval(() => setHeroSlide((i) => (i + 1) % shots.length), 5000)
    return () => clearInterval(t)
  }, [screen, lightbox, shots.length])

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
        : screen === 'settings'
          ? settingsFrom
          : screen === 'detail'
            ? detailFrom === 'search'
              ? searchFrom
              : detailFrom
            : screen
    Object.assign(place, { booted: true, screen: persistScreen, system, collection: collectionTag, focus, row })
  })

  // Typing narrows the list under the cursor: keep the result focus in range, and if
  // the list empties out from under the results zone, hand the cursor back to the keys.
  useEffect(() => {
    setResultRow((i) => Math.min(i, Math.max(0, results.length - 1)))
    if (!results.length) setZone((z) => (z === 'results' ? 'grid' : z))
  }, [results])

  // Reconcile focus with whatever the rails just became.
  //
  // The rails CHANGE SHAPE after the shelf is already interactive — not just once when
  // the library resolves (Jump back in / Favorites appearing) but again as the async
  // Most played, Finished, and per-tag rails land. Keeping focus.rail as a bare index
  // would let a rail inserted AHEAD of you slide the highlight onto a different game. So
  // we keep focus on the SAME rail by identity: find where its id moved to, and only
  // fall back to index-clamping when that rail is gone (or on the first resolve).
  const prevRails = useRef(rails)
  useEffect(() => {
    const prev = prevRails.current
    prevRails.current = rails
    setFocus((f) => {
      const wasId = prev[f.rail]?.id
      let rail = wasId != null ? rails.findIndex((r) => r.id === wasId) : -1
      if (rail < 0) rail = Math.min(f.rail, Math.max(0, rails.length - 1))
      const count = rails[rail]?.items?.length ?? 0
      const index = Math.min(f.index, Math.max(0, count - 1))
      return rail === f.rail && index === f.index ? f : { rail, index }
    })
  }, [rails])

  // Same for the game list: a system with 25 games can't hold a cursor at row 300.
  useEffect(() => {
    setRow((i) => Math.min(i, Math.max(0, games.length - 1)))
  }, [games])

  const play = useCallback(
    (game, slot) => {
      if (!game) return
      recordPlayed(game)
      const q = `id=${encodeURIComponent(game.id)}&core=${encodeURIComponent(game.core)}&name=${encodeURIComponent(
        game.name || ''
      )}&label=${encodeURIComponent(game.label || '')}${game.cover_v ? `&coverv=${game.cover_v}` : ''}`
      // A `slot` launches into that snapshot; without one it's a plain boot on the
      // game's own in-game (battery) save. Play with no slot is deliberately the default
      // — restoring an older snapshot would roll the battery save back to whenever it
      // was taken, the exact way you lose an afternoon.
      navigate(`/play?${q}${slot ? `&slot=${encodeURIComponent(slot)}` : ''}`)
    },
    [navigate]
  )

  const openSystem = useCallback((label) => {
    setSystem(label)
    setCollectionTag(null) // a system and a collection are mutually exclusive views
    setRow(0)
    setScreen('games')
  }, [])

  // Open a collection as the full letter-railed list (the 'games' screen, in collection
  // dress). Clears the system for the same reason openSystem clears the collection.
  const openCollection = useCallback((tag) => {
    setCollectionTag(tag)
    setSystem(null)
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
    setFavorited(isFavorite(game.id))
    setScreen('detail')
  }
  const closeDetail = () => {
    setConfirm(null)
    setLightbox(null)
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
    if (rail.kind === 'system') {
      if (item.count > 0) openSystem(item.label)
    } else if (item.seeAll) {
      openCollection(item.tag)
    } else if (rail.id === 'jump') {
      play(item)
    } else openDetail(item, 'shelf')
  }

  const toggleFav = () => detailGame && setFavorited(toggleFavorite(detailGame).favorited)

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
  const KB_MAX = { tag: TAG_MAXLEN, saveLabel: TAG_MAXLEN, saveNote: NOTE_MAXLEN }
  const openKeyboard = (target) => {
    const seed =
      target === 'saveLabel' ? saveEditor?.label || '' : target === 'saveNote' ? saveEditor?.note || '' : ''
    setKeyboard({ target, text: seed, shift: false, pos: { r: 0, c: 0 }, max: KB_MAX[target] ?? 40 })
  }
  const commitKeyboard = () => {
    const kb = keyboard
    setKeyboard(null)
    if (!kb) return
    if (kb.target === 'tag') addGameTag(kb.text)
    else if (kb.target === 'saveLabel') editSaveField({ label: kb.text })
    else if (kb.target === 'saveNote') editSaveField({ note: kb.text })
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

  // The "Wrong game?" picker. Its option list is the candidate games, then a "Clear"
  // option when the game is currently matched (so a wrong match can return to the
  // basic page). The index navigates over exactly this list.
  const rematchOptions = (r) =>
    r
      ? [
          ...(r.candidates || []).map((c) => ({ type: 'game', ...c })),
          ...(r.matched ? [{ type: 'clear' }] : []),
        ]
      : []
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
      setRematch({ candidates: cands, current: d.current ?? null, matched, hack: isHack, index: cands.length ? 0 : -1 })
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

  // Keep the game-page focus valid as its zones change: a save-list delete shrinks
  // the list, and meta arriving (or a game switch) adds/removes the screenshot strip.
  // Clamp the index and, when a zone empties, hand the cursor to the nearest one above.
  useEffect(() => {
    setDetailFocus((f) => {
      if (f.zone === 'actions') return f
      if (f.zone === 'tags') return { zone: 'tags', index: 0 } // always present, single target
      // The hero / base / fix controls are single targets; if they went away, fall to actions.
      if (f.zone === 'hero') return shots.length ? { zone: 'hero', index: 0 } : { zone: 'actions', index: 0 }
      if (f.zone === 'base') return detailBaseId ? { zone: 'base', index: 0 } : { zone: 'actions', index: 0 }
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
  }, [saves, shots.length, detailBaseId, canRematch, similar.length])

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

    // The "Wrong game?" picker traps input too: up/down move the highlight, A picks
    // (re-match / clear), B cancels.
    if (screen === 'detail' && rematch) {
      const opts = rematchOptions(rematch)
      // index -1 is the "It's a ROM hack" toggle above the candidate list.
      if (action === 'up') setRematch((r) => ({ ...r, index: Math.max(-1, r.index - 1) }))
      else if (action === 'down') setRematch((r) => ({ ...r, index: Math.min(opts.length - 1, r.index + 1) }))
      else if (action === 'confirm') {
        if (rematch.index < 0) {
          setRematch((r) => ({ ...r, hack: !r.hack })) // toggle hack mode
        } else {
          const o = opts[rematch.index]
          // A hack borrows the chosen candidate's art but keeps its own name; 'clear'
          // (use the basic page) is never a hack.
          if (o) applyMatch(o.type === 'clear' ? null : o.id, o.type === 'clear' ? false : rematch.hack, o.name)
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
      screen === 'settings' ? closeSettings() : openSettings()
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
      // The results zone shows game matches while you're typing, and your recent
      // searches when the query is empty — the same cursor/zone machinery drives both.
      const searchRows = query ? results.length : recentSearches.length
      const pickSearchRow = () => {
        if (query) {
          if (results[resultRow]) openFromSearch(results[resultRow])
        } else {
          const r = recentSearches[resultRow]
          if (r) applyRecentQuery(r.q)
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

    // Settings: two focus rows, up/down between them. On the IGDB card A re-scans; on
    // the input-mode row A and left/right cycle Auto → Touch → Pad. B closes.
    if (screen === 'settings') {
      const rows = ['igdb', 'inputMode', 'sound']
      const idx = rows.indexOf(settingsFocus)
      const modes = ['auto', 'touch', 'pad']
      const cycleMode = (dir) =>
        setInputMode(modes[(modes.indexOf(inputMode) + dir + modes.length) % modes.length])
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
          else setNavSfx(!navSfx)
          return
        case 'left':
          if (settingsFocus === 'inputMode') cycleMode(-1)
          else if (settingsFocus === 'sound') setNavSfx(false)
          return
        case 'right':
          if (settingsFocus === 'inputMode') cycleMode(1)
          else if (settingsFocus === 'sound') setNavSfx(true)
          return
        default:
      }
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
          } else if (f.zone === 'fix') {
            openRematch()
          } else if (f.zone === 'actions') {
            if (f.index === 0) play(detailGame)
            else if (f.index === 1) toggleFav()
            else if (f.index === 2) startOrRemoveDownload()
            else toggleFinished()
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
          else if (f.zone === 'similar') setDetailFocus((p) => ({ zone: 'similar', index: Math.max(0, p.index - 1) }))
          return
        case 'right':
          if (f.zone === 'hero') setHeroSlide((i) => (i + 1) % shots.length)
          else if (f.zone === 'actions') setDetailFocus((p) => ({ zone: 'actions', index: Math.min(3, p.index + 1) }))
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

  useGamepad({
    onAction: (a) => act.current(a),
    // Any button on a sleeping pad is how we learn a controller exists at all — iOS
    // never fires `gamepadconnected` until then. On the boot screen that press is
    // also the "press A" that dismisses it.
    onPadButton: () => {
      setMode((m) => nextFrogMode(m, 'pad'))
      setScreen((s) => (s === 'boot' ? 'shelf' : s))
    },
    onMenuAction: (a) => {
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
  // controller driving it. The mirror of the pad-button flip above.
  useEffect(() => {
    const onPointer = (e) => {
      if (e.pointerType === 'touch') setMode((m) => nextFrogMode(m, 'touch'))
    }
    window.addEventListener('pointerdown', onPointer)
    return () => window.removeEventListener('pointerdown', onPointer)
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
      className="frog-root fixed inset-0 z-50 flex flex-col overflow-hidden"
      style={{
        // Feed the palette token to the CSS ground rule, so the default background stays
        // single-sourced from FROG.ground while the phone media query overrides to #000.
        '--frog-ground': FROG.ground,
        paddingTop: 'env(safe-area-inset-top)',
        paddingLeft: 'env(safe-area-inset-left)',
        paddingRight: 'env(safe-area-inset-right)',
        // The root carries the bottom inset so the last row of games/results always
        // clears the iOS home indicator — the legend used to be the only thing padding
        // the bottom, and it's hidden in touch mode, which is exactly where the inset
        // is nonzero.
        paddingBottom: 'env(safe-area-inset-bottom)',
      }}
    >
      {/* Ambient caustics — the pond's own slow shimmer, only at rest on the shelf
          (a game list or the player wants a still ground). Sits under the pond light. */}
      {screen === 'shelf' && (
        <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden="true">
          <div
            className="frog-caustic frog-caustic-a"
            style={{ background: `radial-gradient(38% 38% at 32% 42%, rgba(${FROG.jade}, 0.06), transparent 70%)` }}
          />
          <div
            className="frog-caustic frog-caustic-b"
            style={{ background: `radial-gradient(44% 44% at 70% 62%, rgba(${FROG.jade}, 0.05), transparent 70%)` }}
          />
        </div>
      )}

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
        {screen === 'games' && collectionTag ? (
          <CollectionListHeader tag={collectionTag} count={games.length} loading={!collectionsLoaded} />
        ) : screen === 'games' && system ? (
          <GameListHeader system={system} count={games.length} />
        ) : (
          <div className="flex min-w-0 items-center gap-2">
            <FrogMark size={22} className="shrink-0" style={{ color: `rgb(${FROG.jade})` }} />
            <span className="truncate text-sm font-semibold tracking-[0.16em]" style={{ color: FROG.ink }}>
              FROG GAME STATION
              {/* The section is redundant with the screen itself, so it only rides along
                  where there's room — hidden on a phone so the name never truncates. */}
              {(screen === 'search' || screen === 'settings') && (
                <span className="hidden sm:inline">
                  {screen === 'search' ? ' · SEARCH' : ' · SETTINGS'}
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
              style={{ background: 'rgba(251, 191, 36, 0.12)', color: 'rgb(251, 191, 36)' }}
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

          {/* Settings — a header entry point (there's no dedicated pad button for it,
              so the gear is how both thumb and cursor reach it). Hidden on the overlay
              screens that own the ✕. */}
          {screen !== 'search' && screen !== 'detail' && screen !== 'settings' && (
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
          onPick={(game, ch) => (ch != null ? typeKey(ch) : openFromSearch(game))}
          recent={recentSearches}
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
        />
      ) : screen === 'detail' && detailGame ? (
        <GameScreen
          game={detailGame}
          meta={meta}
          native={native}
          favorited={favorited}
          saves={saves}
          loadingSaves={savesLoading}
          similar={similar}
          playMs={playStatsById.get(detailGame.id)?.play_ms}
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
          onConfirmYes={confirmYes}
          onConfirmNo={() => setConfirm(null)}
        />
      ) : screen === 'games' ? (
        <GameList
          system={system}
          collection={collectionTag}
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
          onFocus={(rail, index) => setFocus({ rail, index })}
          onPick={pickShelfItem}
        />
      )}

      {/* The controller legend. Meaningless without a controller, so it's hidden in
          touch mode — the tappable tiles, the header search/close, and tap-to-play
          are self-evident to a thumb. It returns the instant a pad button is pressed. */}
      {!native && (
      <ButtonLegend
        className="relative py-3"
        style={{
          borderTop: `1px solid ${FROG.line}`,
          // The root now owns the safe-area inset, so the legend only needs its own
          // breathing room above it (no double inset).
          paddingBottom: '0.75rem',
        }}
        hints={
          screen === 'search'
            ? zone === 'grid'
              ? [
                  { button: 'A', label: 'Type' },
                  { button: 'B', label: query ? 'Delete' : 'Close' },
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
                : screen === 'games'
                  ? [
                      { button: 'A', label: 'Open' },
                      { button: 'B', label: 'Shelf' },
                      { button: 'X', label: 'Find' },
                      { button: 'LT/RT', label: 'Letter' },
                      { button: 'R3', label: 'Random' },
                      { button: '☰', label: 'Hold: Settings' },
                    ]
                  : [
                      { button: 'A', label: 'Open' },
                      { button: 'X', label: 'Find' },
                      { button: 'D-pad', label: 'Move' },
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

