import { describe, it, expect } from 'vitest'
import { createRef } from 'react'
import { renderToString } from 'react-dom/server'
import WikiPanel from './WikiPanel.jsx'
import PokedexPanel from './PokedexPanel.jsx'
import PauseMenu from './PauseMenu.jsx'
import SaveStatePanel from './SaveStatePanel.jsx'
import SaveActionMenu from './SaveActionMenu.jsx'
import ControllerDiagram from './ControllerDiagram.jsx'
import ControlsPanel from './ControlsPanel.jsx'
import { resolveBindings } from '../lib/controlPresets.js'

// Render smoke test for the mounted-persistent player panels. Server-rendering each one
// executes its full render path (props, state, hooks, the useImperativeHandle deps array)
// with no DOM or network needed — so it catches crash-on-render bugs that build + lint +
// e2e-smoke all MISS, because none of them actually render a panel. (This exists because a
// `const` referenced in a hook's deps array before its own declaration — a temporal dead
// zone — blanked the wiki panel at runtime and shipped clean through every other gate.)

describe('player panel render smoke', () => {
  it('WikiPanel mounts (open) without throwing', () => {
    expect(() =>
      renderToString(
        <WikiPanel ref={createRef()} open gameId="g" gameName="Pokemon Yellow" onClose={() => {}} />
      )
    ).not.toThrow()
  })

  it('PokedexPanel mounts (open) in both input modes without throwing', () => {
    // Both modes exercise the new search + cover-grid surface (the header layout toggle,
    // the Keyboard/grid-tile imports); touch swaps the search placeholder, pad keeps the
    // "press X" hint.
    for (const mode of ['pad', 'touch']) {
      expect(() =>
        renderToString(
          <PokedexPanel ref={createRef()} open mode={mode} gameId="g" gameName="Pokemon Yellow"
                        onClose={() => {}} onReadWiki={() => {}} />
        )
      ).not.toThrow()
    }
  })

  it('PauseMenu mounts (open, full Pokémon menu) without throwing', () => {
    expect(() =>
      renderToString(
        <PauseMenu
          open
          name="Pokemon Crystal"
          fastForward
          canFullscreen
          isPokemon
          focus={0}
          onFocus={() => {}}
          onAction={() => {}}
        />
      )
    ).not.toThrow()
  })

  it('SaveStatePanel mounts (with a state + cover actions) without throwing', () => {
    expect(() =>
      renderToString(
        <SaveStatePanel
          gameId="g"
          states={[{ slot: '1700000000000' }]}
          loading={false}
          busy={false}
          error={null}
          focus={0}
          onFocus={() => {}}
          onCols={() => {}}
          onSave={() => {}}
          onLoad={() => {}}
          onDelete={() => {}}
          hasCustomCover
          onSetCover={() => {}}
          onResetCover={() => {}}
          coverNotice="Cover set from this frame."
          onChoose={() => {}}
          onBack={() => {}}
        />
      )
    ).not.toThrow()
  })

  it('SaveActionMenu mounts without throwing', () => {
    expect(() =>
      renderToString(
        <SaveActionMenu
          focus={0}
          onFocusChange={() => {}}
          onLoad={() => {}}
          onDelete={() => {}}
          onCancel={() => {}}
        />
      )
    ).not.toThrow()
  })

  it('ControllerDiagram mounts across schemes + custom rebinds without throwing', () => {
    // Includes the edge cases that used to blank a face slot / hide a button:
    // a normal remap, a collision (two game buttons on one physical), and an
    // off-map rebind (a game button pushed onto a stick the diagram doesn't draw).
    const cases = [
      { scheme: 'letters', custom: {} },
      { scheme: 'positions', custom: {} },
      { scheme: 'letters', custom: { 0: 'BUTTON_1' } }, // collision: A and B share the bottom
      { scheme: 'letters', custom: { 8: 'RIGHT_STICK' } }, // off-map: A on R3
    ]
    for (const { scheme, custom } of cases) {
      expect(() =>
        renderToString(
          <ControllerDiagram
            resolved={resolveBindings({ scheme, custom })}
            bindings={custom}
            listeningFor={8}
            wikiHotkey={11}
            pokedexHotkey={10}
            ffHotkey={4}
            isPokemon
            focusedKey="bind:8"
            onFocusKey={() => {}}
            onSelectKey={() => {}}
          />
        )
      ).not.toThrow()
    }
  })

  it('ControllerDiagram surfaces the listening prompt and chord badges in its markup', () => {
    // Pins the two states the drawn pad must communicate, not just render: an off-map
    // rebind mid-listen shows "Press…" at that button's callout, and a Menu-chord
    // hotkey wears its "M+" badge.
    const html = renderToString(
      <ControllerDiagram
        resolved={resolveBindings({ scheme: 'letters', custom: { 8: 'RIGHT_STICK' } })}
        bindings={{ 8: 'RIGHT_STICK' }}
        listeningFor={8}
        wikiHotkey={{ button: 3, mod: 'menu' }}
        pokedexHotkey={10}
        ffHotkey={null}
        isPokemon
        focusedKey="bind:8"
        onFocusKey={() => {}}
        onSelectKey={() => {}}
      />
    )
    expect(html).toContain('Press…')
    expect(html).toContain('M+')
  })

  it('ControllerDiagram mounts with a Menu-chord hotkey (badge on a game button)', () => {
    // A chord {button, mod:'menu'} places its badge on the game button (here Wiki on Y),
    // marked "M+" — a different render path from a bare stick-click hotkey.
    expect(() =>
      renderToString(
        <ControllerDiagram
          resolved={resolveBindings({ scheme: 'letters', custom: {} })}
          bindings={{}}
          listeningFor={null}
          wikiHotkey={{ button: 3, mod: 'menu' }}
          pokedexHotkey={10}
          ffHotkey={null}
          isPokemon
          focusedKey={null}
          onFocusKey={() => {}}
          onSelectKey={() => {}}
        />
      )
    ).not.toThrow()
  })

  it('ControlsPanel input tester reads back the last raw press', () => {
    const html = renderToString(
      <ControlsPanel
        padName="Xbox Wireless Controller"
        lastPress={{ index: 4, id: 'pad' }}
        scheme="letters"
        bindings={{}}
        listeningFor={null}
        wikiHotkey={11}
        pokedexHotkey={10}
        ffHotkey={null}
        isPokemon
        focus={2}
        onFocus={() => {}}
        onScheme={() => {}}
        onListen={() => {}}
        onReset={() => {}}
        onBack={() => {}}
      />
    )
    // React SSR splits adjacent text expressions with comment nodes — strip them
    // before matching the assembled "raw #4" string.
    expect(html.replace(/<!-- -->/g, '')).toContain('raw #4')
    expect(html).toContain('LB')
  })

  it('ControlsPanel mounts (with the diagram + a chord hotkey) without throwing', () => {
    for (const wikiHotkey of [11, { button: 3, mod: 'menu' }]) {
      expect(() =>
        renderToString(
          <ControlsPanel
            padName="Xbox Wireless Controller"
            scheme="letters"
            bindings={{}}
            listeningFor={null}
            wikiHotkey={wikiHotkey}
            pokedexHotkey={10}
            ffHotkey={null}
            isPokemon
            focus={2}
            onFocus={() => {}}
            onScheme={() => {}}
            onListen={() => {}}
            onReset={() => {}}
            onBack={() => {}}
          />
        )
      ).not.toThrow()
    }
  })
})
