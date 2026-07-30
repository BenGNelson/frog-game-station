// The core's own knobs — a CURATED shortlist per system, not everything the
// running core registered.
//
// mupen64plus_next registers around eighty variables; melonDS's screen gap alone
// offers 127 values. That is an emulator's config dialog, not a preference, and
// this app already has the rule: SHADER_LEVELS is four steps out of EmulatorJS's
// fourteen-variant shader drawer, FF_RATIO_LEVELS is four out of every half-step
// to 10x. A system with nothing curated shows no System options row at all.
//
// Only KEYS and LABELS live here — the VALUES come from the running core. That's
// what keeps a hand-authored table honest across a core update: a key the core
// stopped registering simply stops appearing, and a value the core never declared
// can't be sent (the host refuses it). This table is deliberately frontend-only,
// unlike the backend SECTIONS <-> LIBRETRO_CORE mirror: only one side needs it at
// runtime, so there is nothing to drift.
//
// The system keys match the backend's SECTIONS ids (the same string the player
// hands load_game as `core`/`system`).

export const CURATED_OPTIONS = {
  // The DS's screen layout — row 7 parked this here, and it's the reason the host
  // had to start answering SET_GEOMETRY: melonDS changes its picture's SHAPE when
  // the layout changes, not just its contents.
  nds: [
    { key: 'melonds_screen_layout', label: 'Screen layout' },
    // The core offers 0..126. A cycle row is not a slider — five honest steps.
    { key: 'melonds_screen_gap', label: 'Screen gap', only: ['0', '8', '16', '32', '64'] },
    { key: 'melonds_hybrid_ratio', label: 'Hybrid ratio' },
  ],
  // The one genuinely init-only knob worth exposing: mupen reads its plugins at
  // retro_init, so a change can't apply until the next launch. libretro offers no
  // machine-readable way to know that, which is why the flag is hand-authored.
  n64: [
    {
      key: 'mupen64plus-rdp-plugin',
      label: 'Graphics plugin',
      appliesOnRelaunch: true,
      valueLabels: { angrylion: 'Software (accurate)', gliden64: 'GLideN64 (fast)' },
    },
  ],
  // Live: pcsx re-reads the pad type when the update flag goes up, so switching
  // this mid-game kills or revives the sticks immediately.
  psx: [
    {
      key: 'pcsx_rearmed_pad1type',
      label: 'Controller',
      valueLabels: { analog: 'DualShock (sticks)', standard: 'Digital pad' },
    },
  ],
  // Gambatte's palette for original-Game-Boy games — the one cartridge-era knob
  // that changes how a game LOOKS rather than how it runs.
  gb: [{ key: 'gambatte_gb_internal_palette', label: 'Palette' }],
}

// Deliberately not curated yet: gbc/gba (mgba), nes, snes, and the Sega systems.
// Their cores register plenty, but nothing here is authored from a guess — a key
// the core doesn't register renders no row, which is graceful but useless. To add
// one, run the game and read what the host reports (the System options panel is
// fed by list_core_options), then add the key and a label above. The system ids
// are the backend's SECTIONS ids: gb, gbc, gba, nes, snes, segaMD, segaMS,
// segaGG, nds, n64, psx.

/// The rows to draw for this system: the curated entries the RUNNING core
/// actually registered, narrowed to their shortlist, carrying the core's live
/// current value.
export function curatedRows(system, hostOptions = []) {
  const curated = CURATED_OPTIONS[system] || []
  const rows = []
  for (const entry of curated) {
    const host = hostOptions.find((o) => o.key === entry.key)
    // A key this core doesn't offer is not an error — cores change, and a row
    // that can't do anything is worse than no row.
    if (!host || !host.values?.length) continue
    // Narrow to the shortlist, but never to NOTHING: if a core renamed or
    // reordered its values so the intersection is empty, show them all rather
    // than a dead cycle. Same rule as clampShader falling back to a real step.
    let values = entry.only ? host.values.filter((v) => entry.only.includes(v)) : host.values
    if (!values.length) values = host.values
    // A stored choice the shortlist doesn't include still has to be reachable —
    // otherwise the row shows a value the arrows can never return to.
    if (host.current && !values.includes(host.current)) values = [host.current, ...values]
    rows.push({
      key: entry.key,
      label: entry.label,
      appliesOnRelaunch: !!entry.appliesOnRelaunch,
      values,
      current: host.current,
      defaultValue: host.defaultValue,
      valueLabels: entry.valueLabels || {},
    })
  }
  return rows
}

export function hasCuratedOptions(system, hostOptions = []) {
  return curatedRows(system, hostOptions).length > 0
}

/// The value one step left/right of the current one, wrapping — same feel as the
/// filter and FF-speed cycles in the pause menu.
export function stepOptionValue(row, dir) {
  if (!row?.values?.length) return row?.current
  const here = row.values.indexOf(row.current)
  // An unknown current lands on the first step rather than nowhere.
  const from = here === -1 ? 0 : here
  const next = (from + (dir < 0 ? -1 : 1) + row.values.length) % row.values.length
  return row.values[next]
}

/// What to print for a value: the curated friendly name if there is one, else the
/// core's own string (which is usually already readable — "Top/Bottom").
export function valueLabel(row, value = row?.current) {
  if (value == null) return ''
  return row?.valueLabels?.[value] || value
}
