import { coverUrl } from './library.js'

// The game list shows exactly ONE cover — the big art aside for the focused row —
// and re-fetches it on every cursor move. Scroll quickly and each new row flashes
// blank while its cover loads. Warming the neighbours fixes that: kick off image
// loads for the rows just above and below the cursor so the browser HTTP cache
// already holds them by the time you land there.

// The neighbours worth warming: `radius` rows on each side of the focused one,
// clamped to the list and EXCLUDING the focused row itself (its <img> is already
// fetching). Returned nearest-first (focus±1 before focus±2) so the most likely
// next row warms first. Pure — no DOM — so it's unit-testable on its own.
export function neighborCoverUrls(games, focus, radius = 2) {
  if (!Array.isArray(games) || !Number.isInteger(focus)) return []
  const urls = []
  for (let d = 1; d <= radius; d++) {
    for (const i of [focus - d, focus + d]) {
      const g = games[i]
      if (g && g.id != null) urls.push(coverUrl(g.id, g.cover_v))
    }
  }
  return urls
}

// Warm the browser HTTP cache for the given URLs. `new Image().src = url` is a
// fire-and-forget GET that lands in the same cache the real <img> reads from, so
// the next row's cover is already there — no fetch flash. No-op where `Image` is
// undefined (tests / non-DOM), so callers don't have to guard.
export function prefetchCovers(urls) {
  if (typeof Image === 'undefined') return
  for (const url of urls) {
    const img = new Image()
    img.src = url
  }
}
