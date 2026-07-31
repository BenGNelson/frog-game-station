import { describe, it, expect } from 'vitest'
import { renderToString } from 'react-dom/server'
import ConfirmDialog from './ConfirmDialog.jsx'
import { FROG, focusOutline } from './theme.js'

// Render smoke for the shared yes/no gate. It's reused by the game-detail page and the
// in-game save-state shelf, so a crash-on-render here would blank a delete confirm on
// either — server-rendering runs its full path (useFocusTrap's ref, the label/z props)
// with no DOM needed, matching the panel render-smoke idiom next door.

describe('ConfirmDialog', () => {
  it('renders the message and the default Delete/Keep buttons', () => {
    const html = renderToString(
      <ConfirmDialog message="Delete this save state?" onYes={() => {}} onNo={() => {}} />
    )
    expect(html).toContain('Delete this save state?')
    expect(html).toContain('frog-confirm')
    expect(html).toContain('frog-confirm-yes')
    expect(html).toContain('>Delete<')
    expect(html).toContain('>Keep<')
    expect(html).toContain('z-20') // the default stack level
  })

  it('honours custom labels and a caller-supplied z (the shelf stacks above its overlay)', () => {
    const html = renderToString(
      <ConfirmDialog message="Remove this download?" onYes={() => {}} onNo={() => {}} yesLabel="Remove" noLabel="Cancel" z="z-40" />
    )
    expect(html).toContain('Remove this download?')
    expect(html).toContain('>Remove<')
    expect(html).toContain('>Cancel<')
    expect(html).toContain('z-40')
  })

  it('marks the highlighted button in controlled mode (d-pad navigable)', () => {
    // focus=1 => Keep is highlighted, Delete is not. focus=0 => the reverse. The player
    // drives this so the pad can move left/right between the two before committing.
    const keep = renderToString(<ConfirmDialog message="Delete?" onYes={() => {}} onNo={() => {}} focus={1} onFocusChange={() => {}} />)
    expect(keep).toMatch(/>Keep<[\s\S]*$/)
    expect((keep.match(/data-focused="true"/g) || []).length).toBe(1)

    const del = renderToString(<ConfirmDialog message="Delete?" onYes={() => {}} onNo={() => {}} focus={0} onFocusChange={() => {}} />)
    expect((del.match(/data-focused="true"/g) || []).length).toBe(1)
  })

  // The defect this gate is named for: its commit used to be a SOLID danger fill, so the
  // accent focus signal had nothing to contrast against and the highlight vanished on the
  // one button you most need to see before pressing.
  it('never draws a solid fill, and both rows take the same cursor when focused', () => {
    const { outline } = focusOutline()
    for (const focus of [0, 1]) {
      const html = renderToString(
        <ConfirmDialog message="Quit to library?" onYes={() => {}} onNo={() => {}} yesLabel="Quit" noLabel="Keep playing" focus={focus} onFocusChange={() => {}} />
      )
      expect(html, `focus=${focus} must show the cursor`).toContain(outline)
      // A solid danger fill would render as the bare colour; the rows use a 14% tint.
      expect(html, `focus=${focus} must not fill solid`).not.toContain(`background:rgb(${FROG.danger})`)
      expect((html.match(/data-focused="true"/g) || []).length).toBe(1)
    }
  })

  it('keeps the testids the pad router and the e2e suite click', () => {
    // frog-confirm / frog-confirm-yes are load-bearing: e2e/frog_detail.py drives the
    // delete gate through them, and they survived the move from Buttons to rows.
    const html = renderToString(<ConfirmDialog message="Delete?" onYes={() => {}} onNo={() => {}} />)
    expect(html).toContain('data-testid="frog-confirm"')
    expect(html).toContain('data-testid="frog-confirm-yes"')
    expect(html).toContain('data-testid="frog-confirm-no"')
  })

  // THE CONTRACT padRouter DEPENDS ON. It hardcodes `focus === 1 ? cancel : confirm`, in
  // two places, so if these rows ever swap, A deletes while the highlight sits on Keep.
  // The assertion this replaces matched `>Keep<` anywhere in the string, so swapping the
  // rows kept every test green.
  it('puts YES at index 0 and NO at index 1, in that DOM order', () => {
    const html = renderToString(
      <ConfirmDialog message="Delete?" onYes={() => {}} onNo={() => {}} yesLabel="Delete" noLabel="Keep" />
    )
    expect(html.indexOf('frog-confirm-yes')).toBeGreaterThan(-1)
    expect(html.indexOf('frog-confirm-yes')).toBeLessThan(html.indexOf('frog-confirm-no'))
    expect(html.indexOf('Delete')).toBeLessThan(html.indexOf('Keep'))

    // ...and focus={0} lands on yes, focus={1} on no — the index-to-row mapping itself.
    const onYes = renderToString(
      <ConfirmDialog message="D?" onYes={() => {}} onNo={() => {}} focus={0} onFocusChange={() => {}} />
    )
    const yesIdx = onYes.indexOf('frog-confirm-yes')
    const noIdx = onYes.indexOf('frog-confirm-no')
    const focusedIdx = onYes.indexOf('data-focused="true"')
    expect(focusedIdx).toBeGreaterThan(yesIdx)
    expect(focusedIdx).toBeLessThan(noIdx)
  })

  // Uncontrolled mode has no cursor at all: FrogBrowser maps Enter to YES unconditionally
  // and useFocusTrap swallows Tab, so without `primary` the gate is two identical dim
  // boxes over an irreversible act — the same "which button am I about to press?" defect
  // this component was rewritten to fix, moved to the browser screens.
  it('marks the default action when there is no cursor to show', () => {
    const html = renderToString(<ConfirmDialog message="Remove everything?" onYes={() => {}} onNo={() => {}} />)
    expect(html).not.toContain('data-focused') // no cursor in this mode
    const yesIdx = html.indexOf('frog-confirm-yes')
    const noIdx = html.indexOf('frog-confirm-no')
    const litIdx = html.indexOf(`rgba(${FROG.danger}, 0.14)`)
    expect(litIdx, 'the yes row must be lit').toBeGreaterThan(yesIdx)
    expect(litIdx, 'and it must be the yes row, not the no row').toBeLessThan(noIdx)
  })

  it('shows no primary once a cursor exists, so the two never compete', () => {
    const html = renderToString(
      <ConfirmDialog message="D?" onYes={() => {}} onNo={() => {}} focus={1} onFocusChange={() => {}} />
    )
    expect((html.match(/data-focused="true"/g) || []).length).toBe(1)
    // Only the focused (no) row is lit; the yes row rests.
    expect(html).not.toContain(`rgba(${FROG.danger}, 0.14)`)
  })
})
