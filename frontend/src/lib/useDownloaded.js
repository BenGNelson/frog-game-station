import { useEffect, useState } from 'react'
import { allEntries } from './offlineStore.js'

// The full downloaded manifest entries (not just keys), loaded once on mount —
// for views that need the entries themselves (the offline shelf builds its game
// list from them). null until loaded.
export function useDownloadedEntries() {
  const [entries, setEntries] = useState(null)
  useEffect(() => {
    let alive = true
    allEntries()
      .then((es) => alive && setEntries(es))
      .catch(() => alive && setEntries([]))
    return () => {
      alive = false
    }
  }, [])
  return entries
}
