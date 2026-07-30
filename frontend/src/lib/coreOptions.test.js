import { describe, it, expect } from 'vitest'
import { CURATED_OPTIONS, curatedRows, hasCuratedOptions, stepOptionValue, valueLabel } from './coreOptions.js'

// What the host reports for a key: every value the core declared, plus where it
// currently stands.
const host = (key, values, current = values[0], defaultValue = values[0]) => ({
  key,
  label: key,
  values,
  current,
  defaultValue,
})

describe('curatedRows', () => {
  it('offers only what the shortlist names AND the running core registered', () => {
    const rows = curatedRows('psx', [
      host('pcsx_rearmed_pad1type', ['standard', 'analog'], 'analog'),
      // Registered by the core but not curated — an emulator's config dialog is
      // not a preference screen.
      host('pcsx_rearmed_frameskip', ['0', '1', '2']),
    ])
    expect(rows.map((r) => r.key)).toEqual(['pcsx_rearmed_pad1type'])
    expect(rows[0].current).toBe('analog')
  })

  it('drops a curated key this core does not offer instead of showing a dead row', () => {
    // Cores change. A row that can do nothing is worse than no row.
    expect(curatedRows('n64', [])).toEqual([])
    expect(curatedRows('nds', [host('melonds_screen_layout', [])])).toEqual([])
  })

  it('narrows a long value list to the shortlist', () => {
    // melonDS's screen gap offers 0..126; a cycle row is not a slider.
    const all = Array.from({ length: 127 }, (_, i) => String(i))
    const rows = curatedRows('nds', [host('melonds_screen_gap', all)])
    expect(rows[0].values).toEqual(['0', '8', '16', '32', '64'])
  })

  it('falls back to the full list rather than an empty cycle when nothing intersects', () => {
    // A core that renamed or reordered its values must not leave arrows that
    // can't move — the same rule as clampShader falling back to a real step.
    const rows = curatedRows('nds', [host('melonds_screen_gap', ['none', 'small', 'large'])])
    expect(rows[0].values).toEqual(['none', 'small', 'large'])
  })

  it('keeps a stored value reachable even when the shortlist excludes it', () => {
    const all = Array.from({ length: 127 }, (_, i) => String(i))
    const rows = curatedRows('nds', [host('melonds_screen_gap', all, '90')])
    expect(rows[0].current).toBe('90')
    expect(rows[0].values).toContain('90') // the arrows can return to it
  })

  it('carries the applies-next-launch flag only where the table sets it', () => {
    const n64 = curatedRows('n64', [host('mupen64plus-rdp-plugin', ['angrylion', 'gliden64'])])
    expect(n64[0].appliesOnRelaunch).toBe(true)
    const psx = curatedRows('psx', [host('pcsx_rearmed_pad1type', ['standard', 'analog'])])
    expect(psx[0].appliesOnRelaunch).toBe(false)
  })

  it('a system with nothing curated shows no System options row at all', () => {
    expect(hasCuratedOptions('nes', [host('fceumm_overscan', ['enabled', 'disabled'])])).toBe(false)
    expect(hasCuratedOptions('psx', [host('pcsx_rearmed_pad1type', ['standard', 'analog'])])).toBe(true)
  })
})

describe('the curated table', () => {
  it('offers the DS screen layout — the carry-over row 7 parked here', () => {
    // Pinned by test rather than by prose: this is the whole reason the DS
    // options were deferred to row 9.
    expect(CURATED_OPTIONS.nds.map((o) => o.key)).toContain('melonds_screen_layout')
  })

  it('keys every system by the id the player actually launches with', () => {
    // The backend's SECTIONS ids — a typo here means a row that never appears.
    const known = ['gb', 'gbc', 'gba', 'nes', 'snes', 'segaMD', 'segaMS', 'segaGG', 'nds', 'n64', 'psx']
    for (const system of Object.keys(CURATED_OPTIONS)) expect(known).toContain(system)
  })
})

describe('stepOptionValue', () => {
  const row = { values: ['a', 'b', 'c'], current: 'b' }

  it('steps both ways and wraps, like the filter and turbo cycles', () => {
    expect(stepOptionValue(row, 1)).toBe('c')
    expect(stepOptionValue(row, -1)).toBe('a')
    expect(stepOptionValue({ ...row, current: 'c' }, 1)).toBe('a')
    expect(stepOptionValue({ ...row, current: 'a' }, -1)).toBe('c')
  })

  it('lands on a real value when the current one is unknown', () => {
    expect(stepOptionValue({ ...row, current: 'gone' }, 1)).toBe('b')
  })

  it('is inert on a row with nothing to step through', () => {
    expect(stepOptionValue({ values: [], current: 'x' }, 1)).toBe('x')
    expect(stepOptionValue(undefined, 1)).toBeUndefined()
  })
})

describe('valueLabel', () => {
  it('prefers the friendly name and falls back to the core’s own string', () => {
    const rows = curatedRows('n64', [host('mupen64plus-rdp-plugin', ['angrylion', 'gliden64'])])
    expect(valueLabel(rows[0], 'angrylion')).toBe('Software (accurate)')
    // melonDS's own strings are already readable — no table needed.
    const nds = curatedRows('nds', [host('melonds_screen_layout', ['Top/Bottom', 'Left/Right'])])
    expect(valueLabel(nds[0])).toBe('Top/Bottom')
  })
})
