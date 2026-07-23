import { FROG } from '../frog/theme.js'
import { BINDABLE } from '../lib/controlPresets.js'
import { XBOX } from '../lib/gamepad.js'
import { RETROPAD } from '../lib/retropad.js'
import { isChord, hotkeyButton } from '../lib/playerSettings.js'
import { glowFilter } from '../lib/glow.js'
import { frogMarkMarkup } from '../frog/art.js'
import '../frog/frog.css'

// A drawn, frog-themed controller — the Controls screen's hero.
//
// Console art is DRAWN, never scraped (see frog/Console.jsx): one flat look, one light
// source, the rounded language of the frog. The silhouette is a real pad — shoulder
// humps, descending grips, an arch between them — built as a hand-tuned left half
// mirrored about the centreline so the two sides can't drift. At the top centre, where
// an Xbox pad puts its glowing nexus, sits a round guide button wearing the flat frog
// mark (the favicon frog) in jade. Faint still water-rings sit behind the pad: the
// WATER motif, without a loop competing with the focus walk. NO official wordmarks.
//
// The mapping is made to READ. Face buttons wear their real controller colours (bottom
// green / right red / left blue / top amber) and carry the GAME button they trigger, so
// flipping the scheme visibly moves "A" between the bottom and right button. Every other
// button gets a **callout** in the margins — a two-line text label joined to the button
// by a thin leader line, the visual language of a classic gamepad layout card — showing
// what it does AND any app shortcut on it (so Fast-Forward bound to RB reads "R" with an
// "FF" badge). Callouts are per-physical-button, so a collision shows both game buttons
// and an off-map rebind still surfaces at that button's callout — nothing is hidden.
//
// Face buttons, shoulders and Select are interactive (focus/click → rebind); the diagram
// reflects the same linear focus the pad walks (focusedKey), so picture and d-pad agree.

const VW = 560
const VH = 300

// The pad's outline. Left half hand-tuned (gently-dipped top → shoulder hump → widest
// point → grip → grip bottom → inner rise → bottom arch), right half is the same numbers
// reflected about x=280.
const PAD_PATH =
  'M280 93 C250 88 220 83 196 88 C156 94 137 120 134 156 ' +
  'C130 192 132 222 146 246 C154 262 168 272 184 266 ' +
  'C200 260 208 244 216 226 C232 231 256 234 280 234 ' +
  'C304 234 328 231 344 226 C352 244 360 260 376 266 ' +
  'C392 272 406 262 414 246 C428 222 430 192 426 156 ' +
  'C423 120 404 94 364 88 C340 83 310 88 280 93 Z'

// Face-button colour by physical position — and by SKIN, so the drawn pad can match the
// controller in your hands. Xbox uses its position colours; PlayStation borrows the DualSense
// symbol colours (△ green, ○ red, ✕ blue, □ pink); Nintendo's Switch/Pro face buttons are
// monochrome, so they read in one neutral. The game-button LETTER stays the label either way —
// the skin is the look, not the mapping.
const FACE_COLOR = {
  xbox: { bottom: `rgb(${FROG.jade})`, right: '#fb7185', left: '#38bdf8', top: '#fbbf24' },
  playstation: { bottom: '#7aa0e6', right: '#f0607e', left: '#e07ad0', top: '#4fd0a0' },
  nintendo: { bottom: '#dfe4e8', right: '#dfe4e8', left: '#dfe4e8', top: '#dfe4e8' },
}

// Button centres on the drawn pad (body spans x≈130–430, centred 280) — the real Xbox
// arrangement: left stick upper-left, D-pad lower-left, face diamond upper-right, right
// stick lower-right of centre.
const PAD = {
  LEFT_BOTTOM_SHOULDER: { x: 200, y: 60 }, // LT
  RIGHT_BOTTOM_SHOULDER: { x: 360, y: 60 }, // RT
  LEFT_TOP_SHOULDER: { x: 200, y: 84 }, // LB
  RIGHT_TOP_SHOULDER: { x: 360, y: 84 }, // RB
  LEFT_STICK: { x: 200, y: 140 }, // L3
  RIGHT_STICK: { x: 328, y: 205 }, // R3
  DPAD: { x: 232, y: 202 },
  SELECT: { x: 244, y: 120 },
  MENU: { x: 316, y: 120 },
  BUTTON_4: { x: 360, y: 114, face: 'top' }, // Y
  BUTTON_3: { x: 334, y: 140, face: 'left' }, // X
  BUTTON_2: { x: 386, y: 140, face: 'right' }, // B
  BUTTON_1: { x: 360, y: 166, face: 'bottom' }, // A
}

// Raw browser pad index behind each physical button (for hotkey lookup).
const PHYS_RAW = {
  BUTTON_1: XBOX.A, BUTTON_2: XBOX.B, BUTTON_3: XBOX.X, BUTTON_4: XBOX.Y,
  LEFT_TOP_SHOULDER: XBOX.LB, RIGHT_TOP_SHOULDER: XBOX.RB,
  LEFT_BOTTOM_SHOULDER: XBOX.LT, RIGHT_BOTTOM_SHOULDER: XBOX.RT,
  LEFT_STICK: XBOX.LS, RIGHT_STICK: XBOX.RS, SELECT: XBOX.VIEW,
}

// Peripheral callouts — physical button, gutter side, vertical slot, printed name, and the
// leader's route: `rim` is where the line lands (on the control's rim, not its centre) and
// `bend` an optional elbow. Face buttons and Select are labelled on the pad itself, so
// they're absent. R3's leader routes BELOW the A button instead of crossing the diamond.
const CALLOUTS = [
  { physical: 'LEFT_BOTTOM_SHOULDER', side: 'left', y: 52, name: 'LT', rim: [182, 60], bend: [156, 52] },
  { physical: 'LEFT_TOP_SHOULDER', side: 'left', y: 88, name: 'LB', rim: [174, 84], bend: [150, 88] },
  { physical: 'LEFT_STICK', side: 'left', y: 140, name: 'L3', rim: [183, 140] },
  { physical: 'DPAD', side: 'left', y: 202, name: 'D-pad', fixed: 'Move', rim: [211, 202] },
  { physical: 'RIGHT_BOTTOM_SHOULDER', side: 'right', y: 52, name: 'RT', rim: [378, 60], bend: [404, 52] },
  { physical: 'RIGHT_TOP_SHOULDER', side: 'right', y: 88, name: 'RB', rim: [386, 84], bend: [410, 88] },
  { physical: 'RIGHT_STICK', side: 'right', y: 218, name: 'R3', rim: [343, 212], bend: [404, 218] },
]

const BINDABLE_SET = new Set(BINDABLE.map((b) => b.index))
const RETRO_NAME = {
  [RETROPAD.A]: 'A', [RETROPAD.B]: 'B', [RETROPAD.X]: 'X', [RETROPAD.Y]: 'Y',
  [RETROPAD.L]: 'L', [RETROPAD.R]: 'R', [RETROPAD.L2]: 'L2', [RETROPAD.R2]: 'R2',
  [RETROPAD.SELECT]: 'Select',
}

export default function ControllerDiagram({
  resolved, bindings, listeningFor, wikiHotkey, pokedexHotkey, ffHotkey, isPokemon,
  skin = 'xbox', focusedKey, onFocusKey, onSelectKey,
}) {
  const faceColors = FACE_COLOR[skin] || FACE_COLOR.xbox
  const retroByPhysical = {}
  for (const [idx, phys] of Object.entries(resolved)) {
    const n = Number(idx)
    if (RETRO_NAME[n] == null || !phys) continue
    ;(retroByPhysical[phys] ||= []).push(n)
  }

  // Which app shortcuts sit on a physical button — a chord (hold-Menu + button) lands on
  // its button too, prefixed "M+" so the badge shows it needs the modifier.
  const hotkeysAt = (raw) => {
    const out = []
    const tag = (hk, label) => {
      if (hotkeyButton(hk) === raw) out.push(isChord(hk) ? `M+${label}` : label)
    }
    tag(wikiHotkey, 'Wiki')
    if (isPokemon) tag(pokedexHotkey, 'Dex')
    tag(ffHotkey, 'FF')
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

  const Callout = ({ physical, side, y, name, fixed, rim, bend }) => {
    const s = slot(physical, fixed)
    const left = side === 'left'
    const tx = left ? 100 : 460 // text edge — right-aligned on the left, left-aligned on the right
    const anchor = left ? 'end' : 'start'
    const startX = left ? 108 : 452
    const on = s.focused
    const hk = s.hotkeys.join(' / ')
    const interactive = !!s.key
    const points = [[startX, y], ...(bend ? [bend] : []), rim].map((p) => p.join(',')).join(' ')
    return (
      <g
        data-testid={`pad-callout-${physical}`}
        role={interactive ? 'button' : undefined}
        onClick={interactive ? () => onSelectKey(s.key) : undefined}
        onMouseMove={interactive ? () => onFocusKey(s.key) : undefined}
        style={{ cursor: interactive ? 'pointer' : 'default' }}
      >
        {/* Generous invisible hit area — the text alone would be a mean touch target.
            `transparent`, not `none`: it has to receive pointer events. */}
        <rect x={left ? 4 : 456} y={y - 22} width="100" height="44" rx="8" fill="transparent" />
        <polyline
          points={points}
          fill="none"
          stroke={on ? jade : FROG.line}
          strokeWidth={on ? 1.6 : 1}
          strokeLinejoin="round"
        />
        <circle cx={rim[0]} cy={rim[1]} r="2.4" fill={on ? jade : FROG.soft} />
        <text x={tx} y={y - 5} textAnchor={anchor} fontSize="8.5" fontWeight="600" letterSpacing="1" fill={FROG.faint}>
          {name.toUpperCase()}
        </text>
        <text
          x={tx} y={y + 11} textAnchor={anchor} fontSize="13.5" fontWeight="700"
          className={s.listening ? 'frog-invite' : undefined}
          fill={s.listening || on ? jade : s.label === '—' ? FROG.faint : FROG.ink}
        >
          {s.listening ? 'Press…' : s.label}
          {hk && <tspan dx="6" fontSize="9.5" fontWeight="800" fill={jade}>{hk}</tspan>}
        </text>
        {on && (
          <rect
            x={left ? tx - 52 : tx} y={y + 15} width="52" height="2" rx="1"
            fill={jade} opacity="0.55" style={{ filter: glowFilter(FROG.jade, 0.5) }}
          />
        )}
        {s.custom && <circle cx={left ? tx + 7 : tx - 7} cy={y - 8} r="2.5" fill={jade} />}
      </g>
    )
  }

  const FaceButton = ({ physical }) => {
    const p = PAD[physical]
    const s = slot(physical)
    const color = faceColors[p.face] || jade
    const r = 11.5
    const hk = s.hotkeys.join('/')
    return (
      <g
        data-testid={`pad-face-${physical}`}
        role={s.key ? 'button' : undefined}
        onClick={s.key ? () => onSelectKey(s.key) : undefined}
        onMouseMove={s.key ? () => onFocusKey(s.key) : undefined}
        style={{ cursor: s.key ? 'pointer' : 'default' }}
      >
        {s.focused && <circle cx={p.x} cy={p.y} r={r + 3.5} fill="none" stroke={jade} strokeWidth="2" />}
        <circle cx={p.x} cy={p.y} r={r} fill={FROG.panel} stroke={s.label === '—' ? FROG.line : color} strokeWidth="2.2" />
        <text x={p.x} y={p.y} textAnchor="middle" dominantBaseline="central" fontSize={s.label.length > 1 ? 8.5 : 12} fontWeight="800" fill={s.listening ? jade : s.label === '—' ? FROG.faint : FROG.ink}>
          {s.listening ? '…' : s.label}
        </text>
        {s.custom && <circle cx={p.x + 8.5} cy={p.y - 8.5} r="2.5" fill={jade} />}
        {/* Badge above the TOP face button (below it would sit inside the diamond), below the rest. */}
        {hk && <text x={p.x} y={p.face === 'top' ? p.y - r - 6 : p.y + r + 9} textAnchor="middle" fontSize="8.5" fontWeight="800" fill={jade}>{hk}</text>}
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

      {/* Still water-rings behind the pad — the WATER motif, kept static so nothing
          loops behind a settings surface. */}
      <g aria-hidden="true">
        <ellipse cx="280" cy="180" rx="170" ry="58" fill="none" stroke={`rgba(${FROG.jade}, 0.08)`} strokeWidth="1" />
        <ellipse cx="280" cy="180" rx="215" ry="73" fill="none" stroke={`rgba(${FROG.jade}, 0.055)`} strokeWidth="1" />
        <ellipse cx="280" cy="180" rx="260" ry="88" fill="none" stroke={`rgba(${FROG.jade}, 0.035)`} strokeWidth="1" />
      </g>

      {/* Triggers (behind the body — only their tops show), then body, then bumpers
          seated in front of the shoulder humps */}
      <rect x="182" y="55" width="36" height="30" rx="10" fill={FROG.ground} stroke={FROG.line} strokeWidth="1" />
      <rect x="342" y="55" width="36" height="30" rx="10" fill={FROG.ground} stroke={FROG.line} strokeWidth="1" />

      <path d={PAD_PATH} fill={FROG.panel} stroke={FROG.line} strokeWidth="1.5" />
      <path d={PAD_PATH} fill="url(#frog-pad-sheen)" />

      <rect x="174" y="79" width="52" height="14" rx="7" fill={FROG.ground} stroke={FROG.line} strokeWidth="1" />
      <rect x="334" y="79" width="52" height="14" rx="7" fill={FROG.ground} stroke={FROG.line} strokeWidth="1" />

      {/* D-pad — a cross in a round recess */}
      <circle cx={PAD.DPAD.x} cy={PAD.DPAD.y} r="21" fill={FROG.ground} stroke={FROG.line} strokeWidth="1" />
      <g fill={FROG.soft}>
        <rect x={PAD.DPAD.x - 5.5} y={PAD.DPAD.y - 17} width="11" height="34" rx="3" />
        <rect x={PAD.DPAD.x - 17} y={PAD.DPAD.y - 5.5} width="34" height="11" rx="3" />
      </g>

      {/* Sticks — well, cap, and a faint concave ring on top */}
      {[PAD.LEFT_STICK, PAD.RIGHT_STICK].map((st, i) => (
        <g key={i}>
          <circle cx={st.x} cy={st.y} r="17" fill={FROG.ground} stroke={FROG.line} strokeWidth="1.5" />
          <circle cx={st.x} cy={st.y} r="10.5" fill={FROG.panel} stroke={FROG.line} strokeWidth="1" />
          <circle cx={st.x} cy={st.y} r="5.5" fill="none" stroke={FROG.line} strokeWidth="1" />
        </g>
      ))}

      {/* Menu (locked) + Select (focusable) */}
      <g>
        <rect x={PAD.MENU.x - 12} y={PAD.MENU.y - 6.5} width="24" height="13" rx="6.5" fill={FROG.ground} stroke={FROG.line} strokeWidth="1" />
        <text x={PAD.MENU.x} y={PAD.MENU.y} textAnchor="middle" dominantBaseline="central" fontSize="8.5" fill={FROG.faint}>☰</text>
      </g>
      <g
        role={sel.key ? 'button' : undefined}
        onClick={sel.key ? () => onSelectKey(sel.key) : undefined}
        onMouseMove={sel.key ? () => onFocusKey(sel.key) : undefined}
        style={{ cursor: sel.key ? 'pointer' : 'default' }}
      >
        {sel.focused && <rect x={selP.x - 15.5} y={selP.y - 10} width="31" height="20" rx="10" fill="none" stroke={jade} strokeWidth="2" />}
        <rect x={selP.x - 12} y={selP.y - 6.5} width="24" height="13" rx="6.5" fill={FROG.ground} stroke={sel.focused ? jade : FROG.line} strokeWidth="1" />
        <text x={selP.x} y={selP.y} textAnchor="middle" dominantBaseline="central" fontSize="7.5" fontWeight="700" fill={sel.listening ? jade : FROG.soft}>
          {sel.listening ? '…' : 'Sel'}
        </text>
      </g>

      <FrogBadge x="280" y="154" />

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

// The frog at the guide-button spot — a round centre button wearing the flat two-tone
// mark (frogMarkMarkup, the favicon frog) in jade, the way an Xbox pad prints its logo
// on the nexus. It's the MARK, not the mascot, so it doesn't blink — logos hold still.
// A faint jade halo gives it the glowing-orb read without breaking the flat language.
function FrogBadge({ x, y }) {
  const s = 0.24
  return (
    <g data-testid="pad-frog" aria-hidden="true">
      <circle cx={x} cy={y} r="19" fill="none" stroke={`rgba(${FROG.jade}, 0.14)`} strokeWidth="2" />
      <circle cx={x} cy={y} r="16" fill={FROG.ground} stroke={`rgba(${FROG.jade}, 0.5)`} strokeWidth="1.5" />
      <g
        transform={`translate(${x - 50 * s} ${y - 53 * s}) scale(${s})`}
        style={{ color: `rgb(${FROG.jade})` }}
        dangerouslySetInnerHTML={{ __html: frogMarkMarkup({ ground: FROG.ground }) }}
      />
    </g>
  )
}
