import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react'
import { ArrowLeft, X, ExternalLink, Search, BookOpen, Loader2 } from 'lucide-react'
import { FROG } from '../frog/theme.js'
import { fetchWikiSource, fetchWikiPage, searchWiki, setWikiOverride } from '../lib/wikiApi.js'
import {
  wikiLinkTarget, pushPage, goBack, currentPage, canGoBack, startHistory, emptyHistory, nextLinkIndex,
} from '../lib/wikiNav.js'
import '../frog/frog.css'

const LINK_SELECTOR = 'a[data-wiki-title], a[data-wiki-href]'

// The in-game wiki reader. NOT an iframe: a cross-origin iframe can't be scrolled or
// navigated by a controller, and the wikis worth reading block being framed anyway.
// Instead the backend fetches a MediaWiki article, sanitizes it, and we render it in
// OUR page — same-origin, so it's controller/touch-navigable and FROG-skinned.
//
// MOUNTED-PERSISTENT: unlike the other player panels (which unmount on close), this one
// stays mounted for the session and only hides via `display:none`. That's what keeps
// your article + scroll position across a close/reopen — "peek and keep your place".
// It loads once, on first open.
const WikiPanel = forwardRef(function WikiPanel({
  open,
  gameId,
  gameName,
  accent = FROG.jade,
  onClose,
  legend = null,
}, ref) {
  const [phase, setPhase] = useState('idle') // idle|loading|reading|nolink|error
  const [source, setSource] = useState(null) // resolved {host, title, url, source}
  const [article, setArticle] = useState(null) // {title, html, sections}
  const [history, setHistory] = useState(emptyHistory)
  const [pageBusy, setPageBusy] = useState(false)
  const [flash, setFlash] = useState(null) // transient error (e.g. a dead link)

  const loadedRef = useRef(false)
  const scrollerRef = useRef(null)
  const bodyRef = useRef(null)
  const linkFocusRef = useRef(-1) // controller link focus; -1 = reading, not on a link

  const scrollTop = () => {
    if (scrollerRef.current) scrollerRef.current.scrollTop = 0
  }

  // --- controller link focus (a highlighted <a> the pad steps through) -------
  const links = () => Array.from(bodyRef.current?.querySelectorAll(LINK_SELECTOR) || [])

  const clearLinkFocus = useCallback(() => {
    bodyRef.current?.querySelector('a.wiki-focus')?.classList.remove('wiki-focus')
    linkFocusRef.current = -1
  }, [])

  const moveLink = useCallback((dir) => {
    const els = links()
    if (!els.length) return
    const next = nextLinkIndex(els.length, linkFocusRef.current, dir)
    els[linkFocusRef.current]?.classList.remove('wiki-focus')
    const el = els[next]
    el?.classList.add('wiki-focus')
    el?.scrollIntoView({ block: 'center', behavior: 'auto' })
    linkFocusRef.current = next
  }, [])

  // Fetch one article and make it current. `push` appends to the in-reader history
  // (following a link); otherwise it replaces (the initial load / a back step).
  const loadPage = useCallback(
    async (title, { push = false } = {}) => {
      setPageBusy(true)
      setFlash(null)
      try {
        const art = await fetchWikiPage(gameId, title)
        setArticle(art)
        setPhase('reading')
        setHistory((h) => (push ? pushPage(h, title) : h.at < 0 ? startHistory(title) : h))
        clearLinkFocus()
        scrollTop()
      } catch (e) {
        if (article) setFlash(e.status === 404 ? 'That page has no article.' : 'Could not load that page.')
        else setPhase('error')
      } finally {
        setPageBusy(false)
      }
    },
    [gameId, article, clearLinkFocus]
  )

  // Follow a resolved link target — the shared path for a tap and a controller A.
  const follow = useCallback(
    (target) => {
      if (!target) return
      if (target.type === 'internal') loadPage(target.title, { push: true })
      else if (target.type === 'external') window.open(target.href, '_blank', 'noopener,noreferrer')
    },
    [loadPage]
  )

  const activateLink = useCallback(() => {
    const el = links()[linkFocusRef.current]
    if (el) follow(wikiLinkTarget(el))
  }, [follow])

  // Resolve which wiki this game points at, then load its default page (or offer
  // search when nothing is linked).
  const loadSource = useCallback(async () => {
    setPhase('loading')
    try {
      const { enabled, resolved } = await fetchWikiSource(gameId)
      if (!enabled) {
        setPhase('error')
        return
      }
      if (resolved && resolved.kind === 'external') {
        // A pinned non-wiki link (a GameFAQs guide, say) — we can't render it, so it's
        // an open-in-tab card. The escape hatch for a hack whose guide isn't a wiki.
        setSource(resolved)
        setPhase('external')
      } else if (resolved) {
        setSource(resolved)
        await loadPage(resolved.title) // seeds the history itself (h.at < 0 → startHistory)
      } else {
        setSource(null)
        setPhase('nolink')
      }
    } catch {
      setPhase('error')
    }
  }, [gameId, loadPage])

  // Load once, the first time the panel is opened for this game.
  useEffect(() => {
    if (open && !loadedRef.current) {
      loadedRef.current = true
      loadSource()
    }
  }, [open, loadSource])

  // Take keyboard focus on open (like every other player panel). The reader always sits
  // over a PAUSED game, so the pause menu is still mounted and focused underneath it —
  // without stealing focus, a desktop user's arrows/Enter/Escape would drive that hidden
  // menu (and could hit Quit). Focusing the scroller also gives native arrow/PageDn
  // scrolling of the article.
  useEffect(() => {
    if (open) scrollerRef.current?.focus()
  }, [open])

  // The reader owns its keys: Escape closes it, and stopPropagation keeps the buried
  // pause menu (and the window Escape handler) from also acting on the same press.
  const onKeyDown = useCallback(
    (e) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        onClose()
      }
    },
    [onClose]
  )

  const onBodyClick = useCallback(
    (e) => {
      const target = wikiLinkTarget(e.target, bodyRef.current)
      if (!target) return
      e.preventDefault()
      follow(target)
    },
    [follow]
  )

  // Returns whether it actually went back — PlayerShell closes the panel when it can't.
  const back = useCallback(() => {
    if (!canGoBack(history)) return false
    const next = goBack(history)
    setHistory(next)
    loadPage(currentPage(next)) // replace, don't push
    return true
  }, [history, loadPage])

  // Scroll to the previous/next section heading — fast structural nav (triggers).
  const scrollToSection = useCallback((dir) => {
    const scroller = scrollerRef.current
    const body = bodyRef.current
    if (!scroller || !body) return
    const heads = Array.from(body.querySelectorAll('h1, h2, h3'))
    if (!heads.length) return
    const sTop = scroller.getBoundingClientRect().top
    const tops = heads.map((h) => h.getBoundingClientRect().top - sTop + scroller.scrollTop)
    const cur = scroller.scrollTop
    let target
    if (dir > 0) target = tops.find((t) => t > cur + 4)
    else {
      const before = tops.filter((t) => t < cur - 4)
      target = before.length ? before[before.length - 1] : 0
    }
    if (target != null) scroller.scrollTo({ top: Math.max(0, target - 8), behavior: 'auto' })
  }, [])

  // The controller surface PlayerShell drives while the panel owns the pad.
  useImperativeHandle(ref, () => ({
    scroll(dy) { scrollerRef.current?.scrollBy({ top: dy, behavior: 'auto' }) },
    page(dir) {
      const el = scrollerRef.current
      if (el) el.scrollBy({ top: dir * el.clientHeight * 0.85, behavior: 'auto' })
    },
    section: scrollToSection,
    moveLink,
    activate: activateLink,
    back,
  }), [scrollToSection, moveLink, activateLink, back])

  const openInTab = () => {
    // Open the page you're actually reading (which changes as you follow links), not the
    // originally-resolved one. For an external source there's no in-reader page, so use it.
    const title = currentPage(history)
    const url = source?.host && title
      ? `https://${source.host}/wiki/${encodeURIComponent(title)}`
      : source?.url
    if (url) window.open(url, '_blank', 'noopener,noreferrer')
  }

  const accentText = `rgb(${accent})`

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Wiki"
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
      {/* Header: back · title/source · open-in-tab · close */}
      <div className="flex shrink-0 items-center gap-2 border-b px-3 py-2"
           style={{ borderColor: 'rgba(255,255,255,0.06)', marginTop: 'env(safe-area-inset-top)' }}>
        <button
          onClick={back}
          disabled={!canGoBack(history)}
          aria-label="Back"
          className="flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-sm transition-opacity disabled:opacity-30 active:opacity-70"
          style={{ background: FROG.panel, color: FROG.ink }}
        >
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
        </button>

        <div className="min-w-0 flex-1 text-center">
          <p className="truncate text-sm font-semibold" style={{ color: FROG.ink }}>
            {article?.title || 'Wiki'}
          </p>
          {source && (
            <p className="truncate text-[11px]" style={{ color: FROG.faint }}>
              {source.host}
            </p>
          )}
        </div>

        {source?.url && (
          <button
            onClick={openInTab}
            aria-label="Open in browser"
            className="flex items-center rounded-lg px-2.5 py-1.5 text-sm active:opacity-70"
            style={{ background: FROG.panel, color: FROG.soft }}
          >
            <ExternalLink className="h-4 w-4" aria-hidden="true" />
          </button>
        )}
        <button
          onClick={onClose}
          aria-label="Close wiki"
          className="flex items-center rounded-lg px-2.5 py-1.5 text-sm active:opacity-70"
          style={{ background: FROG.panel, color: FROG.ink }}
        >
          <X className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>

      {/* Body — focusable so the keyboard scrolls it natively (arrows / PageDn / Space). */}
      <div ref={scrollerRef} tabIndex={-1} className="min-h-0 flex-1 touch-auto overflow-y-auto overscroll-contain outline-none">
        {phase === 'loading' && <Centered><Spinner /> Loading…</Centered>}

        {phase === 'error' && (
          <Centered>
            <BookOpen className="mb-2 h-8 w-8 opacity-40" aria-hidden="true" />
            Couldn’t load the wiki.
          </Centered>
        )}

        {phase === 'external' && source && (
          <Centered>
            <ExternalLink className="mb-2 h-8 w-8" style={{ color: accentText }} aria-hidden="true" />
            <p style={{ color: FROG.ink }}>This link isn’t a wiki we can render.</p>
            <p className="mb-1 text-xs" style={{ color: FROG.faint }}>{source.host}</p>
            <button
              onClick={openInTab}
              className="mt-2 rounded-lg px-4 py-2 text-sm active:opacity-70"
              style={{ background: FROG.panel, color: FROG.ink }}
            >
              Open in browser
            </button>
          </Centered>
        )}

        {phase === 'nolink' && (
          <NoLink
            gameId={gameId}
            gameName={gameName}
            accentText={accentText}
            onPicked={loadSource}
          />
        )}

        {phase === 'reading' && article && (
          <div className="mx-auto max-w-3xl px-4 py-4">
            {flash && (
              <p className="mb-3 rounded-lg px-3 py-2 text-xs" style={{ background: FROG.panel, color: FROG.soft }}>
                {flash}
              </p>
            )}
            <div
              ref={bodyRef}
              className="wiki-article"
              style={{ '--wiki-accent': accentText }}
              onClick={onBodyClick}
              dangerouslySetInnerHTML={{ __html: article.html }}
            />
          </div>
        )}

        {pageBusy && phase === 'reading' && (
          <div className="pointer-events-none absolute right-3 top-14" aria-hidden="true">
            <Spinner />
          </div>
        )}
      </div>

      {legend && <div className="shrink-0 px-3 py-2">{legend}</div>}
    </div>
  )
})

export default WikiPanel

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

// Shown when a game has no wiki linked yet: search for one and pin it. Touch/keyboard
// entry here; controller text entry arrives with the reusable on-screen keyboard.
function NoLink({ gameId, gameName, accentText, onPicked }) {
  const [q, setQ] = useState(gameName || '')
  const [results, setResults] = useState([])
  const [host, setHost] = useState(null) // which wiki the backend curated for us
  const [searched, setSearched] = useState(false)
  const [busy, setBusy] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)

  const run = useCallback(async () => {
    if (!q.trim()) return
    setBusy(true)
    // No explicit host — the backend curates one from the game name (a Pokémon hack
    // -> Bulbapedia), falling back to Wikipedia.
    const res = await searchWiki(gameId, q, null, gameName)
    setResults(res.results || [])
    setHost(res.host || null)
    setSearched(true)
    setBusy(false)
  }, [gameId, q, gameName])

  const pick = useCallback(
    async (url) => {
      if (!url) return
      setSaving(true)
      setError(null)
      try {
        await setWikiOverride(gameId, url)
        onPicked()
      } catch {
        setError('Couldn’t save that link — try again.')
      } finally {
        setSaving(false)
      }
    },
    [gameId, onPicked]
  )

  return (
    <div className="mx-auto max-w-xl px-4 py-6">
      <div className="mb-4 flex flex-col items-center gap-2 text-center">
        <BookOpen className="h-8 w-8" style={{ color: accentText }} aria-hidden="true" />
        <p className="text-sm font-semibold" style={{ color: FROG.ink }}>No wiki linked yet</p>
        <p className="text-xs" style={{ color: FROG.faint }}>
          {searched && host ? `Results from ${host} — pick a page to pin it.` : 'Search for this game’s wiki and pin a page.'}
        </p>
      </div>

      <form
        className="mb-3 flex gap-2"
        onSubmit={(e) => { e.preventDefault(); run() }}
      >
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Game or topic…"
          className="min-w-0 flex-1 rounded-lg px-3 py-2 text-sm outline-none"
          style={{ background: FROG.panel, color: FROG.ink }}
        />
        <button
          type="submit"
          className="flex items-center gap-1 rounded-lg px-3 py-2 text-sm active:opacity-70"
          style={{ background: FROG.panel, color: FROG.ink }}
        >
          {busy ? <Spinner /> : <Search className="h-4 w-4" aria-hidden="true" />}
        </button>
      </form>

      {error && (
        <p className="mb-2 rounded-lg px-3 py-2 text-center text-xs" style={{ background: FROG.panel, color: FROG.soft }}>
          {error}
        </p>
      )}

      <ul className="space-y-1.5">
        {results.map((r) => (
          <li key={r.title}>
            <button
              disabled={saving || !r.url}
              onClick={() => pick(r.url)}
              className="w-full truncate rounded-lg px-3 py-2 text-left text-sm transition-colors active:opacity-70 disabled:opacity-40"
              style={{ background: FROG.panel, color: FROG.ink }}
            >
              {r.title}
            </button>
          </li>
        ))}
        {!busy && q.trim() && results.length === 0 && (
          <li className="px-1 py-2 text-center text-xs" style={{ color: FROG.faint }}>No results.</li>
        )}
      </ul>
    </div>
  )
}
