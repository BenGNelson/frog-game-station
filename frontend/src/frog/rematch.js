// The re-match picker's navigable option list, shared by FrogBrowser (which owns the
// controller highlight index) and GameScreen's RematchDialog (which renders the rows) so
// the two never drift — index N is the SAME row on both sides.
//
// The "It's a ROM hack" toggle is index -1 (rendered above the list). Everything below is
// indexed 0..n-1 in THIS order: the matcher's candidate shortlist, then any base-game
// SEARCH results, then a "search for a game" action row (always present, so a ROM with no
// candidates can still find its base), then a "use the basic page" clear row (only when a
// match is currently showing), and finally the way out.
//
// Cancel is a ROW, not a pill below the list. It used to be the latter and was therefore
// mouse-only — a pad could dismiss with B, but nothing said so, and there was no visible
// way out at all. Putting it in this list is what makes it reachable: the walk clamps to
// `opts.length`, so it costs one arm in the dispatcher and nothing else. It is last so
// the walk still opens on the first candidate.
export function rematchOptions(rematch) {
  if (!rematch) return []
  const { candidates = [], searchResults = [], matched } = rematch
  return [
    ...candidates.map((c) => ({ type: 'game', ...c })),
    ...searchResults.map((c) => ({ type: 'game', ...c })),
    { type: 'search' },
    ...(matched ? [{ type: 'clear' }] : []),
    { type: 'cancel' },
  ]
}
