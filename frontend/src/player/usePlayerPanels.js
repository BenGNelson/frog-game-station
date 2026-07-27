import { useCallback, useLayoutEffect, useRef, useState } from 'react'
import { resolveSpecies } from '../lib/pokedexApi.js'

// The in-game reference panels — the wiki reader, the Pokédex, and the cross-links
// between them. Owns their open/mounted state and the pause/resume handoff (a panel
// opened by hotkey mid-play pauses the game and resumes it on close), so any player
// with the same dispatch vocabulary can host them.
export function usePlayerPanels({ dispatch }) {
  // The in-game wiki reader. `wikiMounted` latches true on first open and never resets,
  // so the panel stays in the DOM (hidden) and keeps its article + scroll across a
  // close/reopen; `wikiOpen` toggles its visibility.
  const [wikiOpen, setWikiOpen] = useState(false)
  const [wikiMounted, setWikiMounted] = useState(false)

  // The in-game Pokédex reference (Pokémon games only) — same mounted-persistent shape.
  const [pokedexOpen, setPokedexOpen] = useState(false)
  const [pokedexMounted, setPokedexMounted] = useState(false)

  // Imperative controls the wiki panel exposes (scroll / link nav / back), driven from
  // the gamepad handler while the reader owns the pad.
  const wikiRef = useRef(null)
  // How the reader was opened: from the pause menu (game already paused → close returns
  // to the menu) or by the hotkey mid-play (pause now → close resumes the game).
  const wikiFromGameRef = useRef(false)

  const openWiki = useCallback((fromGame = false) => {
    wikiFromGameRef.current = fromGame
    setWikiMounted(true) // mount-on-first-open, then it persists (keeps scroll/article)
    setWikiOpen(true)
    if (fromGame) dispatch('pause') // the hotkey fires mid-play; pause under the reader
  }, [dispatch])

  const closeWiki = useCallback(() => {
    setWikiOpen(false)
    if (wikiFromGameRef.current) dispatch('resume') // hotkey-opened → back to the game
  }, [dispatch])

  // The Pokédex panel — identical open/close shape (pause on hotkey-open, resume on close).
  const pokedexRef = useRef(null)
  const pokedexFromGameRef = useRef(false)

  const openPokedex = useCallback((fromGame = false) => {
    pokedexFromGameRef.current = fromGame
    setPokedexMounted(true)
    setPokedexOpen(true)
    if (fromGame) dispatch('pause')
  }, [dispatch])

  const closePokedex = useCallback(() => {
    setPokedexOpen(false)
    // Drop any species jump still resolving — otherwise a resolveSpecies that lands after
    // this close would sit in pendingSpecies and yank the user to it on the NEXT open.
    setPendingSpecies(null)
    if (pokedexFromGameRef.current) dispatch('resume')
  }, [dispatch])

  // "Read on Bulbapedia" from the Pokédex — hand off to the wiki reader: hide the Pokédex
  // (no resume; the reader takes over) and open the reader deep-linked to the Pokémon's
  // Bulbapedia page. The reader inherits the resume duty so closing it behaves the same as
  // if opened directly. `pendingRead` defers openTo until the panel has mounted (its ref).
  const [pendingRead, setPendingRead] = useState(null)
  const readFromPokedex = useCallback((bulbapediaTitle) => {
    setPokedexOpen(false)
    wikiFromGameRef.current = pokedexFromGameRef.current
    setWikiMounted(true)
    setWikiOpen(true)
    setPendingRead(bulbapediaTitle)
  }, [])
  // useLayoutEffect (not useEffect): it runs during commit, BEFORE WikiPanel's passive
  // load-once effect flushes — so openTo sets the panel's loadedRef in time and the
  // load-once effect stands down. With a passive effect, the child's load-once fires first
  // and races openTo, landing on the game's default wiki instead of the deep-linked page.
  useLayoutEffect(() => {
    if (pendingRead && wikiOpen && wikiRef.current) {
      wikiRef.current.openTo({ host: 'bulbapedia.bulbagarden.net', title: pendingRead })
      setPendingRead(null)
    }
  }, [pendingRead, wikiOpen])

  // The reverse hop: a species link in a walkthrough → OUR Pokédex. Hide the reader, hand
  // the Pokédex the resume duty (so closing it behaves like a direct open), open it, and —
  // once the Bulbapedia title resolves to a national-dex number — jump straight to that
  // species. If it doesn't resolve (rare: a '(Pokémon)' link PokeAPI has nothing for) the
  // Pokédex just stays on its list rather than dead-ending. Only wired for Pokémon games.
  const [pendingSpecies, setPendingSpecies] = useState(null)
  const readFromWiki = useCallback(async (bulbapediaTitle) => {
    setWikiOpen(false)
    pokedexFromGameRef.current = wikiFromGameRef.current
    setPokedexMounted(true)
    setPokedexOpen(true)
    try {
      const num = await resolveSpecies(bulbapediaTitle)
      if (num) setPendingSpecies(num)
    } catch {
      /* leave the Pokédex on its list — the species just isn't resolvable */
    }
  }, [])
  // Same commit-time reasoning as pendingRead: run before the panel's passive effects so
  // openTo lands as soon as the ref is attached.
  useLayoutEffect(() => {
    if (pendingSpecies != null && pokedexOpen && pokedexRef.current) {
      pokedexRef.current.openTo(pendingSpecies)
      setPendingSpecies(null)
    }
  }, [pendingSpecies, pokedexOpen])

  return {
    wikiOpen,
    wikiMounted,
    wikiRef,
    openWiki,
    closeWiki,
    pokedexOpen,
    pokedexMounted,
    pokedexRef,
    openPokedex,
    closePokedex,
    readFromPokedex,
    readFromWiki,
  }
}
