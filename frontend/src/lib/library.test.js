import { describe, it, expect } from 'vitest'
import {
  fileUrl,
  coverUrl,
  saveStatesUrl,
  saveStateUrl,
  saveStateShotUrl,
  playerSrc,
  naturalCompare,
  sectionAccent,
  gameOfflineUrls,
  systemGames,
  letterOf,
  gameMetaUrl,
  igdbShotUrl,
} from './library.js'

describe('naturalCompare', () => {
  it('orders embedded numbers numerically', () => {
    expect(['ch10', 'ch2', 'ch1'].sort(naturalCompare)).toEqual(['ch1', 'ch2', 'ch10'])
  })
})

describe('fileUrl', () => {
  it('encodes section + id as query params', () => {
    expect(fileUrl('games', 'sub/My Game.gb')).toBe(
      '/api/library/file?section=games&id=sub%2FMy%20Game.gb'
    )
  })
})

describe('coverUrl', () => {
  it('points at the cover proxy with the encoded id', () => {
    expect(coverUrl('Metroid Fusion (USA).gba')).toBe(
      '/api/library/games/cover?id=Metroid%20Fusion%20(USA).gba'
    )
  })
})

describe('sectionAccent', () => {
  it('gives each known section a constant-palette accent', () => {
    expect(sectionAccent('games').text).toBe('text-violet-300')
    expect(sectionAccent('audiobooks').rgb).toBe('244,63,94')
    expect(sectionAccent('textbooks').text).toBe('text-indigo-300')
  })
  it('falls back to a neutral accent for an unknown section', () => {
    expect(sectionAccent('nope').text).toBe('text-slate-300')
  })
})

describe('playerSrc', () => {
  it('points at emulator.html with core, rom, data, and name', () => {
    const src = playerSrc({ id: 'Tetris.gb', core: 'gb', name: 'Tetris' })
    expect(src.startsWith('/emulator.html?')).toBe(true)
    const q = new URLSearchParams(src.split('?')[1])
    expect(q.get('core')).toBe('gb')
    expect(q.get('rom')).toBe('/api/library/file?section=games&id=Tetris.gb')
    expect(q.get('data')).toBe('/emulatorjs/')
    expect(q.get('name')).toBe('Tetris')
  })
  it('omits name when absent but always carries the game id (gid)', () => {
    const q = new URLSearchParams(playerSrc({ id: 'Tetris.gb', core: 'gb' }).split('?')[1])
    expect(q.has('name')).toBe(false)
    expect(q.get('gid')).toBe('Tetris.gb')
    expect(q.has('loadstate')).toBe(false)
  })
  it('passes a resume-state URL through as loadstate', () => {
    const q = new URLSearchParams(
      playerSrc({ id: 'Tetris.gb', core: 'gb', loadStateUrl: '/api/library/games/save-state?id=Tetris.gb&slot=42' }).split('?')[1]
    )
    expect(q.get('loadstate')).toBe('/api/library/games/save-state?id=Tetris.gb&slot=42')
  })
})

describe('save-state urls', () => {
  it('build list / blob / screenshot urls', () => {
    expect(saveStatesUrl('A B.gba')).toBe('/api/library/games/save-states?id=A%20B.gba')
    expect(saveStateUrl('A B.gba', '99')).toBe('/api/library/games/save-state?id=A%20B.gba&slot=99')
    expect(saveStateShotUrl('A B.gba', '99')).toBe(
      '/api/library/games/save-state/screenshot?id=A%20B.gba&slot=99'
    )
  })
})

describe('igdb metadata urls', () => {
  it('build meta + screenshot urls, encoding ids', () => {
    expect(gameMetaUrl('gb/A B.gb')).toBe('/api/library/games/meta?id=gb%2FA%20B.gb')
    expect(igdbShotUrl('gb/A B.gb', 'sc1abc')).toBe(
      '/api/library/games/screenshot?id=gb%2FA%20B.gb&shot=sc1abc'
    )
  })
})

describe('systemGames', () => {
  const items = [
    { id: 'p10.gb', name: 'Pokemon 10', label: 'Game Boy' },
    { id: 'p2.gb', name: 'Pokemon 2', label: 'Game Boy' },
    { id: 'z.gbc', name: 'Zelda', label: 'Game Boy Color' },
  ]
  it('filters to the system and natural-sorts by name', () => {
    expect(systemGames(items, 'Game Boy').map((g) => g.name)).toEqual(['Pokemon 2', 'Pokemon 10'])
  })
  it('unknown system → []', () => {
    expect(systemGames(items, 'SNES')).toEqual([])
  })
})

describe('letterOf', () => {
  it('uppercases the first letter', () => {
    expect(letterOf('Zelda')).toBe('Z')
    expect(letterOf('mario')).toBe('M')
  })
  it('buckets numbers, symbols, and empties under #', () => {
    expect(letterOf('007')).toBe('#')
    expect(letterOf('  spaced')).toBe('S') // leading space trimmed
    expect(letterOf('!bang')).toBe('#')
    expect(letterOf('')).toBe('#')
    expect(letterOf(undefined)).toBe('#')
  })
  it('buckets accented titles under their base letter (matches the sort)', () => {
    expect(letterOf('Élevator')).toBe('E')
    expect(letterOf('Über Blaster')).toBe('U')
    expect(letterOf('Ñu')).toBe('N')
  })
})

describe('gameOfflineUrls', () => {
  // The offline cache must fetch the SAME libretro core file the online loader
  // picks by default for each EmulatorJS system (src/emulator.js's core table).
  const coreFile = (core) => {
    const u = gameOfflineUrls('X', core).find((url) => url.includes('/cores/') && url.endsWith('-wasm.data'))
    return u.split('/cores/')[1].replace('-wasm.data', '')
  }
  it('maps each system to its default libretro core', () => {
    expect(coreFile('gb')).toBe('gambatte')
    expect(coreFile('gba')).toBe('mgba')
    expect(coreFile('nes')).toBe('fceumm')
    expect(coreFile('snes')).toBe('snes9x')
    expect(coreFile('segaMD')).toBe('genesis_plus_gx')
    expect(coreFile('segaGG')).toBe('genesis_plus_gx')
    // Master System defaults to smsplus, NOT genesis_plus_gx
    expect(coreFile('segaMS')).toBe('smsplus')
  })
  it('includes the ROM, both wasm variants, and the core report', () => {
    const urls = gameOfflineUrls('Sonic.md', 'segaMD')
    expect(urls.some((u) => u.includes('library/file') && u.includes('Sonic.md'))).toBe(true)
    expect(urls).toContain('/emulatorjs/cores/genesis_plus_gx-wasm.data')
    expect(urls).toContain('/emulatorjs/cores/genesis_plus_gx-legacy-wasm.data')
    expect(urls).toContain('/emulatorjs/cores/reports/genesis_plus_gx.json')
  })
})
