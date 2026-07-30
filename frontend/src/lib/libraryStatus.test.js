import { describe, it, expect } from 'vitest'
import { libraryStatus } from './libraryStatus.js'

// The state where the bug lived: the server didn't answer, so the screen showed
// an ordinary empty library — indistinguishable from owning no games, and with
// no way out that looked like anything other than restarting the app.

const base = { itemCount: 0, loading: false, retrying: false, offlineResolved: true, error: null }

describe('libraryStatus', () => {
  it('shows the skeleton while the first fetch is in flight', () => {
    expect(libraryStatus({ ...base, loading: true })).toBe('booting')
  })

  it('holds the skeleton BETWEEN retries rather than flashing an empty shelf', () => {
    expect(libraryStatus({ ...base, retrying: true, error: 'Failed to fetch' })).toBe('booting')
  })

  it('waits for the downloaded-games fallback before calling anything', () => {
    expect(libraryStatus({ ...base, offlineResolved: false })).toBe('booting')
  })

  it('says UNREACHABLE — not "no games" — when every source has answered and it failed', () => {
    expect(libraryStatus({ ...base, error: 'HTTP 502' })).toBe('unreachable')
  })

  it('still reports ready for a genuinely empty library', () => {
    // No error: the server answered, you simply have no games. That must not
    // wear the "couldn't reach your library" message.
    expect(libraryStatus(base)).toBe('ready')
  })

  it('prefers real games over an error — a downloaded fallback wins', () => {
    // Something playable on screen beats a message about the server, even
    // though the API call did fail.
    expect(libraryStatus({ ...base, itemCount: 3, error: 'HTTP 502' })).toBe('ready')
  })

  it('never shows an error once games are on screen, whatever else is happening', () => {
    for (const extra of [{ loading: true }, { retrying: true }, { offlineResolved: false }]) {
      expect(libraryStatus({ ...base, ...extra, itemCount: 1, error: 'boom' })).toBe('ready')
    }
  })
})
