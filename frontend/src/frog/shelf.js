// What the shelf is made of.
//
// Pure functions, no DOM — the shelf's whole structure is decided here and the
// component just draws it. That's what makes "does Jump back in come first?" and
// "does an empty system still show?" answerable by a test instead of by squinting
// at an iPad.

import { letterOf } from '../lib/library.js'
import { SYSTEMS } from './theme.js'

// The order the consoles sit in. Chronological, which is also roughly the order
// they're most-to-least likely to be reached for, and it means the row never
// re-orders under you the way a "most played" sort would.
export const SYSTEM_ORDER = [
  'Game Boy',
  'Game Boy Color',
  'Game Boy Advance',
  'Super Nintendo',
  'Sega Genesis',
  'Sega Master System',
]

// Six systems, exactly as many as fit on one screen — the whole reason the shelf
// doesn't scroll. A system with no games still gets its tile (dimmed): a gap in the
// row would be more confusing than an empty shelf, and it tells you what Frog
// *could* play if you dropped a ROM in.
//
// A label we've never seen (a new core added to the backend) lands at the end
// rather than vanishing.
export function buildSystems(items = []) {
  const counts = new Map()
  for (const g of items) counts.set(g.label, (counts.get(g.label) || 0) + 1)

  const known = SYSTEM_ORDER.map((label) => ({ id: label, label, count: counts.get(label) || 0 }))
  const extra = [...counts.keys()]
    .filter((label) => !SYSTEMS[label])
    .sort()
    .map((label) => ({ id: label, label, count: counts.get(label) }))

  return [...known, ...extra]
}

// Re-hydrate stored id-markers against the LIVE library. Every rail here (and the game
// page's "more like this") is stored as bare markers — an id plus maybe a `when` or a
// play-time — and turned back into real games the same way: swap each marker for the
// library's own copy (so the name is never stale), drop the ones whose game has left,
// and carry any per-card field across with `decorate`. One place, so a change to how a
// card is built can't be half-applied across four call sites.
export function hydrate(items = [], refs = [], decorate) {
  const byId = new Map(items.map((g) => [g.id, g]))
  return refs
    .map((ref) => {
      const game = byId.get(ref.id)
      if (!game) return null
      return decorate ? { ...game, ...decorate(ref) } : game
    })
    .filter(Boolean)
}

// "Jump back in" — the row that means most sessions never touch the alphabet. Recents
// are stored as bare markers (id + name + when); the `when` rides across for the card.
export function jumpBackIn(items = [], recent = [], limit = 6) {
  return hydrate(items, recent, (r) => ({ ts: r.ts })).slice(0, limit)
}

// The games you've starred — same re-hydration, nothing extra to carry.
export function favoriteGames(items = [], favorites = []) {
  return hydrate(items, favorites)
}

// "Most played" — the games with the most clocked play-time. `stats` comes from the
// backend already ordered most-played first (and already excluding anything with no
// counted time), so this just re-hydrates and carries each one's `playMs` for the card.
export function mostPlayed(items = [], stats = [], limit = 6) {
  return hydrate(items, stats, (s) => ({ playMs: s.play_ms })).slice(0, limit)
}

// The shelf as rails, for lib/gridNav.js — which is what gives the D-pad column
// memory for free (leave the systems row on Genesis, go up to a game, come back:
// still Genesis).
//
// "Jump back in" is rail 0 so it's where focus lands, then Favorites — both the rows
// that mean most sessions never touch the alphabet. Each disappears entirely when
// it's empty: a heading over an empty row is a worse first impression than no heading.
export function buildShelf(items = [], recent = [], favorites = [], played = []) {
  const jump = jumpBackIn(items, recent)
  const favs = favoriteGames(items, favorites)
  const top = mostPlayed(items, played)
  const systems = buildSystems(items)
  return [
    ...(jump.length ? [{ id: 'jump', title: 'Jump back in', kind: 'game', items: jump }] : []),
    ...(favs.length ? [{ id: 'favorites', title: 'Favorites', kind: 'game', items: favs }] : []),
    ...(top.length ? [{ id: 'mostPlayed', title: 'Most played', kind: 'game', items: top }] : []),
    { id: 'systems', title: 'Systems', kind: 'system', items: systems },
  ]
}

// The letters this list actually has, IN THE ORDER THE LIST IS SORTED, each mapped
// to the index of its first game.
//
// Deriving this from ALPHABET instead was a real bug: `letterOf` files numeric titles
// ("3D Pocket Pool") under '#', which sorts FIRST in a naturally-sorted list but LAST
// in ALPHABET. So a trigger press from the top row of the biggest library — the row
// focus lands on by default — walked off the end of the alphabet and dumped you 490
// games down. The list's own order is the only order that can't lie about itself.
function letterIndex(games = []) {
  const first = new Map()
  for (let i = 0; i < games.length; i++) {
    const ch = letterOf(games[i].name)
    if (!first.has(ch)) first.set(ch, i)
  }
  return first
}

// The fast lane through a long list: the triggers move a LETTER at a time.
//
// Empty letters are skipped, so a press always *does* something — a fast-forward
// that sometimes doesn't move is worse than no fast-forward at all. Six hundred
// Game Boy games is sixty D-pad presses to reach the S's; this makes it two.
export function stepLetter(games, index, step) {
  if (!games.length) return 0

  const first = letterIndex(games)
  const letters = [...first.keys()]
  const here = letterOf(games[index]?.name)

  // Going back from the middle of a letter lands on the TOP of that letter first —
  // what a scrub bar does, and it means LT is never a bigger jump than you meant.
  // A second press then moves a letter.
  if (step < 0 && index > first.get(here)) return first.get(here)

  const next = letters.indexOf(here) + step
  // Off the end: pin to the end. Never wrap — wrapping from Z back to A after a
  // trigger press you didn't quite mean is disorienting in a way a hard stop isn't.
  if (next < 0) return 0
  if (next >= letters.length) return games.length - 1
  return first.get(letters[next])
}

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

// "2 days ago". Deliberately coarse: on a shelf you want to know *roughly* how cold
// a save is, and "3 days ago" is the answer to that. "Tue 14 Jul, 21:04" is not.
export function agoLabel(ts, now = Date.now()) {
  if (!ts) return ''
  const d = now - ts
  if (d < 2 * MINUTE) return 'Just now'
  if (d < HOUR) return `${Math.round(d / MINUTE)} min ago`
  if (d < DAY) {
    const h = Math.round(d / HOUR)
    return h === 1 ? '1 hour ago' : `${h} hours ago`
  }
  const days = Math.round(d / DAY)
  if (days === 1) return 'Yesterday'
  if (days < 7) return `${days} days ago`
  const weeks = Math.round(days / 7)
  if (weeks < 5) return weeks === 1 ? 'Last week' : `${weeks} weeks ago`
  const months = Math.round(days / 30)
  return months <= 1 ? 'Last month' : `${months} months ago`
}
