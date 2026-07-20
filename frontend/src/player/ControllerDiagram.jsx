import { FROG } from '../frog/theme.js'
import { BINDABLE } from '../lib/controlPresets.js'
import { XBOX } from '../lib/gamepad.js'

// A drawn, frog-themed controller — the Controls screen's "Buttons" section made visual.
//
// Console art is DRAWN, never scraped (see frog/Console.jsx). This follows the same
// house style: one flat look, one light source, the rounded language of the frog, and a
// little frog where a real pad prints its logo. NO official wordmarks.
//
// What it shows, at a glance:
//  · every face button in its REAL controller colour (bottom green / right red / left
//    blue / top amber — the same map ButtonLegend keeps), labelled with the GAME button
//    it currently triggers. Because the label follows the chosen scheme, flipping
//    "letters" ⇄ "positions" visibly MOVES "A" between the bottom and right buttons —
//    which is the whole A/B question, made obvious.
//  · the two stick-clicks (L3/R3) flagged jade — the only buttons the app can hotkey
//    without also firing in-game — annotated with the shortcut on each (Wiki / Dex / FF).
//  · the Menu button locked (Start / this menu) — the app owns it, it can't be rebound.
//
// The face buttons, shoulders and Select are interactive (click/focus → rebind that game
// button); the diagram reflects the same linear focus the pad walks (focusedKey), so the
// controller and the d-pad never disagree. The d-pad, sticks and Menu are annotations,
// not focus targets — the d-pad is fixed, and the hotkeys are edited in the rows below.

// Real-pad face-button colours, by PHYSICAL position — so the pad in the picture matches
// the pad in your hands even when the game mapping (the label) differs.
const FACE_COLOR = {
  bottom: '#34d399', // A — emerald
  right: '#fb7185', // B — rose
  left: '#38bdf8', // X — sky
  top: '#fbbf24', // Y — amber
}

// Physical screen positions (viewBox 0 0 300 196). Keyed by the controlPresets PAD_LABELS
// physical name, so a game button drawn here lands wherever its binding maps it.
const POS = {
  BUTTON_1: { x: 230, y: 120, face: 'bottom' },
  BUTTON_2: { x: 256, y: 90, face: 'right' },
  BUTTON_3: { x: 204, y: 90, face: 'left' },
  BUTTON_4: { x: 230, y: 60, face: 'top' },
  LEFT_TOP_SHOULDER: { x: 74, y: 26 },
  RIGHT_TOP_SHOULDER: { x: 226, y: 26 },
  SELECT: { x: 126, y: 74 },
}

const R = 12 // face-button radius

export default function ControllerDiagram({
  resolved, // RetroPad index -> physical label (the live mapping)
  bindings, // this pad's custom overrides (index -> label), for the "custom" dot
  listeningFor, // the RetroPad index currently awaiting a press, or 'wiki'/'pokedex'/'fastForward'
  wikiHotkey,
  pokedexHotkey,
  ffHotkey,
  isPokemon,
  focusedKey, // e.g. 'bind:8' — which row the pad has focused
  onFocusKey,
  onSelectKey,
}) {
  // Which GAME button currently sits on each physical button (inverse of `resolved`,
  // restricted to the rebindable set). Lets a face slot show "A"/"B"/… by scheme.
  const gameByPhysical = {}
  for (const b of BINDABLE) gameByPhysical[resolved[b.index]] = b
  const nameByIndex = Object.fromEntries(BINDABLE.map((b) => [b.index, b.name]))

  // App shortcuts landing on a given raw pad index (the sticks are the collision-free ones).
  const hotkeysAt = (raw) => {
    const out = []
    if (wikiHotkey === raw) out.push('Wiki')
    if (isPokemon && pokedexHotkey === raw) out.push('Dex')
    if (ffHotkey === raw) out.push('FF')
    return out.join(' / ')
  }

  // One interactive game button, drawn at the physical slot its binding maps to.
  const FaceButton = ({ physical }) => {
    const p = POS[physical]
    const game = gameByPhysical[physical]
    if (!p || !game) return null
    const key = `bind:${game.index}`
    const focused = focusedKey === key
    const listening = listeningFor === game.index
    const custom = bindings?.[game.index] != null
    const color = FACE_COLOR[p.face] || `rgb(${FROG.jade})`
    return (
      <g
        role="button"
        tabIndex={-1}
        aria-label={`${game.name} button`}
        onClick={() => onSelectKey(key)}
        onMouseEnter={() => onFocusKey(key)}
        style={{ cursor: 'pointer' }}
      >
        {focused && <circle cx={p.x} cy={p.y} r={R + 3} fill="none" stroke={`rgb(${FROG.jade})`} strokeWidth="2" />}
        <circle cx={p.x} cy={p.y} r={R} fill={FROG.panel} stroke={color} strokeWidth="2.5" />
        <text
          x={p.x}
          y={p.y}
          textAnchor="middle"
          dominantBaseline="central"
          fontSize="12"
          fontWeight="700"
          fill={listening ? `rgb(${FROG.jade})` : FROG.ink}
        >
          {listening ? '…' : game.name}
        </text>
        {custom && <circle cx={p.x + R - 2} cy={p.y - R + 2} r="2.5" fill={`rgb(${FROG.jade})`} />}
      </g>
    )
  }

  // A shoulder / Select pill — interactive like a face button, but oblong and neutral.
  const Bindable = ({ physical, w = 26, h = 12, label }) => {
    const p = POS[physical]
    const game = gameByPhysical[physical]
    if (!p || !game) return null
    const key = `bind:${game.index}`
    const focused = focusedKey === key
    const listening = listeningFor === game.index
    const custom = bindings?.[game.index] != null
    return (
      <g
        role="button"
        tabIndex={-1}
        aria-label={`${game.name} button`}
        onClick={() => onSelectKey(key)}
        onMouseEnter={() => onFocusKey(key)}
        style={{ cursor: 'pointer' }}
      >
        <rect
          x={p.x - w / 2}
          y={p.y - h / 2}
          width={w}
          height={h}
          rx={h / 2}
          fill={focused ? `rgba(${FROG.jade}, 0.18)` : FROG.panel}
          stroke={focused ? `rgb(${FROG.jade})` : FROG.soft}
          strokeWidth={focused ? '2' : '1.5'}
        />
        <text x={p.x} y={p.y} textAnchor="middle" dominantBaseline="central" fontSize="8" fontWeight="700" fill={listening ? `rgb(${FROG.jade})` : FROG.soft}>
          {listening ? '…' : label || game.name}
        </text>
        {custom && <circle cx={p.x + w / 2 - 2} cy={p.y - h / 2 + 2} r="2" fill={`rgb(${FROG.jade})`} />}
      </g>
    )
  }

  // A stick — a free hotkey slot. Jade when it holds a shortcut, muted when free.
  const Stick = ({ x, y, raw }) => {
    const held = hotkeysAt(raw)
    const on = !!held
    return (
      <g>
        <circle cx={x} cy={y} r="13" fill={FROG.panel} stroke={on ? `rgb(${FROG.jade})` : FROG.line} strokeWidth="2" />
        <circle cx={x} cy={y} r="6" fill={on ? `rgba(${FROG.jade}, 0.35)` : 'rgba(255,255,255,0.06)'} />
        <text x={x} y={y + 25} textAnchor="middle" fontSize="8" fontWeight="600" fill={on ? `rgb(${FROG.jade})` : FROG.faint}>
          {held || 'free'}
        </text>
      </g>
    )
  }

  return (
    <svg viewBox="0 0 300 196" className="w-full" role="img" aria-label="Controller map" style={{ maxHeight: 220 }}>
      <defs>
        <linearGradient id="frog-pad-sheen" x1="0" y1="0" x2="0.35" y2="1">
          <stop offset="0" stopColor="#fff" stopOpacity="0.14" />
          <stop offset="0.5" stopColor="#fff" stopOpacity="0.03" />
          <stop offset="1" stopColor="#000" stopOpacity="0.25" />
        </linearGradient>
      </defs>

      {/* Body: a rounded pod with two grips, in the app's panel green. */}
      <path
        d="M40 58 Q40 34 78 36 Q120 40 150 40 Q180 40 222 36 Q260 34 260 58 Q272 96 258 138 Q250 166 224 160 Q200 150 178 150 H122 Q100 150 76 160 Q50 166 42 138 Q28 96 40 58 Z"
        fill={FROG.panel}
        stroke={FROG.line}
        strokeWidth="1.5"
      />
      <path
        d="M40 58 Q40 34 78 36 Q120 40 150 40 Q180 40 222 36 Q260 34 260 58 Q272 96 258 138 Q250 166 224 160 Q200 150 178 150 H122 Q100 150 76 160 Q50 166 42 138 Q28 96 40 58 Z"
        fill="url(#frog-pad-sheen)"
      />

      {/* D-pad — fixed directions, not rebindable. */}
      <g fill={FROG.soft}>
        <rect x="70" y="116" width="8" height="24" rx="2" />
        <rect x="62" y="124" width="24" height="8" rx="2" />
      </g>
      <text x="74" y="150" textAnchor="middle" fontSize="8" fontWeight="600" fill={FROG.faint}>Move</text>

      {/* Sticks — the collision-free hotkey slots. */}
      <Stick x={74} y={74} raw={XBOX.LS} />
      <Stick x={150} y={128} raw={XBOX.RS} />

      {/* Center: Select (bindable) + Menu (locked) + the frog logo. */}
      <Bindable physical="SELECT" w={22} h={11} label="Sel" />
      <g>
        <rect x="162" y="68" width="22" height="12" rx="6" fill={FROG.panel} stroke={FROG.line} strokeWidth="1.5" />
        <text x="173" y="74" textAnchor="middle" dominantBaseline="central" fontSize="7" fontWeight="700" fill={FROG.faint}>☰</text>
        <text x="173" y="90" textAnchor="middle" fontSize="7" fontWeight="600" fill={FROG.faint}>Start/Menu</text>
      </g>
      <FrogBadge x={150} y={104} />

      {/* Shoulders (bumpers) as bindable L / R — they map to the game's L / R. */}
      <Bindable physical="LEFT_TOP_SHOULDER" w={34} h={12} />
      <Bindable physical="RIGHT_TOP_SHOULDER" w={34} h={12} />

      {/* Face buttons — real colours, game labels, interactive. */}
      <FaceButton physical="BUTTON_4" />
      <FaceButton physical="BUTTON_3" />
      <FaceButton physical="BUTTON_2" />
      <FaceButton physical="BUTTON_1" />
    </svg>
  )
}

// A tiny frog where the pad would print its logo — the mascot's palette, drawn flat.
function FrogBadge({ x, y }) {
  return (
    <g transform={`translate(${x} ${y})`} aria-hidden="true">
      <ellipse cx="0" cy="1" rx="9" ry="7.5" fill={`rgb(${FROG.jade})`} opacity="0.9" />
      <circle cx="-4.5" cy="-5" r="3" fill={`rgb(${FROG.jade})`} opacity="0.9" />
      <circle cx="4.5" cy="-5" r="3" fill={`rgb(${FROG.jade})`} opacity="0.9" />
      <circle cx="-4.5" cy="-5.5" r="1.4" fill={FROG.ground} />
      <circle cx="4.5" cy="-5.5" r="1.4" fill={FROG.ground} />
      <path d="M-4 3 Q0 6 4 3" stroke={FROG.ground} strokeWidth="1.2" fill="none" strokeLinecap="round" />
    </g>
  )
}
