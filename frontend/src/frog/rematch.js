// The re-match picker's navigable option list, shared by FrogBrowser (which owns the
// controller highlight index) and GameScreen's RematchDialog (which renders the rows) so
// the two never drift — index N is the SAME row on both sides.
//
// The "It's a ROM hack" toggle is index -1 (rendered above the list). Everything below is
// indexed 0..n-1 in THIS order: the matcher's candidate shortlist, then any base-game
// SEARCH results, then a "search for a game" action row (always present, so a ROM with no
// candidates can still find its base), then a "use the basic page" clear row (only when a
// match is currently showing).
export function rematchOptions(rematch) {
  if (!rematch) return []
  const { candidates = [], searchResults = [], matched } = rematch
  return [
    ...candidates.map((c) => ({ type: 'game', ...c })),
    ...searchResults.map((c) => ({ type: 'game', ...c })),
    { type: 'search' },
    ...(matched ? [{ type: 'clear' }] : []),
  ]
}
