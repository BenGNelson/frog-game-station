import { describe, it, expect } from 'vitest'
import { createRef } from 'react'
import { renderToString } from 'react-dom/server'
import WikiPanel from './WikiPanel.jsx'
import PokedexPanel from './PokedexPanel.jsx'

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

  it('PokedexPanel mounts (open) without throwing', () => {
    expect(() =>
      renderToString(
        <PokedexPanel ref={createRef()} open gameId="g" gameName="Pokemon Yellow" onClose={() => {}} onReadWiki={() => {}} />
      )
    ).not.toThrow()
  })
})
