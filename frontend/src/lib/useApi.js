import { useEffect, useState } from 'react'

// Base path for API calls. Same-origin "/api" in both dev (Vite proxies it)
// and prod (Nginx proxies it), so widgets never hardcode a host.
export const API_BASE = import.meta.env.VITE_API_BASE ?? '/api'

// How a ONE-SHOT fetch retries when it has nothing to show: roughly 1s, 2s, 4s,
// 8s, 15s, then it stops and lets the consumer offer a Retry.
export const RETRY_DELAYS = [1000, 2000, 4000, 8000, 15000]

// Fetches `${API_BASE}${path}` on mount and re-polls every `intervalMs`.
// Returns { data, error, loading, retrying }.
//
// Behaviors that matter for the UI:
//  - On a PATH CHANGE (e.g. selecting a different container) it resets to a
//    loading state and clears the old data, so the consumer can show a spinner
//    instead of the previous item's stale details.
//  - During steady polling of the SAME path it keeps the last good data and
//    only swaps it in on success, so the view doesn't flicker; a failed poll
//    keeps the last good data and surfaces an error.
//  - Polling only runs while the tab is VISIBLE — a backgrounded PWA stops
//    hitting the backend, and regaining visibility kicks an immediate refresh
//    (so the view isn't stale) before resuming the interval.
//  - A ONE-SHOT fetch (intervalMs 0) that fails with NO data retries on a short
//    backoff. Without this a single unlucky request was permanent: the library
//    is fetched once (polling it would churn the array ref and yank the game
//    list's scroll), and its only other refetch trigger is the offline→online
//    edge — which never fires when the server is reachable but that one request
//    failed. The result was an empty library until the app was closed and
//    reopened, and it hit exactly when the backend is slowest: the first load
//    after a restart, when the ROM scan cache is cold. Retrying only while
//    there is NO data means a steady session is untouched — the moment real
//    data lands, this stops for good.
export function useApi(path, intervalMs = 5000) {
  const [state, setState] = useState({ data: null, error: null, loading: true, retrying: false })

  useEffect(() => {
    let cancelled = false
    let retries = 0
    let retryTimer = null
    // Tracked locally, not read from `state`: the effect's closure captures the
    // state at creation, so `state.data` here would be null forever.
    let haveData = false
    setState({ data: null, error: null, loading: true, retrying: false }) // reset on path change

    const load = async () => {
      try {
        const res = await fetch(`${API_BASE}${path}`)
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const json = await res.json()
        if (cancelled) return
        haveData = true
        retries = 0
        setState({ data: json, error: null, loading: false, retrying: false })
      } catch (err) {
        if (cancelled) return
        // Only a one-shot with nothing to show retries: a polling consumer's
        // interval already IS its retry, and one holding last-good data is
        // showing something true.
        const willRetry = !intervalMs && !haveData && retries < RETRY_DELAYS.length
        setState((s) => ({ data: s.data, error: err.message, loading: false, retrying: willRetry }))
        if (willRetry) retryTimer = setTimeout(load, RETRY_DELAYS[retries++])
      }
    }

    // intervalMs of 0 (or falsy) = fetch once, no polling.
    let id = null
    const startPolling = () => {
      if (id == null && intervalMs) id = setInterval(load, intervalMs)
    }
    const stopPolling = () => {
      if (id != null) {
        clearInterval(id)
        id = null
      }
    }
    const onVisibility = () => {
      if (document.visibilityState === 'visible') {
        // Polling consumers refresh on return. A one-shot that already has its
        // answer stays put (re-fetching would churn the reference its consumer
        // is keyed on) — but one still showing NOTHING tries again, because
        // coming back to an empty screen is the moment a person expects it to.
        if (intervalMs || !haveData) {
          clearTimeout(retryTimer) // don't let a pending backoff double-fire
          load()
        }
        startPolling()
      } else {
        stopPolling()
      }
    }

    load()
    if (document.visibilityState !== 'hidden') startPolling()
    document.addEventListener('visibilitychange', onVisibility)

    return () => {
      cancelled = true
      stopPolling()
      clearTimeout(retryTimer)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [path, intervalMs])

  return state
}
