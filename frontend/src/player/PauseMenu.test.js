import { describe, it, expect } from 'vitest'
import { pauseItems } from './PauseMenu.jsx'

const ids = (opts) => pauseItems(false, opts).map((i) => i.id)

describe('pauseItems', () => {
  it('offers "Set as Cover" always', () => {
    expect(ids({ hasCustomCover: false })).toContain('setCover')
    expect(ids({})).toContain('setCover')
  })

  it('offers "Reset Cover" only when the game already has a user-set cover', () => {
    expect(ids({ hasCustomCover: false })).not.toContain('resetCover')
    expect(ids({ hasCustomCover: true })).toContain('resetCover')
  })

  it('drops Fullscreen where there is no fullscreen API', () => {
    expect(ids({ canFullscreen: false })).not.toContain('fullscreen')
    expect(ids({ canFullscreen: true })).toContain('fullscreen')
  })
})
