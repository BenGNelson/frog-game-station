import { describe, it, expect } from 'vitest'
import { renderToString } from 'react-dom/server'
import Storage from './Storage.jsx'
import { summarizeStorage } from '../lib/offlineStore.js'

// Render smoke for the Downloads & Storage screen, over the REAL summarizeStorage
// shape (so a change to the accounting contract shows up here, not just in lib tests).

const entries = [
  { key: 'games:zelda', section: 'games', id: 'zelda', name: 'Zelda', bytes: 1_400_000, date: Date.now() - 120_000 },
  { key: 'games:mario', section: 'games', id: 'mario', name: 'Mario', bytes: 84_000_000, date: Date.now() - 3 * 86_400_000 },
  { key: 'emulator:engine', section: 'emulator', id: 'engine', name: 'Emulator engine', bytes: 900_000 },
]
// usage ≈ the accounted total (86.9 MB), so the base fixture has no "Unaccounted" line.
const data = summarizeStorage(entries, { usage: 87_000_000, quota: 12_000_000_000 }, 500_000, 128_000)
const noop = () => {}
const base = { data, audit: null, focus: 'verify', onFocus: noop, onRemove: noop, onVerify: noop, onRemoveAll: noop, confirm: null, onConfirmYes: noop, onConfirmNo: noop }

describe('Storage', () => {
  it('shows the device breakdown and the usage-of-quota line', () => {
    const html = renderToString(<Storage {...base} />)
    expect(html).toContain('On this device')
    expect(html).toContain('87 MB used')
    expect(html).toContain('of 12 GB allowed')
    expect(html).toContain('Games (2)') // the engine is its own line, not an item
    expect(html).toContain('Emulator engine')
    expect(html).toContain('App shell')
    expect(html).toContain('Game saves')
    expect(html).not.toContain('Unaccounted') // dust stays invisible
  })

  it('lists each downloaded game with size, age, and a remove control', () => {
    const html = renderToString(<Storage {...base} />)
    expect(html).toContain('Zelda')
    expect(html).toContain('1.4 MB')
    expect(html).toContain('downloaded 2m ago')
    expect(html).toContain('frog-storage-remove-zelda')
    expect(html).toContain('frog-storage-remove-mario')
  })

  it('marks the controller cursor row and only that row', () => {
    const html = renderToString(<Storage {...base} focus="games:zelda" />)
    // The row and its (focused) remove button both wear the marker.
    expect((html.match(/data-focused="true"/g) || []).length).toBe(2)
  })

  it('surfaces a large unaccounted figure but hides float dust', () => {
    const leaky = summarizeStorage(entries, { usage: 500_000_000, quota: 1e9 }, 0, 0)
    const html = renderToString(<Storage {...base} data={leaky} />)
    expect(html).toContain('Unaccounted')
  })

  it('reads the audit verdict both ways', () => {
    const clean = renderToString(<Storage {...base} audit={{ clean: true, orphans: [], missing: [] }} />)
    expect(clean).toContain('Every byte accounted for.')
    const dirty = renderToString(<Storage {...base} audit={{ clean: false, orphans: ['a'], missing: ['b', 'c'] }} />)
    expect(dirty).toContain('1 stray file')
    expect(dirty).toContain('2 missing files')
  })

  it('empty library: the mascot empty state, and Remove all still offered for engine/saves', () => {
    const empty = summarizeStorage([], {}, 0, 0)
    const html = renderToString(<Storage {...base} data={empty} />)
    expect(html).toContain('frog-storage-empty')
    expect(html).toContain('Nothing downloaded yet.')
  })

  it('stacks the confirm gate over the screen when a removal is pending', () => {
    const html = renderToString(<Storage {...base} confirm={{ kind: 'storageRemove', key: 'games:zelda', name: 'Zelda' }} />)
    expect(html).toContain('Remove Zelda from this device?')
    const all = renderToString(<Storage {...base} confirm={{ kind: 'storageAll' }} />)
    expect(all).toContain('Remove every download from this device?')
  })
})
