import { describe, it, expect } from 'vitest'
import { typeColor, statPercent, statTotal, filterDex, STAT_LABELS, STAT_ORDER } from './pokedex.js'

describe('typeColor', () => {
  it('returns a colour per known type and a fallback', () => {
    expect(typeColor('fire')).toMatch(/^#/)
    expect(typeColor('water')).not.toBe(typeColor('fire'))
    expect(typeColor('unknown-type')).toMatch(/^#/)
  })
})

describe('statPercent', () => {
  it('scales a base stat to 0..100 against ~180', () => {
    expect(statPercent(90)).toBe(50)
    expect(statPercent(180)).toBe(100)
    expect(statPercent(255)).toBe(100) // clamps
    expect(statPercent(0)).toBe(0)
    expect(statPercent(undefined)).toBe(0)
  })
})

describe('statTotal', () => {
  it('sums the six base stats', () => {
    expect(statTotal({ hp: 78, attack: 84, defense: 78, 'special-attack': 109, 'special-defense': 85, speed: 100 })).toBe(534)
  })
  it('is 0 for missing/empty', () => {
    expect(statTotal(null)).toBe(0)
    expect(statTotal({})).toBe(0)
  })
})

describe('filterDex', () => {
  const list = [
    { display: 'Bulbasaur', number: 1 },
    { display: 'Charizard', number: 6 },
    { display: 'Pikachu', number: 25 },
  ]
  it('returns all for an empty query', () => {
    expect(filterDex(list, '')).toHaveLength(3)
    expect(filterDex(list, '  ')).toHaveLength(3)
  })
  it('matches by name substring, case-insensitive', () => {
    expect(filterDex(list, 'char').map((p) => p.display)).toEqual(['Charizard'])
    expect(filterDex(list, 'CHU').map((p) => p.display)).toEqual(['Pikachu'])
  })
  it('matches by dex number', () => {
    expect(filterDex(list, '25').map((p) => p.display)).toEqual(['Pikachu'])
  })
  it('tolerates null', () => {
    expect(filterDex(null, 'x')).toEqual([])
  })
})

describe('stat metadata', () => {
  it('labels + orders the six base stats', () => {
    expect(STAT_ORDER).toHaveLength(6)
    expect(STAT_ORDER.every((k) => STAT_LABELS[k])).toBe(true)
  })
})
