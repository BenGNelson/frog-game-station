import { useRef } from 'react'
import { ArrowBigUp, Check, Delete } from 'lucide-react'
import { useFocusTrap } from '../lib/useFocusTrap.js'
import { ROWS, effectiveCaps } from '../lib/keyboard.js'
import { FROG } from './theme.js'

// FROG GAME STATION — the on-screen keyboard.
//
// The board a controller types on when there's free text to write that isn't a search:
// a new collection's name, a save state's label or note. Touch never sees it (a finger
// gets the device's own keyboard, same as search); this is the couch's answer to "I
// have no keyboard and I need to name this".
//
// Presentational, like every other Frog Game Station screen: FrogBrowser owns the text, the cursor,
// and the shift, and routes D-pad / keyboard / click all through the same `applyKey`.
// This draws the draft and the board, lights the key under the cursor, and reports
// hovers and presses back. The letters relabel to the case they'll actually produce,
// so what you see on the key is what lands in the field.
export default function Keyboard({ title, text, placeholder, pos, shift, accent, onHover, onPress, onClose }) {
  const panelRef = useRef(null)
  useFocusTrap(panelRef)
  const caps = effectiveCaps(text, shift)

  return (
    <div
      data-testid="frog-keyboard"
      className="absolute inset-0 z-40 flex items-center justify-center p-4 sm:p-6"
      style={{ background: 'rgba(5, 17, 13, 0.82)', backdropFilter: 'blur(3px)' }}
      onClick={onClose}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        className="w-full max-w-md rounded-2xl p-5 outline-none"
        style={{ background: FROG.panel, border: `1px solid ${FROG.line}`, boxShadow: '0 20px 60px rgba(0,0,0,0.6)' }}
        onClick={(e) => e.stopPropagation()}
      >
        <p className="px-1 text-sm font-semibold" style={{ color: FROG.ink }}>
          {title}
        </p>

        {/* The draft — the text you're building, with a pulsing caret so an empty
            field still reads as alive (the same invite the search field wears). */}
        <div
          className="mb-4 mt-2 flex min-h-[2.75rem] items-center gap-1 rounded-xl px-4 py-2"
          style={{ background: FROG.ground, border: `1px solid ${FROG.line}` }}
        >
          <span className="break-words text-base font-semibold tracking-wide" style={{ color: text ? FROG.ink : FROG.faint }}>
            {text || placeholder || 'Type…'}
          </span>
          <span
            className="frog-invite ml-0.5 inline-block h-5 w-0.5 shrink-0"
            style={{ background: `rgb(${accent})` }}
            aria-hidden="true"
          />
        </div>

        {/* The board. Every row is a flex row so the function keys can flex wider than
            the character keys; the cursor is a single lit key wherever { r, c } points. */}
        <div className="flex flex-col gap-1.5" role="group" aria-label="On-screen keyboard">
          {ROWS.map((row, r) => (
            <div key={r} className="flex gap-1.5">
              {row.map((key, c) => (
                <Key
                  key={c}
                  keyDef={key}
                  caps={caps}
                  shift={shift}
                  on={pos.r === r && pos.c === c}
                  accent={accent}
                  onHover={() => onHover(r, c)}
                  onPress={() => onPress(r, c)}
                />
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

// One key. Character keys are square-ish and show the case they'll type; the function
// keys carry an icon (or the space bar's width) and grow to fill the row.
function Key({ keyDef, caps, shift, on, accent, onHover, onPress }) {
  const fn = typeof keyDef === 'object' ? keyDef.fn : null
  // The armed Shift key stays lit even when the cursor is elsewhere, so you can see
  // the next letter will be forced-cased before you commit to it.
  const active = on || (fn === 'shift' && shift)
  const base = {
    background: active ? `rgb(${accent})` : FROG.ground,
    color: active ? FROG.ground : FROG.soft,
    boxShadow: on ? `0 0 18px rgba(${accent}, 0.6)` : 'none',
    border: `1px solid ${on ? `rgb(${accent})` : FROG.line}`,
  }
  const common = 'flex h-11 items-center justify-center rounded-lg text-base font-semibold transition-colors'

  if (!fn) {
    const glyph = /[a-z]/i.test(keyDef) ? (caps ? keyDef.toUpperCase() : keyDef.toLowerCase()) : keyDef
    return (
      <button type="button" onMouseMove={onHover} onClick={onPress} className={`${common} flex-1`} style={base}>
        {glyph}
      </button>
    )
  }

  const grow = fn === 'space' ? 'flex-[4]' : 'flex-[1.4]'
  const label = { shift: 'Shift', space: 'Space', backspace: 'Backspace', done: 'Done' }[fn]
  const Icon = { shift: ArrowBigUp, backspace: Delete, done: Check }[fn]
  return (
    <button
      type="button"
      aria-label={label}
      onMouseMove={onHover}
      onClick={onPress}
      className={`${common} ${grow} gap-1.5`}
      style={base}
    >
      {Icon && <Icon className="h-5 w-5" aria-hidden="true" />}
      {fn === 'space' && <span className="text-xs font-medium tracking-wide">space</span>}
      {fn === 'done' && <span className="text-sm">Done</span>}
    </button>
  )
}
