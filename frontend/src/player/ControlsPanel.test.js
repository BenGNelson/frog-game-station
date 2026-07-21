import { describe, it, expect } from 'vitest'
import { controlRows } from './ControlsPanel.jsx'

describe('controlRows', () => {
  it('includes the Fast Forward shortcut, before Reset', () => {
    const rows = controlRows(false)
    expect(rows).toContain('fastForward')
    expect(rows.indexOf('fastForward')).toBeLessThan(rows.indexOf('reset'))
    // Reset is always last.
    expect(rows[rows.length - 1]).toBe('reset')
  })

  it('shows the Pokédex shortcut only for Pokémon games', () => {
    expect(controlRows(false)).not.toContain('pokedex')
    expect(controlRows(true)).toContain('pokedex')
  })

  it('walks schemes, then the bindable game buttons, then the shortcuts', () => {
    const rows = controlRows(false)
    expect(rows.slice(0, 2)).toEqual(['letters', 'positions'])
    // The seven rebindable game buttons sit between the schemes and the shortcuts.
    expect(rows.filter((r) => r.startsWith('bind:')).length).toBe(7)
    expect(rows.indexOf('bind:8')).toBeLessThan(rows.indexOf('wiki'))
  })

  it('puts the pad-skin row after the schemes and before the game buttons', () => {
    const rows = controlRows(false)
    expect(rows).toContain('skin')
    expect(rows.indexOf('skin')).toBe(2) // right after 'letters', 'positions'
    expect(rows.indexOf('skin')).toBeLessThan(rows.indexOf('bind:8'))
  })
})
