// Pure helpers for the Pokédex panel — type colours, stat-bar scaling, list filtering.
// No IO, so they're unit-tested directly.

// The canonical Pokémon type colours, for the type badges. A slightly muted set that
// reads on the green-black FROG ground.
const TYPE_COLORS = {
  normal: '#9099a1', fire: '#ff9c54', water: '#4d90d5', electric: '#f3d23b',
  grass: '#63bb5b', ice: '#74cec0', fighting: '#ce4069', poison: '#ab6ac8',
  ground: '#d97746', flying: '#8fa8dd', psychic: '#f97176', bug: '#90c12c',
  rock: '#c7b78b', ghost: '#5269ac', dragon: '#0a6dc4', dark: '#5a5366',
  steel: '#5a8ea1', fairy: '#ec8fe6',
}

export function typeColor(type) {
  return TYPE_COLORS[type] || '#7a8a82'
}

// Short labels for the six base stats (PokeAPI's slug -> a compact bar label).
export const STAT_LABELS = {
  hp: 'HP', attack: 'Atk', defense: 'Def',
  'special-attack': 'SpA', 'special-defense': 'SpD', speed: 'Spe',
}
export const STAT_ORDER = ['hp', 'attack', 'defense', 'special-attack', 'special-defense', 'speed']

// A base stat -> a 0..100 bar width. Base stats run 1..255 but cluster 30..150, so scale
// against a full-ish 180 (a 180+ stat maxes the bar) for a readable spread rather than
// everything looking short against 255.
export function statPercent(value, max = 180) {
  if (!value || value < 0) return 0
  return Math.max(0, Math.min(100, Math.round((value / max) * 100)))
}

// The base-stat total (the "BST" everyone compares), summed over the stats present.
export function statTotal(stats) {
  if (!stats) return 0
  return STAT_ORDER.reduce((sum, k) => sum + (stats[k] || 0), 0)
}

// Filter a dex list by a query — matches the display name (substring, case-insensitive)
// or the dex number. Empty query returns the list unchanged.
export function filterDex(list, query) {
  const s = (query || '').trim().toLowerCase()
  if (!s) return list || []
  return (list || []).filter(
    (p) => (p.display || '').toLowerCase().includes(s) || String(p.number).includes(s)
  )
}
