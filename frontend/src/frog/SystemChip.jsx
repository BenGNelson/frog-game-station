import { systemStyle } from './theme.js'

// The little system pill — a game's machine, in that machine's colour. Wherever a list
// spans systems (search results, a collection's games), a row can't rely on context to
// say which console it's for, so it wears one of these. One definition, so the search
// list and the collection list can never drift apart.
export default function SystemChip({ label }) {
  const s = systemStyle(label)
  return (
    <span
      className="shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold tracking-wide"
      style={{ color: `rgb(${s.accent})`, background: `rgba(${s.accent}, 0.14)` }}
    >
      {label}
    </span>
  )
}
