// RASTATE — the container libretro save states travel in.
//
// Two players write save states into the SAME library, and they disagreed about
// what a state file IS. EmulatorJS wraps the core's bytes in RASTATE (the format
// RetroArch settled on); the native host hands `retro_serialize` output over raw.
// So every state made on the phone arrived at the desktop's `retro_unserialize`
// still wearing its container, and the core read the magic where it expected its
// own header and refused it — mGBA's rejection even reads "Savestate is for a
// different game", which is what a container looks like through a raw parser.
//
// Row 8 pinned the two players to the SAME cores precisely so states would roam.
// That was necessary and not sufficient: the core matched, the envelope didn't.
//
// The format, all little-endian:
//
//   "RASTATE" + version(u8)        8 bytes
//   then blocks, each:
//     id(4 ASCII) + size(u32) + payload    padded to an 8-byte boundary
//   "MEM " carries the raw core state; "END " with size 0 terminates.
//
// This module is the whole translation. It lives on the JS side of the invoke
// boundary, next to the rest of the duck-typing in nativeEmu.js, which keeps the
// Rust host honest: it serializes and deserializes, and knows nothing about how
// anyone chose to package that.

const MAGIC = 'RASTATE'
const VERSION = 1
const HEADER = 8 // MAGIC + version byte
const BLOCK_HEADER = 8 // 4-byte id + u32 size
const ALIGN = 8

const ascii = (bytes, at, len) => String.fromCharCode(...bytes.subarray(at, at + len))
const alignUp = (n) => (n + (ALIGN - 1)) & ~(ALIGN - 1)

/// Does this look like a RASTATE container? Cheap enough to ask on every load.
export function isRastate(bytes) {
  if (!bytes || bytes.length < HEADER) return false
  return ascii(bytes, 0, MAGIC.length) === MAGIC
}

/// The raw core state inside a container — or the input untouched when it isn't
/// one. Pass-through is not a fallback, it's the compatibility path: every state
/// the native player wrote BEFORE this module existed is raw, and those must keep
/// loading. A container we can't make sense of also passes through rather than
/// throwing, on the same reasoning the shelf uses everywhere else — let the core
/// give the honest verdict on the bytes rather than guessing on its behalf.
export function unwrapRastate(bytes) {
  if (!isRastate(bytes)) return bytes
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  let at = HEADER
  while (at + BLOCK_HEADER <= bytes.length) {
    const id = ascii(bytes, at, 4)
    const size = view.getUint32(at + 4, true)
    const body = at + BLOCK_HEADER
    if (id === 'END ') break
    if (body + size > bytes.length) break // truncated — trust nothing past here
    if (id === 'MEM ') return bytes.subarray(body, body + size)
    // Blocks we don't care about (RPLY replay data, RCHV rewind archives) are
    // skipped by their ALIGNED length — the size field is exact, the next block
    // starts on the next 8-byte boundary.
    at = body + alignUp(size)
  }
  return bytes
}

/// Wrap a raw core state so the other player can read it. Symmetry is the point:
/// unwrapping alone would fix phone→desktop and leave desktop→phone broken, which
/// is the same roaming bug pointing the other way.
export function wrapRastate(mem) {
  const padded = alignUp(mem.length)
  const out = new Uint8Array(HEADER + BLOCK_HEADER + padded + BLOCK_HEADER)
  const view = new DataView(out.buffer)
  for (let i = 0; i < MAGIC.length; i++) out[i] = MAGIC.charCodeAt(i)
  out[MAGIC.length] = VERSION

  let at = HEADER
  for (let i = 0; i < 4; i++) out[at + i] = 'MEM '.charCodeAt(i)
  view.setUint32(at + 4, mem.length, true) // the exact size; the padding is slack
  out.set(mem, at + BLOCK_HEADER)

  at += BLOCK_HEADER + padded
  for (let i = 0; i < 4; i++) out[at + i] = 'END '.charCodeAt(i)
  view.setUint32(at + 4, 0, true)
  return out
}
