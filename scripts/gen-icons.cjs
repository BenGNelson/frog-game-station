// Render the PWA / apple-touch PNG icons from the frog mark.
//
// The mark is the SAME flat two-tone silhouette as frogMarkMarkup() in
// frontend/src/frog/art.js (body + eye domes in jade, pupils knocked back to the
// pond ground) — reproduced here as literal primitives so the shipped icons can't
// drift from the app's frog. Run via scripts/gen-icons.sh (a node:20-alpine
// container, so there's no host-Node dependency), then commit the PNGs.
//
// CommonJS on purpose: the container installs sharp into /tmp and points at it with
// NODE_PATH, which only ESM ignores — `require` resolves it.

const sharp = require('sharp')
const { join } = require('node:path')

const GROUND = '#05110D' // FROG.ground
const JADE = '#34D399' //   FROG.jade (52,211,153)

const OUT = join(__dirname, '..', 'frontend', 'public')

// The mark's primitives (viewBox 0 0 100 100), identical to frogMarkMarkup().
const FROG = `
    <ellipse cx="50" cy="62" rx="37" ry="30" fill="${JADE}"/>
    <circle cx="28" cy="30" r="16" fill="${JADE}"/>
    <circle cx="72" cy="30" r="16" fill="${JADE}"/>
    <circle cx="28" cy="29" r="7" fill="${GROUND}"/>
    <circle cx="72" cy="29" r="7" fill="${GROUND}"/>`

// A full-bleed square icon: the frog on the solid pond ground (no rounding — every
// platform rounds/masks app icons itself; pre-rounding would double up). `scale`
// shrinks the frog toward its own centre — 1 for the standard icons (the mark's
// own margin is enough), smaller for the maskable one so it survives the platform's
// circular/rounded safe-area crop.
function iconSvg(size, scale = 1) {
  const cx = 50
  const cy = 53 // the mark's rough vertical centre
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="${size}" height="${size}">
  <rect width="100" height="100" fill="${GROUND}"/>
  <g transform="translate(${cx} ${cy}) scale(${scale}) translate(${-cx} ${-cy})">${FROG}</g>
</svg>`
}

const JOBS = [
  { file: 'pwa-192.png', size: 192, scale: 1 },
  { file: 'pwa-512.png', size: 512, scale: 1 },
  { file: 'apple-touch-icon.png', size: 180, scale: 1 },
  // Maskable: keep the frog inside the ~80% safe zone so Android's mask can't clip it.
  { file: 'pwa-maskable-512.png', size: 512, scale: 0.72 },
]

;(async () => {
  for (const { file, size, scale } of JOBS) {
    // Rasterize at high density for crisp edges, then pin the exact output size
    // (density + an explicit width would otherwise multiply and overshoot).
    await sharp(Buffer.from(iconSvg(size, scale)), { density: 384 })
      .resize(size, size)
      .png()
      .toFile(join(OUT, file))
    console.log(`wrote ${file} (${size}×${size})`)
  }
})()
