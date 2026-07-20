import { FROG } from '../frog/theme.js'
import { BINDABLE, describeBinding } from '../lib/controlPresets.js'
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
  // The GAME buttons currently on each physical slot. Usually 0 or 1, but a custom rebind
  // can pile two onto one slot (a collision) or leave a slot empty — the physical button is
  // ALWAYS drawn either way (an empty slot reads "—", never a hole), and the label follows
  // the scheme, so flipping letters⇄positions visibly moves "A".
  const gamesAt = (physical) => BINDABLE.filter((b) => resolved[b.index] === physical)
  // Game buttons a custom rebind pushed onto a physical the diagram doesn't draw (a stick,
  // the d-pad, the lower triggers) — surfaced as chips below so they're never invisible.
  const offMap = BINDABLE.filter((b) => !POS[resolved[b.index]])

  // Shared focus/listen/custom state for the game(s) sitting on one slot.
  const slotState = (games) => ({
    focused: games.some((g) => focusedKey === `bind:${g.index}`),
    listening: games.some((g) => listeningFor === g.index),
    custom: games.some((g) => bindings?.[g.index] != null),
    // Click/hover acts on the focused game if it's here, else the first one.
    target: games.find((g) => focusedKey === `bind:${g.index}`) || games[0],
    label: games.length ? games.map((g) => (g.name === 'Select' ? 'Sel' : g.name)).join('/') : '—',
  })

  // App shortcuts landing on a given raw pad index (the sticks are the collision-free ones).
  const hotkeysAt = (raw) => {
    const out = []
    if (wikiHotkey === raw) out.push('Wiki')
    if (isPokemon && pokedexHotkey === raw) out.push('Dex')
    if (ffHotkey === raw) out.push('FF')
    return out.join(' / ')
  }

  // One interactive face button, ALWAYS drawn at its fixed physical slot.
  const FaceButton = ({ physical }) => {
    const p = POS[physical]
    const games = gamesAt(physical)
    const { focused, listening, custom, target, label } = slotState(games)
    const key = target && `bind:${target.index}`
    const color = FACE_COLOR[p.face] || `rgb(${FROG.jade})`
    return (
      <g
        role={key ? 'button' : undefined}
        tabIndex={-1}
        aria-label={games.length ? `${label} button` : 'unassigned button'}
        onClick={key ? () => onSelectKey(key) : undefined}
        onMouseEnter={key ? () => onFocusKey(key) : undefined}
        style={{ cursor: key ? 'pointer' : 'default' }}
      >
        {focused && <circle cx={p.x} cy={p.y} r={R + 3} fill="none" stroke={`rgb(${FROG.jade})`} strokeWidth="2" />}
        <circle cx={p.x} cy={p.y} r={R} fill={FROG.panel} stroke={games.length ? color : FROG.line} strokeWidth="2.5" />
        <text
          x={p.x}
          y={p.y}
          textAnchor="middle"
          dominantBaseline="central"
          fontSize={label.length > 1 ? 9 : 12}
          fontWeight="700"
          fill={listening ? `rgb(${FROG.jade})` : games.length ? FROG.ink : FROG.faint}
        >
          {listening ? '…' : label}
        </text>
        {custom && <circle cx={p.x + R - 2} cy={p.y - R + 2} r="2.5" fill={`rgb(${FROG.jade})`} />}
      </g>
    )
  }

  // A shoulder / Select pill — always drawn, interactive when a game button sits on it.
  const Bindable = ({ physical, w = 26, h = 12 }) => {
    const p = POS[physical]
    const games = gamesAt(physical)
    const { focused, listening, custom, target, label } = slotState(games)
    const key = target && `bind:${target.index}`
    return (
      <g
        role={key ? 'button' : undefined}
        tabIndex={-1}
        aria-label={games.length ? `${label} button` : 'unassigned button'}
        onClick={key ? () => onSelectKey(key) : undefined}
        onMouseEnter={key ? () => onFocusKey(key) : undefined}
        style={{ cursor: key ? 'pointer' : 'default' }}
      >
        <rect
          x={p.x - w / 2}
          y={p.y - h / 2}
          width={w}
          height={h}
          rx={h / 2}
          fill={focused ? `rgba(${FROG.jade}, 0.18)` : FROG.panel}
          stroke={focused ? `rgb(${FROG.jade})` : games.length ? FROG.soft : FROG.line}
          strokeWidth={focused ? '2' : '1.5'}
        />
        <text x={p.x} y={p.y} textAnchor="middle" dominantBaseline="central" fontSize="8" fontWeight="700" fill={listening ? `rgb(${FROG.jade})` : games.length ? FROG.soft : FROG.faint}>
          {listening ? '…' : label}
        </text>
        {custom && <circle cx={p.x + w / 2 - 2} cy={p.y - h / 2 + 2} r="2" fill={`rgb(${FROG.jade})`} />}
      </g>
    )
  }

  // Off-map bindings — a game button a custom rebind pushed onto a stick / d-pad / trigger
  // the diagram doesn't draw. Rendered as focusable chips so the row is never lost.
  const OffMapChip = ({ b, i, n }) => {
    const key = `bind:${b.index}`
    const focused = focusedKey === key
    const listening = listeningFor === b.index
    const w = 62
    const gap = 6
    const total = n * w + (n - 1) * gap
    const x = (300 - total) / 2 + i * (w + gap)
    return (
      <g role="button" tabIndex={-1} onClick={() => onSelectKey(key)} onMouseEnter={() => onFocusKey(key)} style={{ cursor: 'pointer' }}>
        <rect x={x} y={174} width={w} height={16} rx={8}
          fill={focused ? `rgba(${FROG.jade}, 0.16)` : FROG.panel}
          stroke={focused ? `rgb(${FROG.jade})` : FROG.line} strokeWidth={focused ? '1.5' : '1'} />
        <text x={x + w / 2} y={182} textAnchor="middle" dominantBaseline="central" fontSize="7.5" fontWeight="600" fill={listening ? `rgb(${FROG.jade})` : FROG.soft}>
          {listening ? `${b.name} …` : `${b.name} → ${describeBinding(resolved[b.index])}`}
        </text>
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
      <Bindable physical="SELECT" w={22} h={11} />
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

      {/* Off-map bindings, if any — game buttons a custom rebind moved onto a stick / d-pad. */}
      {offMap.map((b, i) => (
        <OffMapChip key={b.index} b={b} i={i} n={offMap.length} />
      ))}
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
