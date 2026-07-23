import { describe, it, expect } from 'vitest'
import { renderToString } from 'react-dom/server'
import Button from './Button.jsx'
import Heading from './Heading.jsx'
import EmptyState from './EmptyState.jsx'
import ModalScrim from './ModalScrim.jsx'
import { FinishedBadge, HackBadge, HackTag } from './badges.jsx'
import { FROG, SCRIM } from './theme.js'

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

  it('solid takes an accent override (the confirm gate passes danger)', () => {
    const html = renderToString(<Button variant="solid" accent={FROG.danger}>Delete</Button>)
    expect(html).toContain(`rgb(${FROG.danger})`)
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

describe('badges', () => {
  it('renders the ribbons and the inline tag from one source', () => {
    expect(renderToString(<FinishedBadge />)).toContain('Finished')
    expect(renderToString(<HackBadge />)).toContain('HACK')
    expect(renderToString(<HackTag />)).toContain('HACK')
  })
})
