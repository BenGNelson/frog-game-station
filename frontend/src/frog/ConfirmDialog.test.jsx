import { describe, it, expect } from 'vitest'
import { renderToString } from 'react-dom/server'
import ConfirmDialog from './ConfirmDialog.jsx'

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
})
