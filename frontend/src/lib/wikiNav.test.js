import { describe, it, expect } from 'vitest'
import {
  wikiLinkTarget, pushPage, goBack, currentPage, canGoBack, startHistory, emptyHistory, nextLinkIndex,
} from './wikiNav.js'

// Fake DOM nodes — the helper only reads `dataset` and `parentNode`, so plain
// objects stand in without jsdom.
const node = (dataset, parent = null) => ({ dataset, parentNode: parent })

describe('wikiLinkTarget', () => {
  it('finds an internal wiki link on the clicked node', () => {
    expect(wikiLinkTarget(node({ wikiTitle: 'Raichu' }))).toEqual({
      type: 'internal', title: 'Raichu',
    })
  })

  it('finds an external link', () => {
    expect(wikiLinkTarget(node({ wikiHref: 'https://x.com' }))).toEqual({
      type: 'external', href: 'https://x.com',
    })
  })

  it('walks up from a child (e.g. an image inside the link)', () => {
    const link = node({ wikiTitle: 'Pikachu' })
    const img = node({}, link) // <img> inside <a>
    expect(wikiLinkTarget(img)).toEqual({ type: 'internal', title: 'Pikachu' })
  })

  it('returns null for a non-link click', () => {
    expect(wikiLinkTarget(node({}, node({})))).toBeNull()
    expect(wikiLinkTarget(null)).toBeNull()
  })

  it('stops at the given root without escaping the article', () => {
    const root = node({ wikiTitle: 'ShouldNotReach' })
    const inside = node({}, root)
    expect(wikiLinkTarget(inside, root)).toBeNull()
  })

  it('tolerates nodes with no dataset (text nodes)', () => {
    const link = node({ wikiTitle: 'P' })
    const textish = { parentNode: link } // no dataset
    expect(wikiLinkTarget(textish)).toEqual({ type: 'internal', title: 'P' })
  })
})

describe('history stack', () => {
  it('starts empty', () => {
    expect(currentPage(emptyHistory)).toBeNull()
    expect(canGoBack(emptyHistory)).toBe(false)
  })

  it('seeds the first page', () => {
    const h = startHistory('Home')
    expect(currentPage(h)).toBe('Home')
    expect(canGoBack(h)).toBe(false)
  })

  it('pushes and goes back', () => {
    let h = startHistory('A')
    h = pushPage(h, 'B')
    expect(currentPage(h)).toBe('B')
    expect(canGoBack(h)).toBe(true)
    h = goBack(h)
    expect(currentPage(h)).toBe('A')
    expect(canGoBack(h)).toBe(false)
  })

  it('back at the root is a no-op', () => {
    const h = startHistory('A')
    expect(goBack(h)).toEqual(h)
  })

  it('following a link truncates forward history', () => {
    // A -> B -> back to A -> follow C : B is discarded (browser-like).
    let h = startHistory('A')
    h = pushPage(h, 'B')
    h = goBack(h) // at A, B still in stack ahead
    h = pushPage(h, 'C')
    expect(h.stack).toEqual(['A', 'C'])
    expect(currentPage(h)).toBe('C')
  })

  it('pushes onto an empty history', () => {
    const h = pushPage(emptyHistory, 'First')
    expect(h).toEqual({ stack: ['First'], at: 0 })
  })
})

describe('nextLinkIndex', () => {
  it('starts at the first link on Right, the last on Left, from nothing focused', () => {
    expect(nextLinkIndex(5, -1, 1)).toBe(0)
    expect(nextLinkIndex(5, -1, -1)).toBe(4)
  })

  it('steps and clamps at the ends (no wraparound)', () => {
    expect(nextLinkIndex(5, 2, 1)).toBe(3)
    expect(nextLinkIndex(5, 2, -1)).toBe(1)
    expect(nextLinkIndex(5, 4, 1)).toBe(4) // already last
    expect(nextLinkIndex(5, 0, -1)).toBe(0) // already first
  })

  it('is a no-op when there are no links', () => {
    expect(nextLinkIndex(0, -1, 1)).toBe(-1)
  })
})
