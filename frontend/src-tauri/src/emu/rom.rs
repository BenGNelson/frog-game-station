// ROM delivery, Mode 1: the backend is remote, so the ROM streams over the
// same authenticated-by-locality HTTP the webview uses
// (GET /api/library/file?section=games&id=...) into a local cache file, and
// the core gets both a path and the bytes (need_fullpath cores read the path,
// the rest take the buffer — same dual hand-off the spike used).

use std::io::{Read, Write};
use std::path::{Path, PathBuf};

/// FNV-1a, the house change-detector — here it just makes a filesystem-safe
/// cache name out of an arbitrary game id (ids are backend paths).
fn fnv1a(bytes: &[u8]) -> u64 {
    let mut h: u64 = 0xcbf2_9ce4_8422_2325;
    for b in bytes {
        h ^= *b as u64;
        h = h.wrapping_mul(0x1_0000_01b3);
    }
    h
}

pub fn cache_path(cache_dir: &Path, game_id: &str) -> PathBuf {
    let ext = game_id.rsplit('.').next().filter(|e| e.len() <= 4 && !e.contains('/'));
    let name = match ext {
        Some(e) => format!("{:016x}.{}", fnv1a(game_id.as_bytes()), e),
        None => format!("{:016x}", fnv1a(game_id.as_bytes())),
    };
    cache_dir.join(name)
}

/// Fetch (or reuse) the ROM, STREAMING to the cache file. Returns its path.
///
/// Deliberately never holds the whole game in memory: a Game Boy ROM is a few
/// hundred KB, but a PlayStation disc is hundreds of megabytes, and cores that
/// declare `need_fullpath` (every disc core) read it off disk themselves — so
/// buffering it would be pure waste. The session loads the bytes afterwards
/// only for the cores that actually want a buffer.
pub fn fetch(
    rom_url: &str,
    cache_dir: &Path,
    game_id: &str,
    mut progress: impl FnMut(u64, u64),
) -> Result<PathBuf, String> {
    std::fs::create_dir_all(cache_dir).map_err(|e| format!("rom cache dir: {e}"))?;
    let path = cache_path(cache_dir, game_id);
    if std::fs::metadata(&path).map(|m| m.len() > 0).unwrap_or(false) {
        return Ok(path);
    }
    let resp = ureq::get(rom_url).call().map_err(|e| format!("rom fetch: {e}"))?;
    let total: u64 = resp
        .header("Content-Length")
        .and_then(|v| v.parse().ok())
        .unwrap_or(0);
    // Write to a temp sibling first: an interrupted download must never look
    // like a complete cache hit on the next launch.
    let partial = path.with_extension("partial");
    let mut out = std::fs::File::create(&partial).map_err(|e| format!("rom cache write: {e}"))?;
    // Copy in chunks rather than io::copy, so the caller can report progress —
    // a disc image is hundreds of megabytes and the player must be able to tell
    // "still arriving" from "stalled".
    let mut reader = resp.into_reader();
    let mut buf = vec![0u8; 256 * 1024];
    let mut copied: u64 = 0;
    let mut last_ping = 0u64;
    loop {
        let n = reader.read(&mut buf).map_err(|e| format!("rom read: {e}"))?;
        if n == 0 {
            break;
        }
        out.write_all(&buf[..n]).map_err(|e| format!("rom cache write: {e}"))?;
        copied += n as u64;
        if copied - last_ping >= 1_000_000 {
            last_ping = copied;
            progress(copied, total);
        }
    }
    drop(out);
    if copied == 0 {
        let _ = std::fs::remove_file(&partial);
        return Err("rom fetch returned no bytes".into());
    }
    std::fs::rename(&partial, &path).map_err(|e| format!("rom cache write: {e}"))?;
    Ok(path)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cache_names_are_filesystem_safe_and_keep_the_extension() {
        let dir = Path::new("/tmp");
        let p = cache_path(dir, "Nintendo64/Mario Kart 64 (USA).z64");
        let name = p.file_name().unwrap().to_string_lossy().into_owned();
        assert!(name.ends_with(".z64"));
        assert!(!name.contains('/'));
        assert!(!name.contains(' '));
    }

    #[test]
    fn ids_without_extensions_still_name_cleanly() {
        let p = cache_path(Path::new("/tmp"), "weird-id-no-ext");
        assert_eq!(p.extension(), None);
    }
}
