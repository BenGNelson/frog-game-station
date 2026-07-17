import { useEffect, useState } from 'react'

// When the frog dozes.
//
// The mascot already knows how to shut its eyes (the `asleep` prop → closed-eye art);
// this just decides *when*, from the wall clock. Night is 22:00–05:59 local — late
// enough that "it's evening" doesn't read as "the app is broken", early enough that a
// 2am session gets a sleepy frog keeping you company.
//
// Pure and date-injectable so the boundary hours are a unit test, not a guess.
export function frogDozes(date = new Date()) {
  const hour = date.getHours()
  return hour >= 22 || hour < 6
}

// The live version: the frog should nod off if you leave the shelf open past bedtime,
// so re-check on a slow tick (a minute is plenty — the transition is one edge a day)
// and only re-render when the answer actually flips.
export function useDozing() {
  const [dozing, setDozing] = useState(() => frogDozes())
  useEffect(() => {
    const id = setInterval(() => setDozing(frogDozes()), 60_000)
    return () => clearInterval(id)
  }, [])
  return dozing
}
