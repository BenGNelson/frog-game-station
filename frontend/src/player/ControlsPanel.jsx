import { useEffect, useRef } from 'react'
import { ChevronLeft, Check, RotateCcw, Gamepad2, BookOpen, BookMarked, FastForward } from 'lucide-react'
import { SCHEMES, BINDABLE, resolveBindings, describeBinding } from '../lib/controlPresets.js'
import { CONTROL_SKINS, isChord } from '../lib/playerSettings.js'
import { bindingForButton } from '../lib/gamepad.js'
import { FROG, scrim } from '../frog/theme.js'
import { glowFilter } from '../lib/glow.js'
import ControllerDiagram from './ControllerDiagram.jsx'

// The Controls screen.
//
// It exists because there is no right answer to the face buttons. Nintendo's
// confirm (A) is the RIGHT button; Xbox's confirm (A) is the BOTTOM one. Same
// letter, different place — so whichever you match, you break the other. That's a
// preference, not a bug, so it's a choice you get to make; and since the next
// controller you buy will have its own ideas, every button is remappable on top.
//
// The buttons are shown as a DRAWN controller (ControllerDiagram) rather than a list:
// you see, in one look, which physical button does what — and flipping the scheme
// visibly moves "A" between the bottom and right buttons, which is the whole choice.
//
// Fully driveable from the pad: this is the one screen you'd most want to reach
// when your controller is doing the wrong thing.
export default function ControlsPanel({
  padName,
  lastPress, // {index, id} — the raw button the app last saw, for the input tester line
  scheme,
  skin,
  onSkin,
  bindings,
  listeningFor, // the RetroPad index (or 'wiki'/'pokedex'/'fastForward') waiting for a press, or null
  wikiHotkey, // the raw pad-button index bound to the wiki reader
  pokedexHotkey, // the raw pad-button index bound to the Pokédex (Pokémon games only)
  ffHotkey, // the raw pad-button index bound to fast-forward (null = unassigned)
  isPokemon, // whether to show the Pokédex hotkey row
  focus,
  onFocus,
  onScheme,
  onListen,
  onReset,
  onBack,
}) {
  // Scheme cards first, then one row per button, the shortcut hotkeys, then Reset — one
  // flat list so the d-pad just walks it (shared with PlayerShell via controlRows).
  const rows = controlRows(isPokemon)
  const resolved = resolveBindings({ scheme, custom: bindings })
  const focusedKey = rows[focus]

  const panelRef = useRef(null)
  const scrollRef = useRef(null)
  useEffect(() => panelRef.current?.focus(), [])

  // Scroll-follow: keep the focused row/diagram on screen as the pad walks past the fold
  // (the house pattern — mirrors SaveStatePanel). Without it the controller can't reach
  // the shortcut rows or Reset at the bottom.
  useEffect(() => {
    scrollRef.current?.querySelector('[data-focused="true"]')?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [focus])

  // A hotkey's human label: 'Unassigned', a bare button ('R3'), or a Menu-chord ('Menu + Y').
  const describeHotkey = (hk) => {
    if (hk == null) return 'Unassigned'
    if (isChord(hk)) return `Menu + ${describeBinding(bindingForButton(hk.button))}`
    return describeBinding(bindingForButton(hk))
  }

  const resetFocused = focusedKey === 'reset'
  const bindFocused = typeof focusedKey === 'string' && focusedKey.startsWith('bind:')
  const selectKey = (key) => {
    if (typeof key === 'string' && key.startsWith('bind:')) onListen(Number(key.slice(5)))
  }

  return (
    <div
      ref={panelRef}
      tabIndex={-1}
      className="absolute inset-0 z-30 flex flex-col outline-none backdrop-blur-md"
      style={{
        background: scrim(0.94),
        paddingLeft: 'env(safe-area-inset-left)',
        paddingRight: 'env(safe-area-inset-right)',
        paddingBottom: 'env(safe-area-inset-bottom)',
      }}
    >
      <div className="flex shrink-0 items-center gap-2 px-3 py-2">
        <button
          onClick={onBack}
          className="flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-sm active:opacity-70"
          style={{ background: FROG.panel, color: FROG.ink }}
        >
          <ChevronLeft className="h-4 w-4" aria-hidden="true" /> Back
        </button>
        <h2 className="min-w-0 flex-1 truncate text-center text-sm font-medium" style={{ color: FROG.ink }}>Controls</h2>
        <span className="w-16" aria-hidden="true" />
      </div>

      <div ref={scrollRef} className="min-h-0 flex-1 touch-auto overflow-y-auto overscroll-contain px-4 pb-8">
        <div className="mx-auto max-w-3xl">
          <p className="mt-1 flex items-center justify-center gap-1.5 text-sm" style={{ color: FROG.faint }}>
            <Gamepad2 className="h-4 w-4" aria-hidden="true" />
            {padName || 'No controller connected'}
          </p>

          {/* The input tester: every press reads back as the app saw it — the ground
              truth when a pad reports a nonstandard layout. `raw #n` is the browser's
              button index; the name is what that wire means to the standard layout. */}
          <p data-testid="pad-last-press" className="mb-3 mt-1 text-center text-xs" style={{ color: FROG.faint }}>
            {lastPress ? (
              <>
                Last press: <b style={{ color: FROG.soft }}>{rawButtonName(lastPress.index)}</b> (raw #{lastPress.index})
              </>
            ) : (
              'Press any button to test what the app sees.'
            )}
          </p>

          {/* Button layout — the choice that actually matters. Sits above the pad so you
              watch "A" move between the buttons as you switch. */}
          <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide" style={{ color: FROG.faint }}>Button layout</h3>
          <div className="mb-2 grid gap-2.5 sm:grid-cols-2">
            {Object.values(SCHEMES).map((s) => (
              <SchemeCard
                key={s.id}
                scheme={s}
                active={scheme === s.id}
                focused={focusedKey === s.id}
                onSelect={() => onScheme(s.id)}
                onHover={() => onFocus(rows.indexOf(s.id))}
              />
            ))}
          </div>
          <p className="mb-4 text-center text-xs leading-relaxed" style={{ color: FROG.faint }}>
            Nintendo puts <b style={{ color: FROG.soft }}>A</b> on the right; Xbox puts it on the bottom — watch it move on the pad.
          </p>

          {/* Controller style — a cosmetic skin so the drawn pad matches the one in your
              hands. Changes the face-button colours only, never the mapping. */}
          <div className="mb-4 flex items-center justify-center gap-2">
            <span className="text-xs" style={{ color: FROG.faint }}>Pad style</span>
            <div
              data-focused={focusedKey === 'skin' || undefined}
              onMouseMove={() => onFocus(rows.indexOf('skin'))}
              className="inline-flex overflow-hidden rounded-lg"
              style={{
                border: `1px solid ${focusedKey === 'skin' ? `rgba(${FROG.jade}, 0.6)` : FROG.line}`,
                boxShadow: focusedKey === 'skin' ? `0 0 0 2px rgba(${FROG.jade}, 0.5)` : 'none',
              }}
            >
              {CONTROL_SKINS.map((sk) => {
                const on = skin === sk.id
                return (
                  <button
                    key={sk.id}
                    type="button"
                    aria-pressed={on}
                    onClick={() => onSkin(sk.id)}
                    className="px-3 py-1.5 text-xs font-semibold transition-colors"
                    style={{ background: on ? `rgb(${FROG.jade})` : 'transparent', color: on ? FROG.ground : FROG.soft }}
                  >
                    {sk.name}
                  </button>
                )
              })}
            </div>
          </div>

          {/* The controller — the hero. Face buttons / shoulders / Select are focusable
              (click or the d-pad row-walk selects them → rebind); the diagram lights the
              focused one. */}
          <div data-focused={bindFocused || undefined} className="rounded-3xl border p-3 sm:p-5" style={{ borderColor: FROG.line, background: 'rgba(255,255,255,0.025)' }}>
            <ControllerDiagram
              resolved={resolved}
              skin={skin}
              bindings={bindings}
              listeningFor={listeningFor}
              wikiHotkey={wikiHotkey}
              pokedexHotkey={pokedexHotkey}
              ffHotkey={ffHotkey}
              isPokemon={isPokemon}
              focusedKey={focusedKey}
              onFocusKey={(key) => onFocus(rows.indexOf(key))}
              onSelectKey={selectKey}
            />
          </div>
          <p className="mb-6 mt-3 text-center text-xs leading-relaxed" style={{ color: FROG.faint }}>
            {listeningFor != null && typeof listeningFor === 'number' ? (
              <span className="animate-pulse font-medium" style={{ color: `rgb(${FROG.jade})` }}>Press a button to bind it…</span>
            ) : (
              <>Pick a face button, shoulder, or Select to rebind it. <b style={{ color: `rgb(${FROG.jade})` }}>Jade</b> marks an app shortcut — the sticks and triggers are the buttons the app can use without also acting in-game.</>
            )}
          </p>

          <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide" style={{ color: FROG.faint }}>Shortcuts</h3>
          <p className="mb-2 text-xs leading-relaxed" style={{ color: FROG.faint }}>
            Pick a row, then press a button — or <b style={{ color: FROG.soft }}>hold Menu + a button</b> to
            put a shortcut on a game button (a combo, so it won’t fire on its own in-game).
          </p>
          <div className="space-y-2">
            <HotkeyRow
              Icon={BookOpen}
              label="Wiki"
              hint="opens the wiki"
              value={describeHotkey(wikiHotkey)}
              listening={listeningFor === 'wiki'}
              focused={focusedKey === 'wiki'}
              onSelect={() => onListen('wiki')}
              onHover={() => onFocus(rows.indexOf('wiki'))}
            />
            {isPokemon && (
              <HotkeyRow
                Icon={BookMarked}
                label="Pokédex"
                hint="opens the Pokédex"
                value={describeHotkey(pokedexHotkey)}
                listening={listeningFor === 'pokedex'}
                focused={focusedKey === 'pokedex'}
                onSelect={() => onListen('pokedex')}
                onHover={() => onFocus(rows.indexOf('pokedex'))}
              />
            )}
            <HotkeyRow
              Icon={FastForward}
              label="Fast Forward"
              hint="toggles turbo"
              value={describeHotkey(ffHotkey)}
              listening={listeningFor === 'fastForward'}
              focused={focusedKey === 'fastForward'}
              onSelect={() => onListen('fastForward')}
              onHover={() => onFocus(rows.indexOf('fastForward'))}
            />
          </div>

          <button
            onClick={onReset}
            onMouseMove={() => onFocus(rows.indexOf('reset'))}
            data-focused={resetFocused || undefined}
            aria-current={resetFocused || undefined}
            className="mt-5 flex w-full items-center justify-center gap-1.5 rounded-xl border py-3 text-sm transition-colors"
            style={{
              background: resetFocused ? `rgba(${FROG.jade}, 0.14)` : 'transparent',
              borderColor: resetFocused ? `rgba(${FROG.jade}, 0.6)` : FROG.line,
              boxShadow: resetFocused ? `0 0 0 2px rgba(${FROG.jade}, 0.5)` : 'none',
              color: resetFocused ? FROG.ink : FROG.soft,
            }}
          >
            <RotateCcw className="h-4 w-4" aria-hidden="true" /> Reset controls to the defaults
          </button>

          <p className="mt-4 text-center text-xs leading-relaxed" style={{ color: FROG.faint }}>
            The <b style={{ color: FROG.soft }}>Menu</b> button belongs to the app and can’t be reassigned — tap it for the
            game’s Start, hold it for this menu. A shortcut on a bare game button also acts in-game; a
            <b style={{ color: FROG.soft }}> Menu + button</b> combo won’t — though the game still sees that second button.
          </p>
        </div>
      </div>
    </div>
  )
}

// The input tester's name for a raw browser button index. Menu/Guide are app-owned so
// bindingForButton refuses them — but the tester's job is to report the wire honestly.
function rawButtonName(index) {
  if (index === 9) return 'Menu / Start'
  if (index === 16) return 'Guide'
  const name = describeBinding(bindingForButton(index))
  return name === '—' ? 'outside the standard layout' : name
}

function SchemeCard({ scheme, active, focused, onSelect, onHover }) {
  return (
    <button
      onClick={onSelect}
      onMouseMove={onHover}
      data-focused={focused || undefined}
      aria-current={focused || undefined}
      className={`rounded-2xl border p-3 text-left transition-all ${focused ? 'scale-[1.02]' : ''}`}
      style={{
        background: focused ? `rgba(${FROG.jade}, 0.14)` : FROG.panel,
        borderColor: focused ? `rgba(${FROG.jade}, 0.6)` : active ? `rgba(${FROG.jade}, 0.5)` : FROG.line,
        boxShadow: focused ? `0 0 0 2px rgba(${FROG.jade}, 0.5)` : 'none',
        filter: focused ? glowFilter(FROG.jade, 0.4) : undefined,
      }}
    >
      <span className="flex items-center gap-1.5 text-sm font-semibold" style={{ color: FROG.ink }}>
        {active && <Check className="h-4 w-4 shrink-0" style={{ color: `rgb(${FROG.jade})` }} aria-hidden="true" />}
        {scheme.name}
      </span>
      <span className="mt-1 block text-[11px] leading-relaxed" style={{ color: FROG.soft }}>{scheme.blurb}</span>
    </button>
  )
}

// An app-shortcut binding row — an app action (opens the wiki, toggles turbo), not a game
// button, so it can take ANY button (a game button will also act in-game; the engine reads
// the pad itself and we can't intercept it mid-play — that's why the sticks are preferred).
function HotkeyRow({ Icon, label, hint, value, listening, focused, onSelect, onHover }) {
  return (
    <button
      onClick={onSelect}
      onMouseMove={onHover}
      data-focused={focused || undefined}
      aria-current={focused || undefined}
      className="flex w-full items-center justify-between gap-3 rounded-xl border px-3 py-2.5 text-left transition-colors"
      style={{
        background: focused ? `rgba(${FROG.jade}, 0.14)` : FROG.panel,
        borderColor: focused ? `rgba(${FROG.jade}, 0.6)` : FROG.line,
        boxShadow: focused ? `0 0 0 2px rgba(${FROG.jade}, 0.5)` : 'none',
      }}
    >
      <span className="flex min-w-0 flex-1 items-center gap-2 text-sm font-medium" style={{ color: FROG.ink }}>
        <Icon className="h-4 w-4 shrink-0" style={{ color: FROG.soft }} aria-hidden="true" />
        <span className="shrink-0">{label}</span>
        {/* Hidden while listening so the "Press a button…" prompt has room; truncates
            otherwise so a long hint can never collide with the value on the right. */}
        {!listening && <span className="truncate" style={{ color: FROG.faint }}>{hint}</span>}
      </span>
      {listening ? (
        <span className="shrink-0 animate-pulse text-sm font-medium" style={{ color: `rgb(${FROG.jade})` }}>Press a button…</span>
      ) : (
        <span className="shrink-0 text-sm" style={{ color: FROG.soft }}>{value}</span>
      )}
    </button>
  )
}

// The flat row order the d-pad walks. Exported so PlayerShell can drive focus against
// exactly what's on screen. The `bind:*` rows are the game buttons drawn on the diagram;
// 'wiki'/'pokedex'/'fastForward' are the app-level shortcuts, then Reset.
export function controlRows(isPokemon = false) {
  return [
    ...Object.keys(SCHEMES),
    'skin',
    ...BINDABLE.map((b) => `bind:${b.index}`),
    'wiki',
    ...(isPokemon ? ['pokedex'] : []),
    'fastForward',
    'reset',
  ]
}
