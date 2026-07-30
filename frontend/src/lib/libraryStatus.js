// What the library screen should be showing right now.
//
// Three states, and the whole point is that the last two are DIFFERENT:
//
//   'booting'     — nothing to show yet, but a source might still land
//   'unreachable' — nothing to show and the server didn't answer
//   'ready'       — show what we have (which may legitimately be an empty library)
//
// Telling someone they own no games when the request simply failed is a lie, and
// it's a costly one: it looks permanent, so the only apparent way out is to close
// and reopen the app. That's exactly what an unlucky first fetch after a deploy
// used to do — see the retry note in useApi.js.
export function libraryStatus({ itemCount, loading, retrying, offlineResolved, error }) {
  if (itemCount > 0) return 'ready'
  // A backoff between attempts still counts as "might land" — the skeleton
  // holds rather than flashing an empty shelf between tries.
  if (loading || retrying || !offlineResolved) return 'booting'
  // Only once every source has answered does a failure become the story. The
  // downloaded-games fallback getting there first wins: something real to play
  // beats an error about the server every time.
  return error ? 'unreachable' : 'ready'
}
