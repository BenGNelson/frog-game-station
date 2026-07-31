import { useEffect } from 'react'
import { railScrollDelta, railCanScroll } from '../lib/wheelScroll.js'

// Let a mouse wheel move a horizontal rail. Attach the returned ref-callback's element:
//
//   const railRef = useRef(null)
//   useWheelRail(railRef)
//
// THE TRAP, and the reason this is a hook rather than an onWheel prop: React attaches
// its `wheel` listener at the root as a PASSIVE one, and a passive listener's
// preventDefault() is ignored — silently. So `<div onWheel={e => e.preventDefault()}>`
// looks completely reasonable, does nothing, and the page scrolls anyway. The listener
// has to be added natively with { passive: false }.
//
// Scrolling a rail does NOT move focus. That is the same contract the game list's free
// vertical scroll already has (its windowing reads the measured scrollTop, not the focus
// index), and it is what keeps a wheel from yanking the pad's cursor around.
export function attachWheelRail(el) {
  if (!el) return () => {}

  const onWheel = (e) => {
    const delta = railScrollDelta(e, { pageWidth: el.clientWidth })
    if (!delta) return
    // Nothing to give, or we're already at that end — let the page have it, so the
    // wheel never dead-ends over a rail.
    if (!railCanScroll(el, delta)) return
    e.preventDefault()
    // Instant, not smooth: `behavior: 'smooth'` fights each successive wheel tick and
    // turns a quick spin into a slow crawl that finishes long after you stopped.
    el.scrollLeft += delta
  }

  el.addEventListener('wheel', onWheel, { passive: false })
  return () => el.removeEventListener('wheel', onWheel)
}

// One rail behind a ref — the game page's "More like this", the Pokédex evolution strip.
export function useWheelRail(ref) {
  useEffect(() => attachWheelRail(ref.current), [ref])
}

// Many rails at once, for the shelf: it keeps an ARRAY of rail elements (they double as
// the scrollIntoView targets), and the array changes shape as rails arrive.
export function useWheelRails(getElements, deps) {
  useEffect(() => {
    const offs = (getElements() || []).filter(Boolean).map(attachWheelRail)
    return () => offs.forEach((off) => off())
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)
}
