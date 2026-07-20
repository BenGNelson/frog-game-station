import { describe, it, expect } from 'vitest'
import { pauseItems } from './PauseMenu.jsx'

const ids = (opts) => pauseItems(false, opts).map((i) => i.id)

describe('pauseItems', () => {
  it('merges Save and Load into one "states" row that opens the shelf', () => {
    const list = ids({})
    expect(list).toContain('states')
    // The old separate Save/Load tiles are gone — the shelf does both.
    expect(list).not.toContain('save')
    expect(list).not.toContain('load')
  })

  it('no longer carries the cover actions (they moved into the save shelf)', () => {
    expect(ids({})).not.toContain('setCover')
    expect(ids({ hasCustomCover: true })).not.toContain('resetCover')
  })

  it('keeps a stable order: Resume always first, Quit always last', () => {
    for (const opts of [{}, { canFullscreen: false }, { isPokemon: true }, { canFullscreen: false, isPokemon: true }]) {
      const list = ids(opts)
      expect(list[0]).toBe('resume')
      expect(list[list.length - 1]).toBe('quit')
    }
  })

  it('groups every item into a section (nav walks the flat list, headers are cosmetic)', () => {
    for (const item of pauseItems(false, { isPokemon: true })) {
      expect(item.section).toBeTruthy()
    }
  })

  it('drops Fullscreen where there is no fullscreen API', () => {
    expect(ids({ canFullscreen: false })).not.toContain('fullscreen')
    expect(ids({ canFullscreen: true })).toContain('fullscreen')
  })

  it('offers the Pokédex only for Pokémon games', () => {
    expect(ids({ isPokemon: false })).not.toContain('pokedex')
    expect(ids({ isPokemon: true })).toContain('pokedex')
  })
})
