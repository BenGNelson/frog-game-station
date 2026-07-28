import { describe, it, expect } from 'vitest'
import { renderToString } from 'react-dom/server'
import React from 'react'
import PauseMenu, { pauseItems } from './PauseMenu.jsx'

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
    // It lives on the Display sub-screen now — still omit-only.
    const display = (o) => pauseItems(false, o, 'display').map((i) => i.id)
    expect(display({ canFullscreen: false })).not.toContain('fullscreen')
    expect(display({ canFullscreen: true })).toContain('fullscreen')
  })

  it('keeps the mid-game rows at the top level and the set-once ones behind Display', () => {
    // The whole point of the split: what you reach for while playing stays one
    // walk away; what you set once is a level down.
    const root = ids({ volume: 0.5, shader: 'CRT', ffRatio: '3×', canFullscreen: true })
    expect(root).toContain('display')
    expect(root).toEqual(expect.arrayContaining(['resume', 'states', 'rewind', 'fastForward', 'volume', 'quit']))
    expect(root).not.toContain('filter')
    expect(root).not.toContain('ffRatio')
    expect(root).not.toContain('fullscreen')
  })

  it('Quit is last, so a wrapping walk reaches it one press up from Resume', () => {
    const root = ids({ volume: 0.5 })
    expect(root[0]).toBe('resume')
    expect(root.at(-1)).toBe('quit')
  })

  it('offers the Pokédex only for Pokémon games', () => {
    expect(ids({ isPokemon: false })).not.toContain('pokedex')
    expect(ids({ isPokemon: true })).toContain('pokedex')
  })

  it('carries a Rewind toggle in Play, right before Fast Forward', () => {
    const items = pauseItems(false, { rewinding: true })
    const rw = items.find((i) => i.id === 'rewind')
    expect(rw.section).toBe('play')
    expect(rw.active).toBe(true) // the On badge while time runs backwards
    const list = items.map((i) => i.id)
    expect(list.indexOf('rewind')).toBe(list.indexOf('fastForward') - 1)
  })

  it('Save Screenshot lives in Snapshots, right after the states row', () => {
    const list = ids({})
    expect(list.indexOf('screenshot')).toBe(list.indexOf('states') + 1)
    // The row is its own feedback: label reflects the last attempt for a beat.
    const saved = pauseItems(false, { shotStatus: 'saved' }).find((i) => i.id === 'screenshot')
    expect(saved.label).toBe('Screenshot saved')
    expect(saved.active).toBe(true)
    const failed = pauseItems(false, { shotStatus: 'failed' }).find((i) => i.id === 'screenshot')
    expect(failed.label).toBe('Nothing to capture')
  })

  it('carries a Filter cycle row only when the shell passes a step label', () => {
    expect(pauseItems(false, {}, 'display').map((i) => i.id)).not.toContain('filter')
    const items = pauseItems(false, { shader: 'CRT', volume: 0.5 }, 'display')
    const f = items.find((i) => i.id === 'filter')
    expect(f.adjust).toBe(true)
    expect(f.control).toBe('cycle')
    expect(f.value).toBe('CRT')
    // In Play, right after the volume — tuning rows sit together.
    const list = items.map((i) => i.id)
    expect(list.indexOf('filter')).toBe(list.indexOf('volume') + 1)
  })

  it('FF Speed is a cycle row on the Display screen', () => {
    expect(pauseItems(false, {}, 'display').map((i) => i.id)).not.toContain('ffRatio')
    const items = pauseItems(false, { ffRatio: '3×' }, 'display')
    const r = items.find((i) => i.id === 'ffRatio')
    expect(r.adjust).toBe(true)
    expect(r.control).toBe('cycle')
  })

  it('System options appear only when the running core registered some', () => {
    expect(pauseItems(false, {}, 'display').map((i) => i.id)).not.toContain('coreOptions')
    expect(pauseItems(false, { hasCoreOptions: true }, 'display').map((i) => i.id)).toContain('coreOptions')
  })

  it('draws exactly the rows it walks, for every options bag', () => {
    // The invariant that broke: the native player spelled its options out twice —
    // once for pauseItems (what the pad walks) and once as <PauseMenu> props (what
    // the player sees) — and the two drifted, so from the first missing row down
    // every index highlighted one action and fired another. Both players now build
    // ONE bag and spread it; this pins that they agree.
    const bags = [
      {},
      { volume: 0.5 },
      { canFullscreen: true, canRewind: true, volume: 0.5, shader: 'CRT', ffRatio: '3×' },
      { canFullscreen: false, canRewind: false, volume: 0.5 },
      { canFullscreen: true, canRewind: true, isPokemon: true, volume: 0.5, shader: 'Off', ffRatio: '2×', hasCoreOptions: true },
    ]
    for (const bag of bags) {
      for (const screen of ['root', 'display']) {
        const html = renderToString(
          React.createElement(PauseMenu, {
            open: true,
            name: 'A Game',
            fastForward: false,
            ...bag,
            screen,
            focus: 0,
            onFocus: () => {},
            onAction: () => {},
          })
        )
        const drawn = html.split('data-testid="pause-row"').length - 1
        expect(drawn).toBe(pauseItems(false, bag, screen).length)
      }
    }
  })

  it('carries a Volume row only when the shell passes a level', () => {
    expect(ids({})).not.toContain('volume')
    expect(ids({ volume: 0.5 })).toContain('volume')
    expect(ids({ volume: 0 })).toContain('volume') // muted is still a level
  })

  it('the volume row is adjustable, sits in Play, and keeps the stable order', () => {
    const items = pauseItems(false, { volume: 0.7 })
    const vol = items.find((i) => i.id === 'volume')
    expect(vol.adjust).toBe(true)
    expect(vol.value).toBe(0.7)
    expect(vol.section).toBe('play')
    const list = items.map((i) => i.id)
    expect(list[0]).toBe('resume')
    expect(list[list.length - 1]).toBe('quit')
    // Right after Fast Forward — the two play-feel controls sit together.
    expect(list.indexOf('volume')).toBe(list.indexOf('fastForward') + 1)
  })
})
