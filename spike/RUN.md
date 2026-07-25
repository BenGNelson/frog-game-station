# Running the native spike (from a CI artifact)

The artifact contains two binaries and the matching platform's libretro cores:

- `windowed` — the real test: native window, GL, audio, gamepad/keyboard
- `headless` (`frog-native-spike`) — the no-window lifecycle/determinism check
- `cores/` — `gambatte` (Game Boy/Color) and `mupen64plus_next` (N64)

Bring your own ROM (a backup of a cartridge you own). Nothing here downloads games.

## macOS

```bash
tar xzf native-spike-macos.tar.gz && cd native-spike
xattr -dc windowed cores/*.dylib        # strip the quarantine flag (unsigned build)
./windowed cores/mupen64plus_next_libretro.dylib "/path/to/your.z64"
```

## Windows (PowerShell)

```powershell
tar xzf native-spike-windows.tar.gz; cd native-spike
.\windowed.exe cores\mupen64plus_next_libretro.dll "C:\path\to\your.z64"
```

## What to check

1. The game reaches gameplay and feels full-speed (window title's fps is honest —
   watch for stutter/tearing).
2. Audio is present and clean (no crackle).
3. A controller works out of the box (or keyboard: arrows d-pad, IJKL analog,
   X = A, Z = B, E = N64 Z-trigger, Enter = Start).
4. F5 then F7: save state, play a few seconds, load — play resumes where saved.
5. Hold Tab: fast-forward.
6. Let it run ≥5 minutes: no slowdown, no crash.

Report the GL line it prints at startup (version + renderer) with the verdict.
