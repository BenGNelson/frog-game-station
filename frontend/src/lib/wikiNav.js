// Pure navigation helpers for the wiki reader — link resolution and the in-reader
// history stack. Kept out of the component so they're unit-testable without a DOM
// (they touch only `dataset`/`parentNode`, which plain objects can stand in for).

// The backend sanitizer rewrites article links to data-attributes: an internal wiki
// page becomes `data-wiki-title="Page"`, an external link `data-wiki-href="url"`.
// A click can land on a child of the <a> (an <img>, a <span>), so walk up to the
// nearest link and report what to do with it. Returns null for non-link clicks.
export function wikiLinkTarget(node, stopAt = null) {
  let el = node
  while (el && el !== stopAt) {
    const data = el.dataset
    if (data) {
      if (data.wikiTitle) return { type: 'internal', title: data.wikiTitle }
      if (data.wikiHref) return { type: 'external', href: data.wikiHref }
    }
    el = el.parentNode
  }
  return null
}

// A Bulbapedia species article title ends in '_(Pokémon)' ('Bulbasaur_(Pokémon)'). In a
// Pokémon walkthrough those links are worth intercepting — routing them into OUR Pokédex
// (types/stats/evolutions) instead of loading another wiki page. Pure so the reader can
// test the routing decision without a DOM. The backend resolves the title -> a dex number.
export function isSpeciesTitle(title) {
  return typeof title === 'string' && title.endsWith('_(Pokémon)')
}

// The reader keeps a stack of visited page titles so Back returns to where you were.
// `at` is the index of the current page. These are the small pure operations the
// component drives; they never mutate the input.

export function pushPage(history, title) {
  // Following a link truncates any forward history (like a browser) and appends.
  const trimmed = history.stack.slice(0, history.at + 1)
  return { stack: [...trimmed, title], at: trimmed.length }
}

export function goBack(history) {
  if (history.at <= 0) return history
  return { stack: history.stack, at: history.at - 1 }
}

export function currentPage(history) {
  return history.stack[history.at] ?? null
}

export function canGoBack(history) {
  return history.at > 0
}

export const emptyHistory = { stack: [], at: -1 }

// Seed the stack with the first page (the resolved default). Separate from pushPage
// so the initial load isn't treated as "following a link".
export function startHistory(title) {
  return { stack: [title], at: 0 }
}

// Controller link focus: Left/Right step through the article's links. From "nothing
// focused" (-1), Right lands on the first link and Left on the last, so either key
// gets you started. Clamps at the ends (no wraparound — a wall tells you you're at the
// edge). Returns the current index unchanged when there are no links.
export function nextLinkIndex(count, current, dir) {
  if (count <= 0) return -1
  if (current < 0) return dir > 0 ? 0 : count - 1
  return Math.max(0, Math.min(count - 1, current + dir))
}
