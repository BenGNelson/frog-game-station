// ROM delivery, Mode 1: the backend is remote, so the ROM streams over the
// same authenticated-by-locality HTTP the webview uses
// (GET /api/library/file?section=games&id=...) into a local cache file, and
// the core gets both a path and the bytes (need_fullpath cores read the path,
// the rest take the buffer — same dual hand-off the spike used).

use std::io::Read;
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

/// Fetch (or reuse) the ROM. Returns (path, bytes).
pub fn fetch(rom_url: &str, cache_dir: &Path, game_id: &str) -> Result<(PathBuf, Vec<u8>), String> {
    std::fs::create_dir_all(cache_dir).map_err(|e| format!("rom cache dir: {e}"))?;
    let path = cache_path(cache_dir, game_id);
    if let Ok(bytes) = std::fs::read(&path) {
        if !bytes.is_empty() {
            return Ok((path, bytes));
        }
    }
    let resp = ureq::get(rom_url).call().map_err(|e| format!("rom fetch: {e}"))?;
    let mut bytes = Vec::new();
    resp.into_reader()
        .read_to_end(&mut bytes)
        .map_err(|e| format!("rom read: {e}"))?;
    if bytes.is_empty() {
        return Err("rom fetch returned no bytes".into());
    }
    std::fs::write(&path, &bytes).map_err(|e| format!("rom cache write: {e}"))?;
    Ok((path, bytes))
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
