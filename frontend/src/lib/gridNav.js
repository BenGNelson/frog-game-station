// Directional focus movement for the controller-driven surfaces (the pause menu,
// which is a grid; and Big Picture, which is rails of box art).
//
// Pure on purpose — no DOM, no refs, no measuring. A geometric focus engine that
// measures elements would need jsdom to test, and this app has none, which would
// leave the most navigation-critical code as the only untested code. Our layouts
// aren't arbitrary geometry: they're a grid and a set of rails, both of which are
// just index arithmetic.

const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n))

// Row-major grid walk, no wrapping (a D-pad that wraps feels broken — you press
// right at the edge and the cursor teleports across the screen).
//
// The last row is usually short. Pressing down from the row above into that gap
// lands on the last item rather than refusing to move, which is what every
// console UI does.
// `centerLastRow`: when the last row holds a single orphan item, it's drawn in the
// MIDDLE column rather than dumped on the left (7 tiles read as 3-3-1 centred, not
// 3-3 and a stray). The walk has to know that, or the cursor and your eye disagree:
// press Up from the centred tile and you'd jump to the left-hand column, which is
// not the tile sitting above it.
// `wrap` closes a single column into a loop: up from the first row lands on the
// last, down from the last returns to the first. Opt-in, and only meaningful for
// a 1-column list — it exists so the pause menu's LAST item (Quit) is one press
// from its first (Resume) instead of a walk down the whole menu.
export function moveInGrid({ count, cols, index }, dir, { centerLastRow = false, wrap = false } = {}) {
  if (!count || !cols) return 0
  const i = clamp(index, 0, count - 1)
  const col = i % cols
  const row = Math.floor(i / cols)
  const lastRow = Math.floor((count - 1) / cols)

  const orphan = centerLastRow && count % cols === 1 && count > cols
  const middle = Math.floor((cols - 1) / 2)

  // The orphan is alone on its row: left/right/down have nowhere to go, and up
  // lands on whatever is actually drawn above it — the middle of the row before.
  if (orphan && i === count - 1) {
    return dir === 'up' ? (lastRow - 1) * cols + middle : i
  }

  if (wrap && cols === 1) {
    if (dir === 'up') return i === 0 ? count - 1 : i - 1
    if (dir === 'down') return i === count - 1 ? 0 : i + 1
  }

  switch (dir) {
    case 'left':
      return col > 0 ? i - 1 : i
    case 'right':
      return col < cols - 1 && i + 1 < count ? i + 1 : i
    case 'up':
      return row > 0 ? i - cols : i
    case 'down': {
      const below = i + cols
      if (below < count) return below
      return row < lastRow ? count - 1 : i
    }
    default:
      return i
  }
}

// Rails: `rails` = [{ id, items, cols? }], `focus` = { rail, index }.
//
// Left/right moves within a rail; up/down (and railPrev/railNext — the shoulder
// buttons) moves between rails. Returns the new focus AND the updated column
// memory, which is the thing that makes rails feel right: leave a rail at item
// 12, go down, come back — you're on item 12 again, not back at the start.
// Netflix, the Switch home screen and Steam Big Picture all do this.
//
// A rail may declare `cols`, which makes it a GRID of that width rather than one
// long row — the shelf's Systems block is drawn as a 3-wide grid, and without this
// the D-pad walked it as a flat rail, so reaching the bottom row meant stepping
// across every tile before it. Inside such a rail, up/down move a row; only the
// top and bottom rows exit to the neighbouring rail, which is exactly the rail
// semantics the edges had before. The row walk is delegated to moveInGrid rather
// than reimplemented, so the short-last-row rule holds here too: pressing down
// into the gap under a short final row lands on the last item.
//
// The shoulder buttons (railPrev/railNext) deliberately IGNORE `cols` and always
// change rail — they're the "skip a section" control, and having them stop off at
// each row of the systems grid would defeat the point of having them.
export function moveInRails(rails, focus, dir, memory = {}) {
  if (!rails || !rails.length) return { focus: { rail: 0, index: 0 }, memory }

  const rail = clamp(focus?.rail ?? 0, 0, rails.length - 1)
  const items = rails[rail]?.items ?? []
  const index = clamp(focus?.index ?? 0, 0, Math.max(0, items.length - 1))
  // Never trust a cols wider than the rail: a 2-tile grid declared at 3 columns is
  // one row, and the arithmetic below should see it that way.
  const cols = rails[rail]?.cols ? Math.min(rails[rail].cols, Math.max(1, items.length)) : 0

  const gridOpts = { centerLastRow: !!rails[rail]?.centerLastRow }

  if (dir === 'left' || dir === 'right') {
    // In a grid, left/right stay within the row rather than running on into the next
    // one — moveInGrid already refuses to cross a row edge.
    const next = cols
      ? moveInGrid({ count: items.length, cols, index }, dir, gridOpts)
      : clamp(index + (dir === 'right' ? 1 : -1), 0, Math.max(0, items.length - 1))
    return { focus: { rail, index: next }, memory: { ...memory, [rails[rail].id]: next } }
  }

  // Inside a grid rail, up/down walk the rows first and only leave the rail from the
  // top or bottom edge. moveInGrid returns the SAME index when it can't move, which is
  // precisely the "I'm at the edge, hand it back to the rail walk" signal.
  if (cols && (dir === 'up' || dir === 'down')) {
    const moved = moveInGrid({ count: items.length, cols, index }, dir, gridOpts)
    if (moved !== index) {
      return { focus: { rail, index: moved }, memory: { ...memory, [rails[rail].id]: moved } }
    }
  }

  const step = dir === 'up' || dir === 'railPrev' ? -1 : dir === 'down' || dir === 'railNext' ? 1 : 0
  if (!step) return { focus: { rail, index }, memory }

  // Skip rails with nothing in them, so focus is never stranded on a heading
  // with no tiles under it (an empty "Continue playing" rail is common).
  let next = rail + step
  while (next >= 0 && next < rails.length && !rails[next].items?.length) next += step
  if (next < 0 || next >= rails.length) return { focus: { rail, index }, memory } // no wrap at the ends

  const remembered = { ...memory, [rails[rail].id]: index }
  const target = rails[next]
  // Clamp against the target rail's length: remembering column 12 and moving to
  // a rail with 3 items must land on the last item, not off the end.
  let restored = clamp(remembered[target.id] ?? 0, 0, target.items.length - 1)

  // Entering a GRID rail, land on the edge row you arrived at — top row coming down,
  // bottom row coming up — keeping the remembered COLUMN. Column memory alone would
  // drop you back on the row you left from, so walking down into the systems grid
  // could skip its first row entirely and land you three tiles in. The shoulder
  // buttons (step without up/down) are exempt: they jump between sections, so the
  // remembered tile is the right answer for them.
  const targetCols = target.cols ? Math.min(target.cols, Math.max(1, target.items.length)) : 0
  if (targetCols && (dir === 'up' || dir === 'down')) {
    const col = restored % targetCols
    const lastRow = Math.floor((target.items.length - 1) / targetCols)
    const row = dir === 'down' ? 0 : lastRow
    restored = clamp(row * targetCols + col, 0, target.items.length - 1)
  }
  return { focus: { rail: next, index: restored }, memory: remembered }
}

// Keep the shelf's focus valid as the rails CHANGE SHAPE under it — the library resolves,
// then async history rails (Jump back in, Favorites) and per-tag rails land, each able to
// insert AHEAD of the cursor. `prev`/`rails` are the old/new rail arrays; `focus` the
// current { rail, index }; `driven` whether the user has taken control yet.
//
//  - NOT driven yet → pin to the TOP rail (rail 0). The systems placeholder renders before
//    the library resolves, so without this the cursor locks onto Game Boy and a Jump-back-in
//    rail arriving ahead just slides it down. We want it on the top rail's first game.
//  - Driven → keep the SAME rail by identity (find where its id moved to), so a rail inserted
//    ahead can't drag the highlight onto a different game; fall back to index-clamping only
//    when that rail is gone. Returns the same `focus` reference when nothing changed (so an
//    inert reconcile doesn't re-render / re-scroll).
export function reconcileShelfFocus(prev, rails, focus, driven) {
  const list = rails || []
  const f = focus || { rail: 0, index: 0 }
  if (!driven) {
    const count = list[0]?.items?.length ?? 0
    const index = clamp(f.index, 0, Math.max(0, count - 1))
    return f.rail === 0 && f.index === index ? f : { rail: 0, index }
  }
  const wasId = (prev || [])[f.rail]?.id
  let rail = wasId != null ? list.findIndex((r) => r.id === wasId) : -1
  if (rail < 0) rail = clamp(f.rail, 0, Math.max(0, list.length - 1))
  const count = list[rail]?.items?.length ?? 0
  const index = clamp(f.index, 0, Math.max(0, count - 1))
  return rail === f.rail && index === f.index ? f : { rail, index }
}
