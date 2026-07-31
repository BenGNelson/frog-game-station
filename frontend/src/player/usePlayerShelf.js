import { useCallback, useEffect, useMemo, useState } from 'react'
import { postCover, deleteCover } from '../lib/library.js'
import { saveState, loadState, listStates, deleteState } from '../lib/saveStates.js'

// The save-state shelf's state machine — everything behind SaveStatePanel plus the
// confirms and cover actions layered over it. Lives outside PlayerShell so any player
// can host the shelf; the engine is only ever touched through `emuRef.current`
// (saveState/loadState take the live handle), so the host just supplies its own.
export function usePlayerShelf({ id, coverV, emuRef, dispatch, liveShotRef }) {
  // The save-state shelf, layered over the pause menu.
  const [shelfOpen, setShelfOpen] = useState(false)
  const [states, setStates] = useState([])
  const [statesLoading, setStatesLoading] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [shelfFocus, setShelfFocus] = useState(0) // 0 = Save-new tile, 1..N = the states
  const [shelfCols, setShelfCols] = useState(2) // the shelf's real column count, measured
  // A save state pending deletion: the slot awaiting an "are you sure?" confirm. Set by
  // every delete trigger (touch button, keyboard Del, gamepad Y); cleared on Keep/confirm.
  // A delete is irreversible, so it's gated once here rather than at each call site.
  const [pendingDelete, setPendingDelete] = useState(null)
  // Which confirm button the pad has highlighted: 0 = Delete, 1 = Keep. Starts on Delete
  // so the Y → A muscle-memory still deletes, but the d-pad can move to Keep first.
  const [confirmFocus, setConfirmFocus] = useState(0)
  // Custom cover: whether this game already has one (seeds the save shelf's Reset action),
  // and a transient confirmation shown in the shelf after a set/reset.
  const [hasCustomCover, setHasCustomCover] = useState(!!coverV)
  const [coverNotice, setCoverNotice] = useState(null)
  // Activating a state card (pad/keyboard) opens a Load/Delete/Cancel chooser rather than
  // loading outright. chooseSlot = the slot being chosen (null = closed); chooseFocus is an
  // index into SAVE_ACTIONS (SaveActionMenu.jsx), which is the list both the router and the
  // component dispatch from — never a bare number meaning a particular row. Delete hands off
  // to the existing pendingDelete confirm; this only picks.
  const [chooseSlot, setChooseSlot] = useState(null)
  const [chooseFocus, setChooseFocus] = useState(0)
  // The shelf's trailing cover actions, appended after the state cards: always "set from
  // this frame", plus "reset to default" once a custom cover exists.
  const coverActions = useMemo(() => ['setCover', ...(hasCustomCover ? ['resetCover'] : [])], [hasCustomCover])

  const openShelf = useCallback(async () => {
    setShelfOpen(true)
    setError(null)
    setShelfFocus(0)
    setStatesLoading(true)
    const list = await listStates(id)
    setStates(list)
    // Land on the Save-new tile (index 0), so saving a fresh state is one press away:
    // open the shelf, press A, done. Loading a specific save is a short d-pad step down
    // from here — a deliberate choice to favour the action you take under time pressure.
    setShelfFocus(0)
    setStatesLoading(false)
  }, [id])

  const doSave = useCallback(async () => {
    setBusy(true)
    setError(null)
    try {
      // Hand it the frame captured while the game was still on screen — see liveShotRef.
      const res = await saveState(emuRef.current, id, { shot: liveShotRef.current })
      // The local copy always lands; only the upload can fail. Say so rather than
      // claiming success, but don't treat it as an error — the state is safe on
      // this device and the game will still resume from it.
      if (res.offline) setError('Saved on this device. It’ll sync to your other devices when you’re back online.')
      setStates(await listStates(id))
    } catch (e) {
      setError(e?.message || 'Could not save.')
    } finally {
      setBusy(false)
    }
  }, [id, emuRef, liveShotRef])

  const doLoad = useCallback(
    async (slot) => {
      setBusy(true)
      setError(null)
      try {
        await loadState(emuRef.current, id, slot)
        setShelfOpen(false)
        dispatch('resume') // straight back into the game — no reboot
      } catch (e) {
        setError(e?.message || 'Could not load that state.')
      } finally {
        setBusy(false)
      }
    },
    [id, emuRef, dispatch]
  )

  const doDelete = useCallback(
    async (slot) => {
      await deleteState(id, slot)
      setStates(await listStates(id))
    },
    [id]
  )

  // Every delete trigger routes through here first: arm the confirm instead of deleting.
  const requestDelete = useCallback((slot) => {
    if (slot != null) {
      setConfirmFocus(0) // land on Delete each time it opens
      setPendingDelete(slot)
    }
  }, [])

  const confirmDelete = useCallback(() => {
    const slot = pendingDelete
    setPendingDelete(null)
    if (slot != null) doDelete(slot)
  }, [pendingDelete, doDelete])

  const cancelDelete = useCallback(() => setPendingDelete(null), [])

  // Open the Load/Delete chooser for a state card (pad/keyboard path; touch uses the card's
  // own buttons). Lands on Load each time.
  const openChooser = useCallback((slot) => {
    if (slot != null) {
      setChooseFocus(0)
      setChooseSlot(slot)
    }
  }, [])
  const chooseLoad = useCallback(() => {
    const slot = chooseSlot
    setChooseSlot(null)
    if (slot != null) doLoad(slot)
  }, [chooseSlot, doLoad])
  const chooseDelete = useCallback(() => {
    const slot = chooseSlot
    setChooseSlot(null)
    requestDelete(slot) // hand off to the shared "Delete this save state?" confirm
  }, [chooseSlot, requestDelete])

  // Deleting the last card can leave focus pointing past the end of the grid — pull
  // it back to the last real cell (index range is 0 = Save-new, 1..N states, then the
  // trailing cover actions).
  useEffect(() => {
    setShelfFocus((f) => Math.min(f, states.length + coverActions.length))
  }, [states.length, coverActions.length])

  // Set the current live frame as this game's cover. The live-shot timer already keeps a
  // fresh non-black frame in liveShotRef, so there's nothing to capture here — just POST
  // it. Stays on the pause menu and shows a confirmation rather than dropping you back
  // into the game, so you know it took. A black/absent frame (first moments, iOS readback)
  // is reported, never uploaded.
  const doSetCover = useCallback(async () => {
    const shot = liveShotRef.current
    if (!shot) {
      setCoverNotice('Couldn’t grab a frame — give it a second and try again.')
      return
    }
    try {
      const res = await postCover(id, shot)
      if (!res.ok) throw new Error(String(res.status))
      setHasCustomCover(true)
      setCoverNotice('Cover set from this frame.')
    } catch {
      setCoverNotice('Couldn’t set the cover — try again.')
    }
  }, [id, liveShotRef])

  const doResetCover = useCallback(async () => {
    try {
      await deleteCover(id)
      setHasCustomCover(false)
      // 'Reset' is the last trailing tile in the shelf and just vanished; without moving
      // focus back, its index now points past the end, so step back onto the still-present
      // 'Set from this frame' tile.
      setShelfFocus((f) => Math.max(0, f - 1))
      setCoverNotice('Cover reset to the default art.')
    } catch {
      setCoverNotice('Couldn’t reset the cover — try again.')
    }
  }, [id])

  // The confirmation is transient — clear it a couple seconds after it shows.
  useEffect(() => {
    if (!coverNotice) return
    const t = setTimeout(() => setCoverNotice(null), 2600)
    return () => clearTimeout(t)
  }, [coverNotice])

  return {
    shelfOpen,
    setShelfOpen,
    states,
    statesLoading,
    busy,
    error,
    setError,
    shelfFocus,
    setShelfFocus,
    shelfCols,
    setShelfCols,
    pendingDelete,
    confirmFocus,
    setConfirmFocus,
    chooseSlot,
    setChooseSlot,
    chooseFocus,
    setChooseFocus,
    coverActions,
    hasCustomCover,
    coverNotice,
    openShelf,
    doSave,
    doLoad,
    requestDelete,
    confirmDelete,
    cancelDelete,
    openChooser,
    chooseLoad,
    chooseDelete,
    doSetCover,
    doResetCover,
  }
}
