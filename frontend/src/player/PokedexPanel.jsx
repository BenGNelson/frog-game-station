import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react'
import { ArrowLeft, X, BookOpen, Loader2, Globe, ChevronRight, LayoutGrid, List } from 'lucide-react'
import { FROG, scrim } from '../frog/theme.js'
import { moveInGrid } from '../lib/gridNav.js'
import { fetchPokedexInfo, fetchPokedexList, fetchPokemon } from '../lib/pokedexApi.js'
import { typeColor, statPercent, statTotal, filterDex, stepDexBlock, dexScrollStep, STAT_LABELS, STAT_ORDER } from '../lib/pokedex.js'
import { getPokedexLast, setPokedexLast } from '../lib/pokedexLast.js'
import { usesNativeKeyboard } from '../frog/input.js'
import { applyKey, keyAt, moveKey, deleteChar } from '../lib/keyboard.js'
import Keyboard from '../frog/Keyboard.jsx'
import '../frog/frog.css'

const SCROLL_STEP = 96
// A held up/down counts as the SAME run while repeats keep arriving inside this window
// (the fast stick repeat is ~30ms, a steady d-pad ~110ms; a deliberate re-tap is slower),
// so the accelerator ramps only while a direction is genuinely held.
const ACCEL_WINDOW = 260
const ROW_PX = 48 // a dex row's approximate height, for the LB/RB page jump
// The cover-grid layout: a fixed column count so the pad's index math (moveInGrid, row
// jumps) is exact, and a taller row for the sprite tile's LB/RB page step.
const GRID_COLS = 4
const GRID_ROW_PX = 92
const DEX_SEARCH_MAX = 30 // plenty for a species name; caps the on-screen keyboard draft

// The in-game Pokédex reference (Pokémon games only). Structured data from PokeAPI —
// types, base stats, evolution chains — rendered in OUR page, so it's controller/touch-
// navigable and FROG-skinned. Mirrors WikiPanel's shell: forwardRef + imperative surface,
// MOUNTED-PERSISTENT (hidden via display:none, keeps the browsed list + selection + scroll
// across close/reopen), load-once, focus-on-open + Escape stopPropagation. Two views: a
// numbered dex LIST and a per-Pokémon DETAIL. `onReadWiki(title)` deep-links to Bulbapedia.
const PokedexPanel = forwardRef(function PokedexPanel({
  open, gameId, gameName, mode = 'pad', accent = FROG.jade, onClose, onReadWiki, legend = null,
}, ref) {
  const [phase, setPhase] = useState('idle') // idle|loading|list|error
  const [view, setView] = useState('list') // list|detail
  const [layout, setLayout] = useState('list') // list|grid (the cover-grid toggle)
  const [scope, setScope] = useState(null) // current dex slug
  const [regionScope, setRegionScope] = useState(null) // the game's region (for the toggle)
  const [list, setList] = useState([])
  const [query, setQuery] = useState('')
  const [cursor, setCursor] = useState(0) // index into the FILTERED list
  const [detail, setDetail] = useState(null) // the selected Pokémon DTO
  const [detailBusy, setDetailBusy] = useState(false)
  // The on-screen keyboard for search-while-browsing on a pad ({text,shift,pos} while up;
  // null when closed). Touch never opens it — a finger types into the native field.
  const [keyboard, setKeyboard] = useState(null)

  const loadedRef = useRef(false)
  const scrollerRef = useRef(null)
  const detailScrollerRef = useRef(null)
  // A cross-link into a species (openTo) can fire WHILE the initial list is still loading;
  // this tells the in-flight loadList not to clobber the detail view with 'list' when it
  // lands. Only set while a load is pending, so a later scope-toggle load isn't affected.
  const wantDetailRef = useRef(null)
  // Tracks a held up/down run so the cursor accelerates the longer it's held (see heldStep).
  const runRef = useRef({ action: null, ts: 0, run: 0 })

  const filtered = filterDex(list, query)
  const accentText = `rgb(${accent})`
  const canToggle = regionScope && regionScope !== 'national'
  const native = usesNativeKeyboard(mode) // touch types into the native field, not the board
  const cols = layout === 'grid' ? GRID_COLS : 1

  // `preferredId` restores the cursor to a national dex number (last-viewed) when present
  // in the freshly loaded list; otherwise the list opens at the top. Only the INITIAL load
  // passes one — the region↔national toggle keeps you at the top of the new scope.
  const loadList = useCallback(async (slug, preferredId = null) => {
    setPhase('loading')
    try {
      const { pokemon } = await fetchPokedexList(slug)
      const arr = pokemon || []
      setList(arr)
      setScope(slug)
      setQuery('')
      const at = preferredId != null ? arr.findIndex((p) => p.id === preferredId) : -1
      setCursor(at >= 0 ? at : 0)
      // A cross-link jump (openTo) that raced this load owns the view — don't force 'list'
      // over the species detail it opened; just mark the list ready underneath.
      if (wantDetailRef.current != null) wantDetailRef.current = null
      else setView('list')
      setPhase('list')
    } catch {
      setPhase('error')
    }
  }, [])

  const loadInitial = useCallback(async () => {
    setPhase('loading')
    try {
      const info = await fetchPokedexInfo(gameId, gameName)
      const slug = info?.scope || 'national'
      setRegionScope(slug)
      await loadList(slug, getPokedexLast(gameId))
    } catch {
      setPhase('error')
    }
  }, [gameId, gameName, loadList])

  useEffect(() => {
    if (open && !loadedRef.current) {
      loadedRef.current = true
      loadInitial()
    }
  }, [open, loadInitial])

  // Take keyboard focus on open (the panel sits over a paused game with the pause menu
  // still focused underneath) — same reason as the wiki reader. Focuses the ACTIVE view's
  // scroller (also on a view switch), so reopening in detail keeps Escape/scroll working
  // (the list scroller is display:none in detail view and can't hold focus).
  useEffect(() => {
    if (open) (view === 'detail' ? detailScrollerRef : scrollerRef).current?.focus()
  }, [open, view])

  // Keep the focused dex row on screen as the controller cursor walks it.
  useEffect(() => {
    if (view === 'list') {
      scrollerRef.current?.querySelector('[data-focused="true"]')?.scrollIntoView({ block: 'nearest' })
    }
  }, [cursor, view, query, layout])

  const openDetail = useCallback(async (num) => {
    setPokedexLast(gameId, num) // remember it for the next time this game's dex opens
    setView('detail')
    setDetail(null)
    setDetailBusy(true)
    try {
      setDetail(await fetchPokemon(num))
    } catch {
      setDetail(null)
    } finally {
      setDetailBusy(false)
      if (detailScrollerRef.current) detailScrollerRef.current.scrollTop = 0
    }
  }, [gameId])

  const toList = useCallback(() => {
    setView('list') // the [open, view] focus effect refocuses the list scroller
    setTimeout(() => scrollerRef.current?.focus(), 0)
  }, [])

  const toggleScope = useCallback(() => {
    if (!canToggle) return
    loadList(scope === 'national' ? regionScope : 'national')
  }, [canToggle, scope, regionScope, loadList])

  const moveCursor = useCallback((action) => {
    setCursor((i) => moveInGrid({ count: filtered.length, cols, index: i }, action))
  }, [filtered.length, cols])

  // The on-screen keyboard, seeded from the live query so it opens on what you've typed —
  // and every keystroke updates the query, so the list filters WHILE you browse the board.
  const openKeyboard = useCallback(() => {
    setKeyboard((k) => k || { text: query, shift: false, pos: { r: 0, c: 0 } })
  }, [query])

  const applyQuery = useCallback((text) => { setQuery(text); setCursor(0) }, [])

  const pressKey = useCallback((r, c) => {
    if (!keyboard) return
    const next = applyKey(keyboard, keyAt({ r, c }), { maxLen: DEX_SEARCH_MAX })
    if (next.done) { setKeyboard(null); return } // Done closes the board; the query stays applied
    applyQuery(next.text) // filter the list live as the board types
    setKeyboard({ text: next.text, shift: next.shift, pos: { r, c } })
  }, [keyboard, applyQuery])

  // Move the list cursor by a signed row delta, clamped to the (filtered) list.
  const moveBy = useCallback((delta) => {
    setCursor((i) => Math.max(0, Math.min(filtered.length - 1, i + delta)))
  }, [filtered.length])

  // Grow the per-tick step the longer up/down is held (velocity-scaled repeats arrive
  // rapidly, a re-tap doesn't) so a long dex flies past — the "faster analog scroll".
  const heldStep = useCallback((action) => {
    const now = typeof performance !== 'undefined' ? performance.now() : Date.now()
    const r = runRef.current
    r.run = r.action === action && now - r.ts < ACCEL_WINDOW ? r.run + 1 : 1
    r.action = action
    r.ts = now
    return dexScrollStep(r.run)
  }, [])

  // The controller surface PlayerShell drives while the panel owns the pad. Returns false
  // ONLY to ask PlayerShell to close (Back at the list root); true otherwise.
  useImperativeHandle(ref, () => ({
    handleAction(action) {
      // The on-screen keyboard traps the pad while it's up: the d-pad walks the board, A
      // presses the lit key, B peels a character (empty → close back to the list).
      if (keyboard) {
        if (action === 'up' || action === 'down' || action === 'left' || action === 'right') {
          setKeyboard((k) => (k ? { ...k, pos: moveKey(k.pos, action) } : k))
        } else if (action === 'confirm') {
          pressKey(keyboard.pos.r, keyboard.pos.c)
        } else if (action === 'back') {
          if (keyboard.text) { const d = deleteChar(keyboard); applyQuery(d.text); setKeyboard(d) }
          else setKeyboard(null)
        }
        return true
      }
      if (view === 'detail') {
        const s = detailScrollerRef.current
        if (action === 'up') s?.scrollBy({ top: -SCROLL_STEP })
        else if (action === 'down') s?.scrollBy({ top: SCROLL_STEP })
        else if (action === 'railPrev' || action === 'jumpPrev') s?.scrollBy({ top: -(s.clientHeight * 0.85) })
        else if (action === 'railNext' || action === 'jumpNext') s?.scrollBy({ top: s.clientHeight * 0.85 })
        else if (action === 'confirm') { if (detail && onReadWiki) onReadWiki(detail.bulbapedia_title) }
        else if (action === 'back') toList()
        return true
      }
      // list view. up/down accelerate while held (by a whole row = ±cols in the grid);
      // left/right step within a row (inert in the 1-col list); LT/RT jump a dex decade;
      // LB/RB page; X opens the search keyboard; RS toggles the cover-grid.
      if (action === 'up' || action === 'down') {
        const step = heldStep(action)
        moveBy((action === 'up' ? -step : step) * cols)
        return true
      }
      if (action === 'left' || action === 'right') { moveCursor(action); return true }
      if (action === 'jumpPrev' || action === 'jumpNext') {
        setCursor((i) => stepDexBlock(filtered, i, action === 'jumpNext' ? 1 : -1))
        return true
      }
      if (action === 'railPrev' || action === 'railNext') {
        const rowPx = layout === 'grid' ? GRID_ROW_PX : ROW_PX
        const rows = Math.max(3, Math.floor((scrollerRef.current?.clientHeight || 400) / rowPx))
        moveBy((action === 'railNext' ? rows : -rows) * cols)
        return true
      }
      if (action === 'confirm') {
        const p = filtered[cursor]
        if (p) openDetail(p.id)
        return true
      }
      if (action === 'search') { if (phase === 'list') openKeyboard(); return true } // X — type to filter (list ready only)
      // RS is the one spare forwarded action here (no "surprise me" in the dex) — reuse it
      // to flip list ⇄ grid, matching the header toggle a finger taps.
      if (action === 'random') { setLayout((l) => (l === 'grid' ? 'list' : 'grid')); return true }
      if (action === 'alt') { toggleScope(); return true } // Y toggles region/national
      if (action === 'back') return false // close
      return true
    },
    // Jump straight to a species' detail — the wiki reader hands us a national-dex number
    // when a walkthrough '…(Pokémon)' link is followed (the reverse of the detail view's
    // Read-on-Bulbapedia deep-link). If the list is still loading (the common cross-link
    // case — the panel opens and the species resolves concurrently), flag it so the pending
    // loadList won't overwrite the detail view when it finishes.
    openTo(num) {
      if (phase !== 'list') wantDetailRef.current = num
      openDetail(num)
    },
  }), [view, phase, layout, cols, keyboard, filtered, cursor, detail, onReadWiki, moveCursor, moveBy, heldStep,
       openDetail, toList, toggleScope, openKeyboard, pressKey, applyQuery])

  const onKeyDown = useCallback((e) => {
    if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      if (keyboard) setKeyboard(null) // close the on-screen board first
      else if (view === 'detail') toList()
      else onClose()
    }
  }, [keyboard, view, toList, onClose])

  const readWiki = () => { if (detail && onReadWiki) onReadWiki(detail.bulbapedia_title) }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Pokédex"
      onKeyDown={onKeyDown}
      className="absolute inset-0 z-30 flex flex-col outline-none"
      style={{
        display: open ? 'flex' : 'none',
        background: scrim(0.96),
        backdropFilter: 'blur(10px)',
        paddingLeft: 'env(safe-area-inset-left)',
        paddingRight: 'env(safe-area-inset-right)',
        paddingBottom: 'env(safe-area-inset-bottom)',
      }}
    >
      {/* Header */}
      <div className="flex shrink-0 items-center gap-2 border-b px-3 py-2"
           style={{ borderColor: 'rgba(255,255,255,0.06)', marginTop: 'env(safe-area-inset-top)' }}>
        {view === 'detail' ? (
          <button onClick={toList} aria-label="Back to list"
                  className="flex items-center rounded-lg px-2.5 py-1.5 text-sm active:opacity-70"
                  style={{ background: FROG.panel, color: FROG.ink }}>
            <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          </button>
        ) : (
          <span className="flex items-center gap-1.5 px-1 text-sm font-semibold" style={{ color: accentText }}>
            <BookOpen className="h-4 w-4" aria-hidden="true" /> Pokédex
          </span>
        )}

        <div className="min-w-0 flex-1 text-center">
          <p className="truncate text-sm font-semibold" style={{ color: FROG.ink }}>
            {view === 'detail' ? (detail?.display || 'Pokémon') : scopeLabel(scope)}
          </p>
          {view === 'detail' && detail ? (
            <p className="text-[11px]" style={{ color: FROG.faint }}>#{String(detail.id).padStart(3, '0')}</p>
          ) : (
            view === 'list' && list.length > 0 && (
              <p className="text-[11px]" style={{ color: FROG.faint }}>{list.length} Pokémon</p>
            )
          )}
        </div>

        {view === 'list' && (
          <button onClick={() => setLayout((l) => (l === 'grid' ? 'list' : 'grid'))}
                  aria-label={layout === 'grid' ? 'Show the list view' : 'Show the cover grid'}
                  className="flex items-center rounded-lg px-2.5 py-1.5 text-sm active:opacity-70"
                  style={{ background: FROG.panel, color: FROG.soft }}>
            {layout === 'grid'
              ? <List className="h-4 w-4" aria-hidden="true" />
              : <LayoutGrid className="h-4 w-4" aria-hidden="true" />}
          </button>
        )}
        {view === 'list' && canToggle && (
          <button onClick={toggleScope}
                  aria-label={scope === 'national' ? `Show ${scopeLabel(regionScope)} dex` : 'Show all Pokémon'}
                  className="flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs active:opacity-70"
                  style={{ background: FROG.panel, color: FROG.soft }}>
            <Globe className="h-3.5 w-3.5" aria-hidden="true" />
            {scope === 'national' ? scopeLabel(regionScope) : 'All'}
          </button>
        )}
        <button onClick={onClose} aria-label="Close Pokédex"
                className="flex items-center rounded-lg px-2.5 py-1.5 text-sm active:opacity-70"
                style={{ background: FROG.panel, color: FROG.ink }}>
          <X className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>

      {/* Search (list only). A finger taps the native field; a pad presses X to raise the
          on-screen keyboard (rendered below), so the placeholder hints that on a pad. */}
      {view === 'list' && phase === 'list' && (
        <div className="shrink-0 px-3 py-2">
          <input
            value={query}
            onChange={(e) => { applyQuery(e.target.value) }}
            placeholder={native ? 'Search…' : 'Search…  (press X)'}
            className="w-full rounded-lg px-3 py-1.5 text-sm outline-none"
            style={{ background: FROG.panel, color: FROG.ink }}
          />
        </div>
      )}

      {/* Body */}
      <div ref={scrollerRef} tabIndex={-1}
           className="min-h-0 flex-1 touch-auto overflow-y-auto overscroll-contain outline-none"
           style={{ display: view === 'list' ? 'block' : 'none' }}>
        {phase === 'loading' && <Centered><Spinner /> Loading…</Centered>}
        {phase === 'error' && <Centered><BookOpen className="mb-2 h-8 w-8 opacity-40" aria-hidden="true" />Couldn’t load the Pokédex.</Centered>}
        {phase === 'list' && layout === 'list' && (
          <ul className="mx-auto max-w-2xl px-2 py-1">
            {filtered.map((p, i) => (
              <DexRow key={p.id} p={p} focused={i === cursor}
                      onFocus={() => setCursor(i)} onOpen={() => openDetail(p.id)} />
            ))}
            {!filtered.length && <li className="px-3 py-6 text-center text-sm" style={{ color: FROG.faint }}>No matches.</li>}
          </ul>
        )}
        {phase === 'list' && layout === 'grid' && (
          filtered.length ? (
            <ul className="mx-auto grid max-w-2xl gap-2 px-3 py-2"
                style={{ gridTemplateColumns: `repeat(${GRID_COLS}, minmax(0, 1fr))` }}>
              {filtered.map((p, i) => (
                <DexTile key={p.id} p={p} focused={i === cursor}
                         onFocus={() => setCursor(i)} onOpen={() => openDetail(p.id)} />
              ))}
            </ul>
          ) : (
            <p className="px-3 py-6 text-center text-sm" style={{ color: FROG.faint }}>No matches.</p>
          )
        )}
      </div>

      {/* Detail */}
      <div ref={detailScrollerRef} tabIndex={-1}
           className="min-h-0 flex-1 touch-auto overflow-y-auto overscroll-contain outline-none"
           style={{ display: view === 'detail' ? 'block' : 'none' }}>
        {detailBusy && <Centered><Spinner /> Loading…</Centered>}
        {!detailBusy && !detail && <Centered><BookOpen className="mb-2 h-8 w-8 opacity-40" aria-hidden="true" />Couldn’t load that Pokémon.</Centered>}
        {!detailBusy && detail && (
          <Detail p={detail} accentText={accentText} onReadWiki={readWiki} onSelect={openDetail} />
        )}
      </div>

      {legend && <div className="shrink-0 px-3 py-2">{legend}</div>}

      {/* The on-screen keyboard for search-while-browsing on a pad — a full-screen z-40
          overlay, so it covers the list (and the native field) while it's up. Only over a
          ready list (search is meaningless mid-load, and loadList clears the query). */}
      {keyboard && phase === 'list' && (
        <Keyboard
          title="Search the Pokédex"
          text={keyboard.text}
          placeholder="Type a name"
          pos={keyboard.pos}
          shift={keyboard.shift}
          accent={accent}
          onHover={(r, c) => setKeyboard((k) => (k ? { ...k, pos: { r, c } } : k))}
          onPress={pressKey}
          onClose={() => setKeyboard(null)}
        />
      )}
    </div>
  )
})

export default PokedexPanel

function DexRow({ p, focused, onFocus, onOpen }) {
  return (
    <li>
      <button
        data-focused={focused || undefined}
        onMouseMove={onFocus}
        onClick={onOpen}
        className="flex w-full items-center gap-3 rounded-lg px-3 py-1.5 text-left transition-colors"
        style={{
          background: focused ? `rgba(${FROG.jade}, 0.14)` : 'transparent',
          boxShadow: focused ? `0 0 0 2px rgba(${FROG.jade}, 0.5)` : 'none',
        }}
      >
        <span className="w-10 shrink-0 text-right text-xs tabular-nums" style={{ color: FROG.faint }}>
          #{String(p.number ?? p.id).padStart(3, '0')}
        </span>
        <img src={p.sprite} alt="" loading="lazy" className="h-10 w-10 shrink-0" style={{ imageRendering: 'pixelated' }} />
        <span className="truncate text-sm font-medium" style={{ color: FROG.ink }}>{p.display}</span>
      </button>
    </li>
  )
}

// A cover-grid tile — the same row data, laid out as a sprite over its number + name. The
// shared data-focused + scrollIntoView keeps the pad cursor on screen exactly as the list.
function DexTile({ p, focused, onFocus, onOpen }) {
  return (
    <li>
      <button
        data-focused={focused || undefined}
        onMouseMove={onFocus}
        onClick={onOpen}
        className="flex w-full flex-col items-center gap-0.5 rounded-lg px-1 py-2 transition-colors"
        style={{
          background: focused ? `rgba(${FROG.jade}, 0.14)` : 'transparent',
          boxShadow: focused ? `0 0 0 2px rgba(${FROG.jade}, 0.5)` : 'none',
        }}
      >
        <img src={p.sprite} alt="" loading="lazy" className="h-14 w-14" style={{ imageRendering: 'pixelated' }} />
        <span className="text-[10px] tabular-nums" style={{ color: FROG.faint }}>
          #{String(p.number ?? p.id).padStart(3, '0')}
        </span>
        <span className="w-full truncate text-center text-xs font-medium" style={{ color: FROG.ink }}>{p.display}</span>
      </button>
    </li>
  )
}

// One node in the evolution chain — a larger sprite, its types, tappable to jump to it.
function EvoNode({ s, current, accentText, onSelect }) {
  return (
    <button
      onClick={onSelect}
      disabled={current}
      className="flex flex-col items-center gap-0.5 rounded-lg px-1.5 py-1 transition-colors disabled:cursor-default"
      style={{ background: current ? `rgba(${FROG.jade}, 0.12)` : 'transparent' }}
    >
      <img src={s.sprite} alt="" loading="lazy" className="h-16 w-16" style={{ imageRendering: 'pixelated' }} />
      <span className="text-[11px] font-medium" style={{ color: current ? accentText : FROG.soft }}>{s.display}</span>
      {s.types && s.types.length > 0 && (
        <span className="flex gap-0.5">
          {s.types.map((t) => (
            <span key={t} className="rounded px-1 py-px text-[8px] font-semibold capitalize text-black"
                  style={{ background: typeColor(t) }}>{t}</span>
          ))}
        </span>
      )}
    </button>
  )
}

function Detail({ p, accentText, onReadWiki, onSelect }) {
  return (
    <div className="mx-auto max-w-2xl px-4 py-4">
      {/* Hero: artwork + types */}
      <div className="flex flex-col items-center gap-2">
        <img src={p.artwork} alt={p.display} className="h-40 w-40 object-contain" />
        {p.genus && <p className="text-xs" style={{ color: FROG.faint }}>{p.genus}</p>}
        <div className="flex flex-wrap justify-center gap-1.5">
          {(p.types || []).map((t) => (
            <span key={t} className="rounded-full px-2.5 py-0.5 text-xs font-semibold capitalize text-black"
                  style={{ background: typeColor(t) }}>{t}</span>
          ))}
        </div>
      </div>

      {p.flavor && (
        <p className="mx-auto mt-3 max-w-md text-center text-sm leading-relaxed" style={{ color: FROG.soft }}>
          {p.flavor}
        </p>
      )}

      {/* Base stats — with a total */}
      <div className="mb-2 mt-5 flex items-baseline justify-between">
        <h3 className="text-xs font-medium uppercase tracking-wide" style={{ color: FROG.faint }}>Base stats</h3>
        {statTotal(p.stats) > 0 && (
          <span className="text-[11px]" style={{ color: FROG.faint }}>
            Total <span className="tabular-nums" style={{ color: FROG.soft }}>{statTotal(p.stats)}</span>
          </span>
        )}
      </div>
      <div className="space-y-1.5">
        {STAT_ORDER.filter((k) => p.stats?.[k] != null).map((k) => (
          <div key={k} className="flex items-center gap-2">
            <span className="w-9 shrink-0 text-[11px] font-medium" style={{ color: FROG.soft }}>{STAT_LABELS[k]}</span>
            <span className="w-8 shrink-0 text-right text-xs tabular-nums" style={{ color: FROG.ink }}>{p.stats[k]}</span>
            <div className="h-2.5 flex-1 overflow-hidden rounded-full" style={{ background: 'rgba(255,255,255,0.08)' }}>
              <div className="h-full rounded-full transition-[width]" style={{ width: `${statPercent(p.stats[k])}%`, background: accentText }} />
            </div>
          </div>
        ))}
      </div>

      {/* Evolution chain — larger, typed, and clickable (tap to jump to that Pokémon) */}
      {p.evolutions && p.evolutions.length > 1 && (
        <>
          <h3 className="mb-2 mt-5 text-xs font-medium uppercase tracking-wide" style={{ color: FROG.faint }}>Evolutions</h3>
          <div className="flex items-stretch justify-center gap-1.5 overflow-x-auto pb-1">
            {p.evolutions.map((stage, si) => (
              <div key={si} className="flex items-center gap-1.5">
                {si > 0 && <ChevronRight className="h-5 w-5 shrink-0" style={{ color: FROG.faint }} aria-hidden="true" />}
                <div className="flex flex-col gap-2">
                  {stage.map((s) => (
                    <EvoNode key={s.id} s={s} current={s.id === p.id} accentText={accentText}
                             onSelect={() => s.id !== p.id && onSelect?.(s.id)} />
                  ))}
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {/* Physical + wiki */}
      <div className="mt-4 flex items-center justify-center gap-4 text-xs" style={{ color: FROG.faint }}>
        {p.height != null && <span>{(p.height / 10).toFixed(1)} m</span>}
        {p.weight != null && <span>{(p.weight / 10).toFixed(1)} kg</span>}
      </div>
      {onReadWiki && (
        <button onClick={onReadWiki}
                className="mx-auto mt-4 flex items-center gap-1.5 rounded-lg px-4 py-2 text-sm active:opacity-70"
                style={{ background: FROG.panel, color: FROG.ink }}>
          <BookOpen className="h-4 w-4" aria-hidden="true" /> Read on Bulbapedia
        </button>
      )}
    </div>
  )
}

// A dex slug -> a display label ('original-johto' -> 'Johto', 'national' -> 'National').
function scopeLabel(slug) {
  if (!slug) return 'Pokédex'
  if (slug === 'national') return 'National'
  return slug.replace(/^(original|updated|extended)-/, '').replace(/-/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase())
}

function Centered({ children }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 px-8 text-center text-sm"
         style={{ color: FROG.soft }}>
      {children}
    </div>
  )
}

function Spinner() {
  return <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" />
}
