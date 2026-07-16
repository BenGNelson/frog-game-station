// "Close" / exit navigation for an overlay (a reader): return to where you came
// from. If there's in-app history to go back to (React Router tracks a numeric
// `idx` on history.state), go back one — that restores the prior screen AND its
// scroll position, and offline it lands you back on whatever opened the reader
// (the Downloads/hub view), not a dead section list. Otherwise (deep link, fresh
// PWA open) fall through to an explicit fallback route.
export function goBackTarget(historyIdx, fallback) {
  return historyIdx > 0 ? -1 : fallback
}

export function goBack(navigate, fallback) {
  const idx = (typeof window !== 'undefined' && window.history.state?.idx) || 0
  navigate(goBackTarget(idx, fallback))
}
