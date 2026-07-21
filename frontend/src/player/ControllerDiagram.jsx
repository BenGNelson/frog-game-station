import { FROG } from '../frog/theme.js'
import { BINDABLE } from '../lib/controlPresets.js'
import { XBOX } from '../lib/gamepad.js'
import { RETROPAD } from '../lib/retropad.js'

// A drawn, frog-themed controller — the Controls screen's hero.
//
// Console art is DRAWN, never scraped (see frog/Console.jsx): one flat look, one light
// source, the rounded language of the frog, a little frog where a real pad prints its logo.
// NO official wordmarks.
//
// The mapping is made to READ. Face buttons wear their real controller colours (bottom
// green / right red / left blue / top amber) and carry the GAME button they trigger, so
// flipping the scheme visibly moves "A" between the bottom and right button. Every other
// button gets a **callout** in the margins — a labelled card joined to the button by a thin
// leader line — showing what it does AND any app shortcut on it (so Fast-Forward bound to
// RB reads "RB · R" with an "FF" badge). Callouts are per-physical-button, so a collision
// shows both game buttons and an off-map rebind still surfaces at that button's card —
// nothing is hidden.
//
// Face buttons, shoulders and Select are interactive (focus/click → rebind); the diagram
// reflects the same linear focus the pad walks (focusedKey), so picture and d-pad agree.

const VW = 520
const VH = 228

const FACE_COLOR = { bottom: '#34d399', right: '#fb7185', left: '#38bdf8', top: '#fbbf24' }

// Button centres on the drawn pad (body spans x≈160–336, centred ~248).
const PAD = {
  LEFT_BOTTOM_SHOULDER: { x: 198, y: 60 }, // LT
  RIGHT_BOTTOM_SHOULDER: { x: 298, y: 60 }, // RT
  LEFT_TOP_SHOULDER: { x: 198, y: 80 }, // LB
  RIGHT_TOP_SHOULDER: { x: 298, y: 80 }, // RB
  LEFT_STICK: { x: 200, y: 122 }, // L3
  RIGHT_STICK: { x: 266, y: 174 }, // R3
  DPAD: { x: 208, y: 168 },
  SELECT: { x: 232, y: 100 },
  BUTTON_4: { x: 302, y: 94, face: 'top' }, // Y
  BUTTON_3: { x: 274, y: 122, face: 'left' }, // X
  BUTTON_2: { x: 330, y: 122, face: 'right' }, // B
  BUTTON_1: { x: 302, y: 150, face: 'bottom' }, // A
}

// Raw browser pad index behind each physical button (for hotkey lookup).
const PHYS_RAW = {
  BUTTON_1: XBOX.A, BUTTON_2: XBOX.B, BUTTON_3: XBOX.X, BUTTON_4: XBOX.Y,
  LEFT_TOP_SHOULDER: XBOX.LB, RIGHT_TOP_SHOULDER: XBOX.RB,
  LEFT_BOTTOM_SHOULDER: XBOX.LT, RIGHT_BOTTOM_SHOULDER: XBOX.RT,
  LEFT_STICK: XBOX.LS, RIGHT_STICK: XBOX.RS, SELECT: XBOX.VIEW,
}

// Peripheral callouts — physical button, gutter side, vertical slot, printed name. Face
// buttons and Select are labelled on the pad itself, so they're absent. R3 sits low on the
// right so its leader passes BELOW the A button instead of crossing it.
const CALLOUTS = [
  { physical: 'LEFT_BOTTOM_SHOULDER', side: 'left', y: 46, name: 'LT' },
  { physical: 'LEFT_TOP_SHOULDER', side: 'left', y: 90, name: 'LB' },
  { physical: 'LEFT_STICK', side: 'left', y: 134, name: 'L3' },
  { physical: 'DPAD', side: 'left', y: 180, name: 'D-pad', fixed: 'Move' },
  { physical: 'RIGHT_BOTTOM_SHOULDER', side: 'right', y: 46, name: 'RT' },
  { physical: 'RIGHT_TOP_SHOULDER', side: 'right', y: 90, name: 'RB' },
  { physical: 'RIGHT_STICK', side: 'right', y: 200, name: 'R3' },
]

const BINDABLE_SET = new Set(BINDABLE.map((b) => b.index))
const RETRO_NAME = {
  [RETROPAD.A]: 'A', [RETROPAD.B]: 'B', [RETROPAD.X]: 'X', [RETROPAD.Y]: 'Y',
  [RETROPAD.L]: 'L', [RETROPAD.R]: 'R', [RETROPAD.L2]: 'L2', [RETROPAD.R2]: 'R2',
  [RETROPAD.SELECT]: 'Select',
}

export default function ControllerDiagram({
  resolved, bindings, listeningFor, wikiHotkey, pokedexHotkey, ffHotkey, isPokemon,
  focusedKey, onFocusKey, onSelectKey,
}) {
  const retroByPhysical = {}
  for (const [idx, phys] of Object.entries(resolved)) {
    const n = Number(idx)
    if (RETRO_NAME[n] == null || !phys) continue
    ;(retroByPhysical[phys] ||= []).push(n)
  }

  const hotkeysAt = (raw) => {
    const out = []
    if (wikiHotkey === raw) out.push('Wiki')
    if (isPokemon && pokedexHotkey === raw) out.push('Dex')
    if (ffHotkey === raw) out.push('FF')
    return out
  }

  const slot = (physical, fixed) => {
    const retros = retroByPhysical[physical] || []
    const bindable = retros.length === 1 && BINDABLE_SET.has(retros[0])
    return {
      label: fixed || (retros.length ? retros.map((i) => RETRO_NAME[i]).join('/') : '—'),
      focused: retros.some((i) => focusedKey === `bind:${i}`),
      listening: retros.some((i) => listeningFor === i),
      custom: retros.some((i) => bindings?.[i] != null),
      key: bindable ? `bind:${retros[0]}` : null,
      hotkeys: hotkeysAt(PHYS_RAW[physical]),
    }
  }

  const jade = `rgb(${FROG.jade})`

  const Callout = ({ physical, side, y, name, fixed }) => {
    const p = PAD[physical]
    const s = slot(physical, fixed)
    const w = 128
    const h = 36
    const x = side === 'left' ? 6 : VW - 6 - w
    const anchorX = side === 'left' ? x + w : x
    const on = s.focused
    const hk = s.hotkeys.join(' / ')
    const interactive = !!s.key
    return (
      <g
        role={interactive ? 'button' : undefined}
        onClick={interactive ? () => onSelectKey(s.key) : undefined}
        onMouseMove={interactive ? () => onFocusKey(s.key) : undefined}
        style={{ cursor: interactive ? 'pointer' : 'default' }}
      >
        <line x1={anchorX} y1={y} x2={p.x} y2={p.y} stroke={on ? jade : FROG.line} strokeWidth={on ? 1.6 : 1} />
        <circle cx={p.x} cy={p.y} r="2.8" fill={on ? jade : FROG.soft} />
        <rect
          x={x} y={y - h / 2} width={w} height={h} rx="10"
          fill={on ? `rgba(${FROG.jade}, 0.12)` : FROG.panel}
          stroke={on ? jade : FROG.line}
          strokeWidth={on ? 1.6 : 1}
        />
        <text x={x + 13} y={y - 7} fontSize="9" fontWeight="700" letterSpacing="0.6" fill={FROG.faint}>
          {name.toUpperCase()}
        </text>
        <text x={x + 13} y={y + 9} fontSize="14" fontWeight="700" fill={s.listening ? jade : s.label === '—' ? FROG.faint : FROG.ink}>
          {s.listening ? 'Press…' : s.label}
        </text>
        {hk && (
          <text x={x + w - 13} y={y + 3} textAnchor="end" fontSize="10.5" fontWeight="800" fill={jade}>{hk}</text>
        )}
        {s.custom && <circle cx={x + w - 8} cy={y - h / 2 + 8} r="2.6" fill={jade} />}
      </g>
    )
  }

  const FaceButton = ({ physical }) => {
    const p = PAD[physical]
    const s = slot(physical)
    const color = FACE_COLOR[p.face] || jade
    const r = 17
    const hk = s.hotkeys.join('/')
    return (
      <g
        role={s.key ? 'button' : undefined}
        onClick={s.key ? () => onSelectKey(s.key) : undefined}
        onMouseMove={s.key ? () => onFocusKey(s.key) : undefined}
        style={{ cursor: s.key ? 'pointer' : 'default' }}
      >
        {s.focused && <circle cx={p.x} cy={p.y} r={r + 4} fill="none" stroke={jade} strokeWidth="2.5" />}
        <circle cx={p.x} cy={p.y} r={r} fill={FROG.panel} stroke={s.label === '—' ? FROG.line : color} strokeWidth="3" />
        <text x={p.x} y={p.y} textAnchor="middle" dominantBaseline="central" fontSize={s.label.length > 1 ? 12 : 17} fontWeight="800" fill={s.listening ? jade : s.label === '—' ? FROG.faint : FROG.ink}>
          {s.listening ? '…' : s.label}
        </text>
        {s.custom && <circle cx={p.x + r - 3} cy={p.y - r + 3} r="3" fill={jade} />}
        {hk && <text x={p.x} y={p.y + r + 11} textAnchor="middle" fontSize="10" fontWeight="800" fill={jade}>{hk}</text>}
      </g>
    )
  }

  // Select — labelled on the pad (centre button), focusable.
  const sel = slot('SELECT')
  const selP = PAD.SELECT

  return (
    <svg viewBox={`0 0 ${VW} ${VH}`} className="w-full" role="img" aria-label="Controller map">
      <defs>
        <linearGradient id="frog-pad-sheen" x1="0" y1="0" x2="0.3" y2="1">
          <stop offset="0" stopColor="#fff" stopOpacity="0.16" />
          <stop offset="0.5" stopColor="#fff" stopOpacity="0.03" />
          <stop offset="1" stopColor="#000" stopOpacity="0.28" />
        </linearGradient>
      </defs>

      {/* Triggers, then body, then bumpers (bumpers sit in front of the body top edge) */}
      <rect x="176" y="48" width="44" height="12" rx="6" fill={FROG.ground} stroke={FROG.line} strokeWidth="1" />
      <rect x="276" y="48" width="44" height="12" rx="6" fill={FROG.ground} stroke={FROG.line} strokeWidth="1" />

      <path
        d="M166 100 Q160 76 200 78 Q236 82 248 82 Q260 82 296 78 Q336 76 330 100 Q348 152 328 196 Q316 218 286 209 Q264 200 248 200 Q232 200 210 209 Q180 218 168 196 Q148 152 166 100 Z"
        fill={FROG.panel} stroke={FROG.line} strokeWidth="1.5"
      />
      <path
        d="M166 100 Q160 76 200 78 Q236 82 248 82 Q260 82 296 78 Q336 76 330 100 Q348 152 328 196 Q316 218 286 209 Q264 200 248 200 Q232 200 210 209 Q180 218 168 196 Q148 152 166 100 Z"
        fill="url(#frog-pad-sheen)"
      />

      <rect x="178" y="72" width="40" height="12" rx="6" fill={FROG.ground} stroke={FROG.line} strokeWidth="1" />
      <rect x="278" y="72" width="40" height="12" rx="6" fill={FROG.ground} stroke={FROG.line} strokeWidth="1" />

      {/* D-pad */}
      <g fill={FROG.soft}>
        <rect x={PAD.DPAD.x - 5} y={PAD.DPAD.y - 16} width="10" height="32" rx="2.5" />
        <rect x={PAD.DPAD.x - 16} y={PAD.DPAD.y - 5} width="32" height="10" rx="2.5" />
      </g>

      {/* Sticks */}
      {[PAD.LEFT_STICK, PAD.RIGHT_STICK].map((st, i) => (
        <g key={i}>
          <circle cx={st.x} cy={st.y} r="16" fill={FROG.ground} stroke={FROG.line} strokeWidth="2" />
          <circle cx={st.x} cy={st.y} r="8.5" fill={FROG.panel} stroke={FROG.line} strokeWidth="1" />
        </g>
      ))}

      {/* Menu (locked) + Select (focusable) + the frog */}
      <g>
        <rect x="252" y={selP.y - 7} width="22" height="14" rx="7" fill={FROG.ground} stroke={FROG.line} strokeWidth="1" />
        <text x="263" y={selP.y} textAnchor="middle" dominantBaseline="central" fontSize="9" fill={FROG.faint}>☰</text>
      </g>
      <g
        role={sel.key ? 'button' : undefined}
        onClick={sel.key ? () => onSelectKey(sel.key) : undefined}
        onMouseMove={sel.key ? () => onFocusKey(sel.key) : undefined}
        style={{ cursor: sel.key ? 'pointer' : 'default' }}
      >
        {sel.focused && <rect x={selP.x - 15} y={selP.y - 9} width="30" height="18" rx="9" fill="none" stroke={jade} strokeWidth="2" />}
        <rect x={selP.x - 12} y={selP.y - 7} width="24" height="14" rx="7" fill={FROG.ground} stroke={sel.focused ? jade : FROG.line} strokeWidth="1" />
        <text x={selP.x} y={selP.y} textAnchor="middle" dominantBaseline="central" fontSize="8" fontWeight="700" fill={sel.listening ? jade : FROG.soft}>
          {sel.listening ? '…' : 'Sel'}
        </text>
      </g>
      <FrogBadge x="242" y="150" />

      {CALLOUTS.map((c) => (
        <Callout key={c.physical} {...c} />
      ))}

      <FaceButton physical="BUTTON_4" />
      <FaceButton physical="BUTTON_3" />
      <FaceButton physical="BUTTON_2" />
      <FaceButton physical="BUTTON_1" />
    </svg>
  )
}

function FrogBadge({ x, y }) {
  return (
    <g transform={`translate(${x} ${y})`} aria-hidden="true">
      <ellipse cx="0" cy="1.5" rx="11" ry="9" fill={`rgb(${FROG.jade})`} opacity="0.92" />
      <circle cx="-5.5" cy="-6" r="3.6" fill={`rgb(${FROG.jade})`} opacity="0.92" />
      <circle cx="5.5" cy="-6" r="3.6" fill={`rgb(${FROG.jade})`} opacity="0.92" />
      <circle cx="-5.5" cy="-6.5" r="1.7" fill={FROG.ground} />
      <circle cx="5.5" cy="-6.5" r="1.7" fill={FROG.ground} />
      <path d="M-5 4 Q0 8 5 4" stroke={FROG.ground} strokeWidth="1.5" fill="none" strokeLinecap="round" />
    </g>
  )
}
