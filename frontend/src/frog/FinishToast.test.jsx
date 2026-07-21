import { describe, it, expect } from 'vitest'
import { renderToString } from 'react-dom/server'
import FinishToast from './FinishToast.jsx'

// Render smoke for the "finished!" celebration. It seeds `shown` from the initial tick so a
// server-render shows the toast without the effect (matching the panel render-smoke idiom),
// which is exactly what lets us assert its content here.
describe('FinishToast', () => {
  it('renders nothing before any game is finished (tick 0)', () => {
    expect(renderToString(<FinishToast tick={0} />)).toBe('')
  })

  it('celebrates once a game is marked finished (tick > 0)', () => {
    const html = renderToString(<FinishToast tick={1} />)
    expect(html).toContain('One more in the books')
    expect(html).toContain('frog-hop') // the mascot bounces
    expect(html).toContain('role="status"') // and it's announced to assistive tech
  })
})
