import { describe, it, expect } from 'vitest'
import { renderToString } from 'react-dom/server'
import Button from './Button.jsx'
import Heading from './Heading.jsx'
import EmptyState from './EmptyState.jsx'
import ModalScrim from './ModalScrim.jsx'
import DialogPanel from './DialogPanel.jsx'
import ChoiceRow from './ChoiceRow.jsx'
import { FinishedBadge, HackBadge, HackTag } from './badges.jsx'
import { FROG, SCRIM, focusOutline, focusRing } from './theme.js'

// Render smoke + the contracts the theme bible (docs/THEME.md) leans on. These are
// the shared chrome primitives — a crash or a drifted default here would show on
// every screen at once, so each one server-renders its full path.

describe('Button — the Pebble family', () => {
  it('is a pill in every variant', () => {
    for (const variant of ['solid', 'quiet', 'danger']) {
      expect(renderToString(<Button variant={variant}>Go</Button>)).toContain('rounded-full')
    }
  })

  it('marks the controller cursor via data-focused and swells only then', () => {
    const rest = renderToString(<Button>Go</Button>)
    expect(rest).not.toContain('data-focused')
    expect(rest).not.toContain('scale(1.04)')
    const focused = renderToString(<Button focused>Go</Button>)
    expect(focused).toContain('data-focused="true"')
    expect(focused).toContain('scale(1.04)')
  })

  // No screen passes solid+danger any more — ConfirmDialog was rebuilt on ChoiceRow and
  // imports no Button at all — so this is a primitive-level contract, not a live caller.
  it('solid takes an accent override', () => {
    const html = renderToString(<Button variant="solid" accent={FROG.danger}>Delete</Button>)
    expect(html).toContain(`rgb(${FROG.danger})`)
  })

  // THE REGRESSION PIN. Focus used to be spoken only in the accent, so a solid-danger
  // button drew a red glow on a red fill and its highlight vanished. Every variant must
  // now carry the SAME cursor outline, whatever its accent is doing.
  it('every variant wears the same focus cursor, regardless of accent', () => {
    const { outline } = focusOutline()
    const cases = [
      ['solid', FROG.jade],
      ['solid', FROG.danger], // the combination that used to disappear
      ['quiet', FROG.jade],
      ['danger', FROG.danger],
    ]
    for (const [variant, accent] of cases) {
      const focused = renderToString(
        <Button variant={variant} accent={accent} focused>Go</Button>
      )
      expect(focused, `${variant}/${accent} focused`).toContain(outline)
      const rest = renderToString(<Button variant={variant} accent={accent}>Go</Button>)
      expect(rest, `${variant}/${accent} unfocused`).not.toContain(outline)
    }
  })

  // ...and the outline is ADDITIVE, not a replacement. That word carries the whole
  // design — the accent stays as the secondary signal, so focus keeps its warmth and its
  // system identity. Without this, stripping every per-variant treatment (a plausible
  // "the outline is the cursor now, the glow is redundant" cleanup) left the suite green
  // and landed back on a single-channel cursor.
  it('keeps each variant its own accent treatment underneath the cursor', () => {
    const solid = renderToString(<Button variant="solid" accent={FROG.jade} focused>Go</Button>)
    expect(solid).toContain(`0 0 26px rgba(${FROG.jade}, 0.55)`)
    const quiet = renderToString(<Button variant="quiet" accent={FROG.jade} focused>Go</Button>)
    expect(quiet).toContain(focusRing(FROG.jade))
    const danger = renderToString(<Button variant="danger" focused>Go</Button>)
    expect(danger).toContain(focusRing(FROG.danger))
  })
})

describe('Heading', () => {
  it('uppercases string children and wears the display face', () => {
    const html = renderToString(<Heading>Continue playing</Heading>)
    expect(html).toContain('CONTINUE PLAYING')
    expect(html).toContain('Fredoka')
  })
})

describe('EmptyState', () => {
  it('renders the mascot with the title and prose', () => {
    const html = renderToString(
      <EmptyState title="No saved states yet." testid="t-empty">
        Save one here.
      </EmptyState>
    )
    expect(html).toContain('No saved states yet.')
    expect(html).toContain('Save one here.')
    expect(html).toContain('svg') // the frog
  })
})

describe('ModalScrim', () => {
  it('sinks to the named depth and stacks where asked', () => {
    const html = renderToString(<ModalScrim depth="sheet" z="z-40" testid="t-scrim">x</ModalScrim>)
    expect(html).toContain(`rgba(${FROG.groundRGB}, ${SCRIM.sheet})`)
    expect(html).toContain('z-40')
  })
})

// The dialog family. Every modal in the app is these two components plus rows, so a
// drift here restyles five dialogs at once — which is the point, and the reason they
// are pinned.
describe('DialogPanel', () => {
  it('is a dialog on a scrim, labelled by its own title', () => {
    const html = renderToString(
      <DialogPanel testid="t-dialog" title="Collections" titleId="t-title" subtitle="Group your games.">
        body
      </DialogPanel>
    )
    expect(html).toContain('data-testid="t-dialog"')
    expect(html).toContain('role="dialog"')
    expect(html).toContain('aria-modal="true"')
    expect(html).toContain('aria-labelledby="t-title"')
    expect(html).toContain('Collections')
    expect(html).toContain('Group your games.')
    expect(html).toContain('body')
  })

  it('falls back to aria-label when it has no title element to point at', () => {
    const html = renderToString(<DialogPanel ariaLabel="Save state">x</DialogPanel>)
    expect(html).toContain('aria-label="Save state"')
    expect(html).not.toContain('aria-labelledby')
  })

  it('takes its padding as a prop, because Tailwind resolves p-4 vs p-5 by stylesheet order', () => {
    expect(renderToString(<DialogPanel pad="p-4">x</DialogPanel>)).toContain('p-4')
    expect(renderToString(<DialogPanel>x</DialogPanel>)).toContain('p-5')
  })
})

describe('ChoiceRow', () => {
  it('wears the cursor outline only when focused', () => {
    const { outline } = focusOutline()
    expect(renderToString(<ChoiceRow label="Load" focused />)).toContain(outline)
    expect(renderToString(<ChoiceRow label="Load" />)).not.toContain(outline)
  })

  it('tints in danger without ever filling solid', () => {
    const html = renderToString(<ChoiceRow label="Delete" danger focused />)
    expect(html).toContain(`rgba(${FROG.danger}, 0.14)`)
    expect(html).not.toContain(`background:rgb(${FROG.danger})`)
  })

  it('rests with a hairline as a menu row and without one as a list row', () => {
    // A handful of actions read as a set of boxes; a dozen scrolling options do not.
    expect(renderToString(<ChoiceRow label="Cancel" />)).toContain(FROG.line)
    expect(renderToString(<ChoiceRow label="Chrono Trigger" variant="list" />)).toContain('transparent')
  })

  it('takes children in place of the label, for rows that are more than text', () => {
    const html = renderToString(
      <ChoiceRow trailing={<span>tick</span>}>
        <span>custom body</span>
      </ChoiceRow>
    )
    expect(html).toContain('custom body')
    expect(html).toContain('tick')
  })

  it('falls back to the label when conditional children evaluate to false', () => {
    // `{cond && <X/>}` passes `false`, which `??` would let through as an empty row.
    const html = renderToString(<ChoiceRow label="Pin to top">{false}</ChoiceRow>)
    expect(html).toContain('Pin to top')
  })

  it('primary lights a row WITHOUT claiming to be the cursor', () => {
    // The confirm gate's uncontrolled mode has no cursor, so the row Enter commits has
    // to carry weight — but it must never wear the outline, or a pad user would see two
    // "you are here" markers. This is the pair of assertions that keeps those separate.
    const { outline } = focusOutline()
    const html = renderToString(<ChoiceRow label="Delete" danger primary />)
    expect(html).toContain(`rgba(${FROG.danger}, 0.14)`) // lit
    expect(html).not.toContain(outline) // but not the cursor
    expect(html).not.toContain('data-focused')
  })
})

describe('badges', () => {
  it('renders the ribbons and the inline tag from one source', () => {
    expect(renderToString(<FinishedBadge />)).toContain('Finished')
    expect(renderToString(<HackBadge />)).toContain('HACK')
    expect(renderToString(<HackTag />)).toContain('HACK')
  })
})
