// @vitest-environment jsdom
//
// THE ONE FILE THAT NEEDS A DOM. Every other test in this repo runs in node and
// server-renders, which is fast and keeps DOM globals out of tests that have no
// business seeing them — so jsdom is opted into per file, here, rather than switched
// on globally. If you add another hook test that genuinely needs a document, copy this
// docblock; do not move the setting into vite.config.js.
//
// It earns the exception. What this hook gets wrong is not arithmetic — it is a CLASS
// LATCHED ON A DOCUMENT that outlives the effect. `wakesCursor`, the pure part, is
// already covered next door in pointer.test.js; extracting more of this into a pure
// helper would test something adjacent to the bug and let us claim coverage we do not
// have. A stuck-invisible mouse is only cleared by a reload, so every exit path from
// the effect must take the class off, and that is what these assert.
//
// jsdom IS PINNED TO 26 ON PURPOSE. The dev image (frontend/Dockerfile.dev) is
// node:20-alpine, and jsdom 27+ pulls an undici that needs a Node 22 API — on 20 it
// throws while merely LOADING, which vitest reports as an unhandled error and then
// still exits 0, having silently run zero of this file's tests. Bump the base image
// first if you want a newer jsdom; do not bump jsdom on its own.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { renderHook, act, cleanup } from '@testing-library/react'
import { useIdleCursor, IDLE_CURSOR_MS } from './useIdleCursor.js'
import { CURSOR_HIDDEN_CLASS, resetPointer } from './pointer.js'

const isHidden = () => document.documentElement.classList.contains(CURSOR_HIDDEN_CLASS)
const idle = (ms = IDLE_CURSOR_MS) => act(() => vi.advanceTimersByTime(ms + 1))

const move = (x, y) =>
  act(() => {
    window.dispatchEvent(
      Object.assign(new Event('pointermove'), { pointerType: 'mouse', clientX: x, clientY: y })
    )
  })

// A real mouse move, as the hook's own window listeners see it.
//
// It takes TWO events, and that is the behaviour under test rather than a workaround:
// wakesCursor asks pointer.js whether the pointer actually MOVED, which needs a previous
// position to compare against, so the very first event only seeds the record. That guard
// is why the pad's own scrollIntoView — which emits a move without the mouse going
// anywhere — cannot re-wake the cursor on every focus step and stop the timer ever
// reaching the end.
const mouseMove = () => {
  move(10, 10)
  move(120, 80)
}

beforeEach(() => {
  vi.useFakeTimers()
  // The pointer record is a module-level singleton by design, so a stale position from
  // the previous test would make the first move of the next one look like a non-move.
  resetPointer()
  document.documentElement.classList.remove(CURSOR_HIDDEN_CLASS)
})
afterEach(() => {
  // EXPLICIT, not optional. Testing Library only auto-registers its cleanup when vitest
  // runs with `globals: true`, and this project does not — so without this every hook
  // stays mounted for the rest of the file, and a later test's clock advance fires an
  // earlier test's timer onto the shared <html>. That cost a debugging round here.
  cleanup()
  vi.useRealTimers()
  resetPointer()
  document.documentElement.classList.remove(CURSOR_HIDDEN_CLASS)
})

describe('useIdleCursor', () => {
  it('hides the cursor once the idle window passes', () => {
    const { result } = renderHook(() => useIdleCursor({ enabled: true }))
    expect(result.current.hidden).toBe(false)
    expect(isHidden()).toBe(false)

    idle()
    expect(result.current.hidden).toBe(true)
    expect(isHidden()).toBe(true)
  })

  it('does nothing at all while disabled', () => {
    // The browser passes hidesIdleCursor(mode); the player passes padActive. A false
    // answer must mean the mouse is simply left alone.
    const { result } = renderHook(() => useIdleCursor({ enabled: false }))
    idle()
    expect(result.current.hidden).toBe(false)
    expect(isHidden()).toBe(false)
  })

  it('a mouse move brings it back and restarts the count', () => {
    const { result } = renderHook(() => useIdleCursor({ enabled: true }))
    idle()
    expect(isHidden()).toBe(true)

    mouseMove()
    expect(result.current.hidden).toBe(false)
    expect(isHidden()).toBe(false)

    // Half a window is not enough — the timer restarted, it did not resume.
    act(() => vi.advanceTimersByTime(IDLE_CURSOR_MS / 2))
    expect(isHidden()).toBe(false)
    idle()
    expect(isHidden()).toBe(true)
  })

  it('a keypress does NOT bring it back', () => {
    // Waking on keys or pad buttons would be precisely backwards: the cursor would
    // reappear every time the controller did anything.
    renderHook(() => useIdleCursor({ enabled: true }))
    idle()
    act(() => {
      window.dispatchEvent(new Event('keydown'))
    })
    expect(isHidden()).toBe(true)
  })

  it('unlatches the class when it stops being enabled', () => {
    // The exit path that is easy to miss, because the component stays mounted: the pad
    // goes away mid-session and the mouse must come straight back.
    const { rerender } = renderHook(({ enabled }) => useIdleCursor({ enabled }), {
      initialProps: { enabled: true },
    })
    idle()
    expect(isHidden()).toBe(true)

    rerender({ enabled: false })
    expect(isHidden()).toBe(false)
  })

  it('unlatches the class on unmount', () => {
    // Navigating out of the player while the cursor is hidden must not leave the class
    // on the shared <html> — the library would inherit an invisible mouse.
    const { unmount } = renderHook(() => useIdleCursor({ enabled: true }))
    idle()
    expect(isHidden()).toBe(true)

    unmount()
    expect(isHidden()).toBe(false)
  })

  it('stops listening after unmount', () => {
    const { unmount } = renderHook(() => useIdleCursor({ enabled: true }))
    unmount()
    // A move after teardown must not re-add the class via a surviving listener.
    mouseMove()
    idle()
    expect(isHidden()).toBe(false)
  })

  it('keeps `wake` identity-stable across renders', () => {
    // PlayerShell puts it in an effect's dependency array, so a new identity per render
    // would tear down and re-add the iframe listeners on every state change.
    const { result, rerender } = renderHook(({ enabled }) => useIdleCursor({ enabled }), {
      initialProps: { enabled: true },
    })
    const first = result.current.wake
    rerender({ enabled: true })
    rerender({ enabled: false })
    expect(result.current.wake).toBe(first)
  })

  it('`wake` un-hides activity the hook cannot see for itself', () => {
    // The iframe case: a mouse moved over the running game dispatches into the frame's
    // document and never reaches our window, so the player relays it through here.
    const { result } = renderHook(() => useIdleCursor({ enabled: true }))
    idle()
    expect(isHidden()).toBe(true)

    act(() => result.current.wake())
    expect(isHidden()).toBe(false)
  })

  it('honours a custom idle window', () => {
    renderHook(() => useIdleCursor({ enabled: true, idleMs: 200 }))
    act(() => vi.advanceTimersByTime(201))
    expect(isHidden()).toBe(true)
  })
})
