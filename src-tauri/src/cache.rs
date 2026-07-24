use serde::Serialize;
use std::fs;
use std::path::{Path, PathBuf};
use std::time::SystemTime;

/// Soft cap for on-disk audio cache (bytes). Oldest files are removed first.
const MAX_CACHE_BYTES: u64 = 2 * 1024 * 1024 * 1024; // 2 GiB

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CacheStats {
    pub size_bytes: u64,
    pub file_count: u64,
    pub path: String,
}

fn audio_root(cache_dir: &Path) -> PathBuf {
    let audio = cache_dir.join("audio");
    if audio.is_dir() {
        audio
    } else {
        cache_dir.to_path_buf()
    }
}

fn collect_files(dir: &Path, out: &mut Vec<(PathBuf, u64, SystemTime)>) {
    let Ok(entries) = fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            collect_files(&path, out);
            continue;
        }
        let Ok(meta) = entry.metadata() else {
            continue;
        };
        if !meta.is_file() {
            continue;
        }
        let name = path
            .file_name()
            .and_then(|s| s.to_str())
            .unwrap_or("")
            .to_ascii_lowercase();
        if name.ends_with(".part") {
            continue;
        }
        let modified = meta.modified().unwrap_or(SystemTime::UNIX_EPOCH);
        out.push((path, meta.len(), modified));
    }
}

pub fn stats(cache_dir: &Path) -> CacheStats {
    let root = audio_root(cache_dir);
    let mut files = Vec::new();
    collect_files(&root, &mut files);
    let size_bytes = files.iter().map(|(_, n, _)| *n).sum();
    CacheStats {
        size_bytes,
        file_count: files.len() as u64,
        path: root.to_string_lossy().into_owned(),
    }
}

pub fn clear_all(cache_dir: &Path) -> Result<CacheStats, String> {
    let root = audio_root(cache_dir);
    if root.exists() {
        fs::remove_dir_all(&root).map_err(|e| e.to_string())?;
    }
    fs::create_dir_all(&root).map_err(|e| e.to_string())?;
    Ok(stats(cache_dir))
}

/// Drop oldest cached audio files until total size is under the soft cap.
pub fn enforce_limit(audio_or_cache: &Path) {
    let root = if audio_or_cache.ends_with("audio") || audio_or_cache.join("audio").is_dir() {
        if audio_or_cache.ends_with("audio") {
            audio_or_cache.to_path_buf()
        } else {
            audio_or_cache.join("audio")
        }
    } else if let Some(parent) = audio_or_cache.parent() {
        // Provider subdir like .../audio/netease → evict under .../audio
        if parent.file_name().and_then(|s| s.to_str()) == Some("audio") {
            parent.to_path_buf()
        } else {
            audio_or_cache.to_path_buf()
        }
    } else {
        audio_or_cache.to_path_buf()
    };

    let mut files = Vec::new();
    collect_files(&root, &mut files);
    let mut total: u64 = files.iter().map(|(_, n, _)| *n).sum();
    if total <= MAX_CACHE_BYTES {
        return;
    }
    files.sort_by_key(|(_, _, m)| *m);
    for (path, len, _) in files {
        if total <= MAX_CACHE_BYTES {
            break;
        }
        if fs::remove_file(&path).is_ok() {
            total = total.saturating_sub(len);
        }
    }
}
