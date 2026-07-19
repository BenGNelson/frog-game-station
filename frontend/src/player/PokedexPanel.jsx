import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react'
import { ArrowLeft, X, BookOpen, Loader2, Globe, ChevronRight } from 'lucide-react'
import { FROG } from '../frog/theme.js'
import { moveInGrid } from '../lib/gridNav.js'
import { fetchPokedexInfo, fetchPokedexList, fetchPokemon } from '../lib/pokedexApi.js'
import { typeColor, statPercent, filterDex, STAT_LABELS, STAT_ORDER } from '../lib/pokedex.js'
import '../frog/frog.css'

const SCROLL_STEP = 96

// The in-game Pokédex reference (Pokémon games only). Structured data from PokeAPI —
// types, base stats, evolution chains — rendered in OUR page, so it's controller/touch-
// navigable and FROG-skinned. Mirrors WikiPanel's shell: forwardRef + imperative surface,
// MOUNTED-PERSISTENT (hidden via display:none, keeps the browsed list + selection + scroll
// across close/reopen), load-once, focus-on-open + Escape stopPropagation. Two views: a
// numbered dex LIST and a per-Pokémon DETAIL. `onReadWiki(title)` deep-links to Bulbapedia.
const PokedexPanel = forwardRef(function PokedexPanel({
  open, gameId, gameName, accent = FROG.jade, onClose, onReadWiki, legend = null,
}, ref) {
  const [phase, setPhase] = useState('idle') // idle|loading|list|error
  const [view, setView] = useState('list') // list|detail
  const [scope, setScope] = useState(null) // current dex slug
  const [regionScope, setRegionScope] = useState(null) // the game's region (for the toggle)
  const [list, setList] = useState([])
  const [query, setQuery] = useState('')
  const [cursor, setCursor] = useState(0) // index into the FILTERED list
  const [detail, setDetail] = useState(null) // the selected Pokémon DTO
  const [detailBusy, setDetailBusy] = useState(false)

  const loadedRef = useRef(false)
  const scrollerRef = useRef(null)
  const detailScrollerRef = useRef(null)

  const filtered = filterDex(list, query)
  const accentText = `rgb(${accent})`
  const canToggle = regionScope && regionScope !== 'national'

  const loadList = useCallback(async (slug) => {
    setPhase('loading')
    try {
      const { pokemon } = await fetchPokedexList(slug)
      setList(pokemon || [])
      setScope(slug)
      setQuery('')
      setCursor(0)
      setView('list')
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
      await loadList(slug)
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
  // still focused underneath) — same reason as the wiki reader.
  useEffect(() => {
    if (open) scrollerRef.current?.focus()
  }, [open])

  // Keep the focused dex row on screen as the controller cursor walks it.
  useEffect(() => {
    if (view === 'list') {
      scrollerRef.current?.querySelector('[data-focused="true"]')?.scrollIntoView({ block: 'nearest' })
    }
  }, [cursor, view, query])

  const openDetail = useCallback(async (num) => {
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
  }, [])

  const toList = useCallback(() => {
    setView('list')
    setTimeout(() => scrollerRef.current?.focus(), 0)
  }, [])

  const toggleScope = useCallback(() => {
    if (!canToggle) return
    loadList(scope === 'national' ? regionScope : 'national')
  }, [canToggle, scope, regionScope, loadList])

  const moveCursor = useCallback((action) => {
    setCursor((i) => moveInGrid({ count: filtered.length, cols: 1, index: i }, action))
  }, [filtered.length])

  // The controller surface PlayerShell drives while the panel owns the pad. Returns false
  // ONLY to ask PlayerShell to close (Back at the list root); true otherwise.
  useImperativeHandle(ref, () => ({
    handleAction(action) {
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
      // list view
      if (action === 'up' || action === 'down' || action === 'left' || action === 'right') {
        moveCursor(action)
        return true
      }
      if (action === 'confirm') {
        const p = filtered[cursor]
        if (p) openDetail(p.id)
        return true
      }
      if (action === 'alt') { toggleScope(); return true } // Y toggles region/national
      if (action === 'back') return false // close
      return true
    },
  }), [view, filtered, cursor, detail, onReadWiki, moveCursor, openDetail, toList, toggleScope])

  const onKeyDown = useCallback((e) => {
    if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      if (view === 'detail') toList()
      else onClose()
    }
  }, [view, toList, onClose])

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
        background: 'rgba(5, 17, 13, 0.96)',
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
          {view === 'detail' && detail && (
            <p className="text-[11px]" style={{ color: FROG.faint }}>#{String(detail.id).padStart(3, '0')}</p>
          )}
        </div>

        {view === 'list' && canToggle && (
          <button onClick={toggleScope}
                  className="flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs active:opacity-70"
                  style={{ background: FROG.panel, color: FROG.soft }}>
            <Globe className="h-3.5 w-3.5" aria-hidden="true" />
            {scope === 'national' ? scopeLabel(regionScope) : 'National'}
          </button>
        )}
        <button onClick={onClose} aria-label="Close Pokédex"
                className="flex items-center rounded-lg px-2.5 py-1.5 text-sm active:opacity-70"
                style={{ background: FROG.panel, color: FROG.ink }}>
          <X className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>

      {/* Search (list only) */}
      {view === 'list' && phase === 'list' && (
        <div className="shrink-0 px-3 py-2">
          <input
            value={query}
            onChange={(e) => { setQuery(e.target.value); setCursor(0) }}
            placeholder="Search…"
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
        {phase === 'list' && (
          <ul className="mx-auto max-w-2xl px-2 py-1">
            {filtered.map((p, i) => (
              <DexRow key={p.id} p={p} focused={i === cursor}
                      onFocus={() => setCursor(i)} onOpen={() => openDetail(p.id)} />
            ))}
            {!filtered.length && <li className="px-3 py-6 text-center text-sm" style={{ color: FROG.faint }}>No matches.</li>}
          </ul>
        )}
      </div>

      {/* Detail */}
      <div ref={detailScrollerRef} tabIndex={-1}
           className="min-h-0 flex-1 touch-auto overflow-y-auto overscroll-contain outline-none"
           style={{ display: view === 'detail' ? 'block' : 'none' }}>
        {detailBusy && <Centered><Spinner /> Loading…</Centered>}
        {!detailBusy && !detail && <Centered><BookOpen className="mb-2 h-8 w-8 opacity-40" aria-hidden="true" />Couldn’t load that Pokémon.</Centered>}
        {!detailBusy && detail && (
          <Detail p={detail} accentText={accentText} onReadWiki={readWiki} />
        )}
      </div>

      {legend && <div className="shrink-0 px-3 py-2">{legend}</div>}
    </div>
  )
})

export default PokedexPanel

function DexRow({ p, focused, onFocus, onOpen }) {
  return (
    <li>
      <button
        data-focused={focused || undefined}
        onMouseEnter={onFocus}
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

function Detail({ p, accentText, onReadWiki }) {
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

      {/* Base stats */}
      <h3 className="mb-2 mt-5 text-xs font-medium uppercase tracking-wide" style={{ color: FROG.faint }}>Base stats</h3>
      <div className="space-y-1.5">
        {STAT_ORDER.filter((k) => p.stats?.[k] != null).map((k) => (
          <div key={k} className="flex items-center gap-2">
            <span className="w-9 shrink-0 text-[11px] font-medium" style={{ color: FROG.soft }}>{STAT_LABELS[k]}</span>
            <span className="w-8 shrink-0 text-right text-xs tabular-nums" style={{ color: FROG.ink }}>{p.stats[k]}</span>
            <div className="h-2 flex-1 overflow-hidden rounded-full" style={{ background: 'rgba(255,255,255,0.08)' }}>
              <div className="h-full rounded-full" style={{ width: `${statPercent(p.stats[k])}%`, background: accentText }} />
            </div>
          </div>
        ))}
      </div>

      {/* Evolution chain */}
      {p.evolutions && p.evolutions.length > 1 && (
        <>
          <h3 className="mb-2 mt-5 text-xs font-medium uppercase tracking-wide" style={{ color: FROG.faint }}>Evolutions</h3>
          <div className="flex items-center justify-center gap-1 overflow-x-auto pb-1">
            {p.evolutions.map((stage, si) => (
              <div key={si} className="flex items-center gap-1">
                {si > 0 && <ChevronRight className="h-4 w-4 shrink-0" style={{ color: FROG.faint }} aria-hidden="true" />}
                <div className="flex flex-col gap-1">
                  {stage.map((s) => (
                    <div key={s.id} className="flex flex-col items-center" style={{ opacity: s.id === p.id ? 1 : 0.85 }}>
                      <img src={s.sprite} alt="" loading="lazy" className="h-12 w-12" style={{ imageRendering: 'pixelated' }} />
                      <span className="text-[10px]" style={{ color: s.id === p.id ? accentText : FROG.faint }}>{s.display}</span>
                    </div>
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
