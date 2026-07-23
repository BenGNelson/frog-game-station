import { useEffect, useRef, useState } from 'react'
import { FROG } from './theme.js'
import Frog, { Reflected } from './Frog.jsx'
import Caustics from './Caustics.jsx'
import { LilyPads, Bubbles, Firefly } from './pond.jsx'
import { frogDozes } from '../lib/dayNight.js'

// The screensaver: the pond after you've wandered off.
//
// By day the frog hunts — flies wander in on lazy paths, the pupils track the
// nearest one, and every few seconds the tongue snaps it (a catch earns a
// satisfied gulp). Past bedtime (frogDozes) he sleeps instead, and a firefly
// keeps watch. FrogBrowser decides WHEN this shows (idle on a browse screen) and
// unmounts it on any input — this component only draws the scene.
//
// It doubles as burn-in protection for a couch setup left on the shelf: the
// whole scene is dark, slow, and mostly black pixels.
const SNAP_EVERY_MS = 4200
const FLY_COUNT = 3

export default function Screensaver() {
  const asleep = frogDozes()
  const pondRef = useRef(null)
  const frogRef = useRef(null)
  const tongueRef = useRef(null)
  const fliesRef = useRef([])
  const [look, setLook] = useState(null)

  // The flies live outside React state: their positions change every frame, and
  // a rAF writing styles directly is the difference between a screensaver and a
  // space heater. React owns only the look (pupil) state, which changes rarely.
  useEffect(() => {
    if (asleep) return
    const pond = pondRef.current
    if (!pond) return
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

    const spawnFly = () => {
      const el = document.createElement('div')
      el.className = 'pointer-events-none absolute'
      el.setAttribute('aria-hidden', 'true')
      el.innerHTML =
        `<div style="position:absolute;left:-3px;top:-3px;width:12px;height:6px;border-radius:999px;` +
        `background:rgba(220,255,240,0.3);filter:blur(1px)" class="frog-wing"></div>` +
        `<div style="width:6px;height:6px;border-radius:999px;background:#2e4a3c;` +
        `box-shadow:inset 0 0 0 1px rgba(${FROG.lineRGB}, 0.4)"></div>`
      pond.appendChild(el)
      fliesRef.current.push({
        el,
        cx: 15 + Math.random() * 70,
        cy: 8 + Math.random() * 40,
        ax: 4 + Math.random() * 9,
        ay: 3 + Math.random() * 7,
        fx: 0.25 + Math.random() * 0.4,
        fy: 0.3 + Math.random() * 0.5,
        ph: Math.random() * Math.PI * 2,
        x: 50,
        y: 30,
      })
    }
    for (let i = 0; i < FLY_COUNT; i++) spawnFly()

    let raf
    const t0 = performance.now()
    const tick = (now) => {
      const t = (now - t0) / 1000
      for (const f of fliesRef.current) {
        f.x = f.cx + f.ax * Math.sin(t * f.fx * Math.PI * 2 + f.ph)
        f.y = f.cy + f.ay * Math.sin(t * f.fy * Math.PI * 2 + f.ph * 1.7)
        f.el.style.left = `${f.x}%`
        f.el.style.top = `${f.y}%`
      }
      raf = requestAnimationFrame(tick)
    }
    if (!reduced) raf = requestAnimationFrame(tick)

    const mouthPoint = () => {
      const pr = pond.getBoundingClientRect()
      const fr = frogRef.current.getBoundingClientRect()
      return {
        pr,
        x: fr.left - pr.left + fr.width / 2,
        y: fr.top - pr.top + fr.height * 0.58,
      }
    }

    const snap = setInterval(() => {
      if (reduced || !fliesRef.current.length || !frogRef.current) return
      const { pr, x: mx, y: my } = mouthPoint()
      let best = null
      for (const f of fliesRef.current) {
        const px = (f.x / 100) * pr.width
        const py = (f.y / 100) * pr.height
        const d = Math.hypot(px - mx, py - my)
        if (!best || d < best.d) best = { f, d, px, py }
      }
      // Eyes first, then the strike — the glance is what sells the hunt.
      setLook({
        x: Math.max(-1, Math.min(1, (best.px - mx) / (pr.width / 3))) * 2.4,
        y: Math.max(-1, Math.min(1, (best.py - my) / (pr.height / 3))) * 2,
      })
      const tongue = tongueRef.current
      const ang = Math.atan2(best.py - my, best.px - mx)
      tongue.style.left = `${mx}px`
      tongue.style.top = `${my - 2.5}px`
      tongue.style.transform = `rotate(${ang}rad)`
      tongue.style.width = `${best.d}px`
      setTimeout(() => {
        best.f.el.remove()
        fliesRef.current = fliesRef.current.filter((f) => f !== best.f)
        tongue.style.width = '0px'
        const svg = frogRef.current?.querySelector('svg')
        if (svg) {
          svg.classList.remove('frog-gulp')
          void svg.getBoundingClientRect() // restart the one-shot animation
          svg.classList.add('frog-gulp')
        }
        setLook(null)
        setTimeout(spawnFly, 1600 + Math.random() * 1800)
      }, 160)
    }, SNAP_EVERY_MS)

    const flies = fliesRef.current
    return () => {
      cancelAnimationFrame(raf)
      clearInterval(snap)
      for (const f of flies) f.el.remove()
      fliesRef.current = []
    }
  }, [asleep])

  return (
    <div
      ref={pondRef}
      data-testid="frog-screensaver"
      className="frog-rise fixed inset-0 z-[60] overflow-hidden"
      style={{ background: FROG.ground }}
      role="presentation"
    >
      <Caustics />
      <LilyPads />
      <Bubbles count={4} rise="-45vh" />
      {asleep && <Firefly />}

      <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2">
        <div
          className="pointer-events-none absolute left-1/2 top-1/2 h-[60vmin] w-[60vmin] -translate-x-1/2 -translate-y-1/2"
          style={{ background: `radial-gradient(circle, rgba(${FROG.jade}, 0.12), transparent 62%)` }}
        />
        <div ref={frogRef} className="relative">
          <Reflected scale={0.5}>
            <Frog size={180} asleep={asleep} look={look || undefined} />
          </Reflected>
        </div>
      </div>

      <div ref={tongueRef} className="frog-tongue absolute z-10 h-[5px] w-0 origin-left rounded-full" style={{ background: '#E2557B' }} aria-hidden="true" />
    </div>
  )
}
