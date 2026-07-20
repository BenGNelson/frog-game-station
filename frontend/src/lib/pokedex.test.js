import { describe, it, expect } from 'vitest'
import { typeColor, statPercent, statTotal, filterDex, stepDexBlock, dexScrollStep, STAT_LABELS, STAT_ORDER } from './pokedex.js'

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

describe('stepDexBlock', () => {
  // decades: idx0-2 -> #1..#5 (decade 0), idx3-4 -> #11,#15 (decade 1), idx5-6 -> #21,#25 (decade 2)
  const list = [
    { number: 1 }, { number: 2 }, { number: 5 },
    { number: 11 }, { number: 15 },
    { number: 21 }, { number: 25 },
  ]
  it('steps forward to the next decade’s first row', () => {
    expect(stepDexBlock(list, 0, 1)).toBe(3) // decade 0 -> decade 1
    expect(stepDexBlock(list, 3, 1)).toBe(5) // decade 1 -> decade 2
  })
  it('from mid-decade, a back-press lands on the decade top first', () => {
    expect(stepDexBlock(list, 2, -1)).toBe(0) // mid decade 0 -> its top
    expect(stepDexBlock(list, 4, -1)).toBe(3) // mid decade 1 -> its top
  })
  it('from a decade top, a back-press moves a decade', () => {
    expect(stepDexBlock(list, 3, -1)).toBe(0) // decade 1 top -> decade 0
  })
  it('never wraps — pins at each end', () => {
    expect(stepDexBlock(list, 0, -1)).toBe(0) // already at the start
    expect(stepDexBlock(list, 5, 1)).toBe(list.length - 1) // past the last decade
  })
  it('is safe on an empty list', () => {
    expect(stepDexBlock([], 0, 1)).toBe(0)
  })
})

describe('dexScrollStep', () => {
  it('is one row for a tap, then ramps with a sustained hold', () => {
    expect(dexScrollStep(1)).toBe(1)
    expect(dexScrollStep(4)).toBe(1)
    expect(dexScrollStep(5)).toBe(2)
    expect(dexScrollStep(10)).toBe(2)
    expect(dexScrollStep(11)).toBe(4)
  })
})
