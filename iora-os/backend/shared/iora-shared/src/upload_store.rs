//! Central secure upload storage for IORA.
//!
//! Provides a single API used by every service that accepts user-supplied
//! binary uploads (themes, apps, app file storage, backups, plugins, …).
//! Goals:
//!
//! * Single configurable root path (e.g. `/var/lib/iora/uploads`).
//! * Atomic writes (tmp-file + rename) for every stored object.
//! * SHA-256 hashing for every stored object.
//! * Strict path sanitisation (no zip-slip, no absolute paths, no `..`).
//! * Hard zip/tar bomb caps (declared + actual size, per-file, entry count).
//! * Refusal of symlinks/hardlinks by default for archive extraction.
//! * Scopes (sub-directories) for tenant/feature isolation.
//!
//! This module is intentionally synchronous; the call-sites we serve are
//! either already inside `spawn_blocking` (ZIP/tar work) or short-lived
//! handler-local writes. Async wrappers can be added on demand.

use std::io::Read;
use std::path::{Component, Path, PathBuf};

use anyhow::{anyhow, bail, Context, Result};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

/// Metadata returned after storing an object.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StoredObject {
    pub id: String,
    pub path: PathBuf,
    pub sha256: String,
    pub size_bytes: u64,
}

/// Limits applied to ZIP extraction.
#[derive(Debug, Clone)]
pub struct ZipExtractLimits {
    /// Total uncompressed bytes allowed across the archive.
    pub max_total_uncompressed: u64,
    /// Maximum size of any single entry.
    pub max_per_file: u64,
    /// Maximum number of entries.
    pub max_entries: usize,
    /// Maximum depth of path components for any entry.
    pub max_path_components: usize,
}

impl Default for ZipExtractLimits {
    fn default() -> Self {
        Self {
            max_total_uncompressed: 256 * 1024 * 1024,
            max_per_file: 64 * 1024 * 1024,
            max_entries: 5_000,
            max_path_components: 32,
        }
    }
}

/// Limits applied to tar (.tar / .tar.gz) extraction.
#[derive(Debug, Clone)]
pub struct TarExtractLimits {
    pub max_total_uncompressed: u64,
    pub max_per_file: u64,
    pub max_entries: usize,
    pub max_path_components: usize,
    /// Allow extraction of symlinks/hardlinks. Default: false.
    pub allow_symlinks: bool,
}

impl Default for TarExtractLimits {
    fn default() -> Self {
        Self {
            max_total_uncompressed: 5 * 1024 * 1024 * 1024,
            max_per_file: 1024 * 1024 * 1024,
            max_entries: 100_000,
            max_path_components: 64,
            allow_symlinks: false,
        }
    }
}

/// Central secure upload store.
#[derive(Debug, Clone)]
pub struct SecureUploadStore {
    base_dir: PathBuf,
}

impl SecureUploadStore {
    /// Create a new store rooted at `base_dir`.
    pub fn new(base_dir: impl Into<PathBuf>) -> Result<Self> {
        let base_dir = base_dir.into();
        std::fs::create_dir_all(&base_dir)
            .with_context(|| format!("create upload store root {}", base_dir.display()))?;
        Ok(Self { base_dir })
    }

    pub fn base_dir(&self) -> &Path {
        &self.base_dir
    }

    /// Resolve and ensure a scope directory exists under the store root.
    /// The scope must contain only `[a-zA-Z0-9_./-]`, no `..`, no leading `/`.
    pub fn scope_dir(&self, scope: &str) -> Result<PathBuf> {
        let safe = sanitize_scope(scope)?;
        let dir = self.base_dir.join(safe);
        std::fs::create_dir_all(&dir)
            .with_context(|| format!("create scope dir {}", dir.display()))?;
        // Ensure no symlink escape via canonicalize comparison.
        let real = std::fs::canonicalize(&dir)?;
        let root = std::fs::canonicalize(&self.base_dir)?;
        if !real.starts_with(&root) {
            bail!("scope escapes store root: {}", dir.display());
        }
        Ok(dir)
    }

    /// Atomically store `data` as a new object inside `scope`. If `name` is
    /// given it is sanitised and used as filename; otherwise a v4 UUID id is
    /// generated.
    pub fn store_bytes(
        &self,
        scope: &str,
        name: Option<&str>,
        data: &[u8],
    ) -> Result<StoredObject> {
        let dir = self.scope_dir(scope)?;
        let id = match name {
            Some(n) => sanitize_filename(n)?,
            None => uuid::Uuid::new_v4().to_string(),
        };
        let target = dir.join(&id);

        let mut hasher = Sha256::new();
        hasher.update(data);
        let sha256 = format!("{:x}", hasher.finalize());

        atomic_write(&target, data)?;

        Ok(StoredObject {
            id,
            path: target,
            sha256,
            size_bytes: data.len() as u64,
        })
    }

    /// Read an object previously written via [`store_bytes`].
    pub fn read(&self, scope: &str, id: &str) -> Result<Vec<u8>> {
        let id = sanitize_filename(id)?;
        let path = self.scope_dir(scope)?.join(id);
        Ok(std::fs::read(path)?)
    }

    /// Delete an object. Missing files are not an error.
    pub fn delete(&self, scope: &str, id: &str) -> Result<()> {
        let id = sanitize_filename(id)?;
        let path = self.scope_dir(scope)?.join(id);
        if path.exists() {
            std::fs::remove_file(path)?;
        }
        Ok(())
    }

    /// Recursively sum the size of all files inside `scope` (in bytes).
    pub fn usage(&self, scope: &str) -> Result<u64> {
        let dir = self.scope_dir(scope)?;
        let mut total: u64 = 0;
        let mut stack = vec![dir];
        while let Some(d) = stack.pop() {
            for entry in std::fs::read_dir(&d)? {
                let entry = entry?;
                let p = entry.path();
                let md = entry.metadata()?;
                if md.is_dir() {
                    stack.push(p);
                } else if md.is_file() {
                    total = total.saturating_add(md.len());
                }
            }
        }
        Ok(total)
    }

    /// Safely extract a ZIP archive into `scope`.
    ///
    /// * Performs a pre-flight pass that rejects archives whose declared
    ///   uncompressed size exceeds the configured caps.
    /// * Uses a streaming `take()` during extraction so a lying ZIP header
    ///   cannot trick us into reading more than the per-file limit.
    /// * Rejects zip-slip (`..`, absolute paths, drive prefixes).
    ///
    /// Returns the (already-existing) scope directory on success.
    pub fn extract_zip(
        &self,
        scope: &str,
        zip_data: &[u8],
        limits: &ZipExtractLimits,
    ) -> Result<PathBuf> {
        use std::io::Cursor;
        let target = self.scope_dir(scope)?;

        let mut archive = zip::ZipArchive::new(Cursor::new(zip_data))
            .map_err(|e| anyhow!("invalid ZIP archive: {}", e))?;

        if archive.len() > limits.max_entries {
            bail!(
                "ZIP contains too many entries ({} > {})",
                archive.len(),
                limits.max_entries
            );
        }

        // Pre-flight: declared sizes.
        let mut declared_total: u64 = 0;
        for i in 0..archive.len() {
            let entry = archive
                .by_index(i)
                .map_err(|e| anyhow!("ZIP entry {}: {}", i, e))?;
            let sz = entry.size();
            if sz > limits.max_per_file {
                bail!(
                    "ZIP entry '{}' exceeds per-file limit ({} > {})",
                    entry.name(),
                    sz,
                    limits.max_per_file
                );
            }
            declared_total = declared_total.saturating_add(sz);
            if declared_total > limits.max_total_uncompressed {
                bail!(
                    "ZIP uncompressed size exceeds limit ({} > {})",
                    declared_total,
                    limits.max_total_uncompressed
                );
            }
        }

        // Extraction with actual-size cap.
        let mut actual_total: u64 = 0;
        for i in 0..archive.len() {
            let mut file = archive
                .by_index(i)
                .map_err(|e| anyhow!("ZIP entry {}: {}", i, e))?;
            let raw_name = file.name().to_string();
            let safe_rel = match sanitize_archive_path(&raw_name, limits.max_path_components) {
                Some(s) => s,
                None => bail!("unsafe ZIP path: {}", raw_name),
            };
            if safe_rel.is_empty() {
                continue;
            }
            let out_path = target.join(&safe_rel);
            if !out_path.starts_with(&target) {
                bail!("ZIP path escapes target: {}", raw_name);
            }

            if file.is_dir() {
                std::fs::create_dir_all(&out_path).ok();
                continue;
            }
            if let Some(p) = out_path.parent() {
                std::fs::create_dir_all(p).ok();
            }

            let limit_with_slack = limits.max_per_file.saturating_add(1);
            let declared = file.size();
            let mut limited = (&mut file).take(limit_with_slack);
            let mut buf = Vec::with_capacity(declared.min(limits.max_per_file) as usize);
            limited
                .read_to_end(&mut buf)
                .with_context(|| format!("read ZIP entry {}", raw_name))?;
            if buf.len() as u64 > limits.max_per_file {
                bail!(
                    "ZIP entry '{}' actual size exceeds per-file limit",
                    raw_name
                );
            }
            actual_total = actual_total.saturating_add(buf.len() as u64);
            if actual_total > limits.max_total_uncompressed {
                bail!(
                    "ZIP actual uncompressed size exceeds limit ({} > {})",
                    actual_total,
                    limits.max_total_uncompressed
                );
            }
            atomic_write(&out_path, &buf)
                .with_context(|| format!("write ZIP entry to {}", out_path.display()))?;
        }
        Ok(target)
    }

    /// Safely extract a tar.gz stream into `scope`.
    ///
    /// * Validates each entry's path (no `..`, no absolute paths, depth cap).
    /// * Enforces per-entry, total, and count caps.
    /// * Rejects symlinks/hardlinks unless `limits.allow_symlinks` is true.
    pub fn extract_tar_gz<R: Read>(
        &self,
        scope: &str,
        reader: R,
        limits: &TarExtractLimits,
    ) -> Result<PathBuf> {
        let target = self.scope_dir(scope)?;
        let canonical_target = std::fs::canonicalize(&target)?;

        let dec = flate2::read::GzDecoder::new(reader);
        let mut archive = tar::Archive::new(dec);
        // Hard-disable tar's own auto-following of suspicious entries.
        archive.set_overwrite(true);
        archive.set_preserve_permissions(false);
        archive.set_unpack_xattrs(false);

        let mut total: u64 = 0;
        let mut count: usize = 0;

        for entry_res in archive.entries()? {
            let mut entry = entry_res?;
            count += 1;
            if count > limits.max_entries {
                bail!("tar contains too many entries (> {})", limits.max_entries);
            }

            let kind = entry.header().entry_type();
            if (kind.is_symlink() || kind.is_hard_link()) && !limits.allow_symlinks {
                bail!("tar entry contains symlink/hardlink (not allowed)");
            }

            let size = entry.header().size().unwrap_or(0);
            if size > limits.max_per_file {
                bail!(
                    "tar entry exceeds per-file limit ({} > {})",
                    size,
                    limits.max_per_file
                );
            }
            total = total.saturating_add(size);
            if total > limits.max_total_uncompressed {
                bail!(
                    "tar exceeds total uncompressed limit ({} > {})",
                    total,
                    limits.max_total_uncompressed
                );
            }

            let raw_path = entry.path()?.into_owned();
            let raw_str = raw_path.to_string_lossy();
            let safe_rel = match sanitize_archive_path(&raw_str, limits.max_path_components) {
                Some(s) => s,
                None => bail!("unsafe tar path: {}", raw_str),
            };
            if safe_rel.is_empty() {
                continue;
            }
            let out_path = target.join(&safe_rel);
            // Second guard: prefix check on the (non-canonical) path.
            if !out_path.starts_with(&target) {
                bail!("tar path escapes target: {}", raw_str);
            }
            if let Some(parent) = out_path.parent() {
                std::fs::create_dir_all(parent).ok();
            }
            entry
                .unpack(&out_path)
                .with_context(|| format!("unpack tar entry {}", raw_str))?;

            // Post-extraction symlink sanity: every realised path must still
            // live below canonical_target.
            if out_path.exists() {
                if let Ok(real) = std::fs::canonicalize(&out_path) {
                    if !real.starts_with(&canonical_target) {
                        let _ = std::fs::remove_file(&out_path);
                        bail!("tar entry resolved outside target: {}", raw_str);
                    }
                }
            }
        }
        Ok(target)
    }
}

// ─── Helpers ────────────────────────────────────────────────────────

/// Safely extract a tar.gz stream into an explicit target directory.
///
/// Provided for callers that already own an absolute, vetted target path
/// (e.g. build/staging tools) and don't want the scope/store layout.
/// The same hardening as [`SecureUploadStore::extract_tar_gz`] applies:
/// no `..`, no absolute paths, no symlinks (unless allowed), per-entry,
/// total and count caps, post-extraction canonicalize check.
pub fn extract_tar_gz_into<R: Read>(
    target: &Path,
    reader: R,
    limits: &TarExtractLimits,
) -> Result<()> {
    std::fs::create_dir_all(target)
        .with_context(|| format!("create tar target {}", target.display()))?;
    let canonical_target = std::fs::canonicalize(target)?;

    let dec = flate2::read::GzDecoder::new(reader);
    let mut archive = tar::Archive::new(dec);
    archive.set_overwrite(true);
    archive.set_preserve_permissions(false);
    archive.set_unpack_xattrs(false);

    let mut total: u64 = 0;
    let mut count: usize = 0;

    for entry_res in archive.entries()? {
        let mut entry = entry_res?;
        count += 1;
        if count > limits.max_entries {
            bail!("tar contains too many entries (> {})", limits.max_entries);
        }

        let kind = entry.header().entry_type();
        if (kind.is_symlink() || kind.is_hard_link()) && !limits.allow_symlinks {
            bail!("tar entry contains symlink/hardlink (not allowed)");
        }

        let size = entry.header().size().unwrap_or(0);
        if size > limits.max_per_file {
            bail!(
                "tar entry exceeds per-file limit ({} > {})",
                size,
                limits.max_per_file
            );
        }
        total = total.saturating_add(size);
        if total > limits.max_total_uncompressed {
            bail!(
                "tar exceeds total uncompressed limit ({} > {})",
                total,
                limits.max_total_uncompressed
            );
        }

        let raw_path = entry.path()?.into_owned();
        let raw_str = raw_path.to_string_lossy();
        let safe_rel = match sanitize_archive_path(&raw_str, limits.max_path_components) {
            Some(s) => s,
            None => bail!("unsafe tar path: {}", raw_str),
        };
        if safe_rel.is_empty() {
            continue;
        }
        let out_path = target.join(&safe_rel);
        if !out_path.starts_with(target) {
            bail!("tar path escapes target: {}", raw_str);
        }
        if let Some(parent) = out_path.parent() {
            std::fs::create_dir_all(parent).ok();
        }
        entry
            .unpack(&out_path)
            .with_context(|| format!("unpack tar entry {}", raw_str))?;

        if out_path.exists() {
            if let Ok(real) = std::fs::canonicalize(&out_path) {
                if !real.starts_with(&canonical_target) {
                    let _ = std::fs::remove_file(&out_path);
                    bail!("tar entry resolved outside target: {}", raw_str);
                }
            }
        }
    }
    Ok(())
}

/// Atomic write: tmp file in same dir, then `rename`. Best effort fsync.
pub fn atomic_write(path: &Path, data: &[u8]) -> std::io::Result<()> {
    let tmp = match path.file_name() {
        Some(n) => {
            let mut t = n.to_os_string();
            t.push(".upload.tmp");
            path.with_file_name(t)
        }
        None => {
            return Err(std::io::Error::new(
                std::io::ErrorKind::InvalidInput,
                "invalid target path",
            ))
        }
    };
    std::fs::write(&tmp, data)?;
    std::fs::rename(&tmp, path)
}

/// Async variant of [`atomic_write`] for use inside Tokio handlers.
///
/// Writes the payload to `<path>.upload.tmp` and renames it into place
/// using `tokio::fs`, so it never blocks the runtime even for large
/// uploads. Caller must ensure the parent directory exists.
pub async fn atomic_write_async(path: &Path, data: &[u8]) -> std::io::Result<()> {
    let tmp = match path.file_name() {
        Some(n) => {
            let mut t = n.to_os_string();
            t.push(".upload.tmp");
            path.with_file_name(t)
        }
        None => {
            return Err(std::io::Error::new(
                std::io::ErrorKind::InvalidInput,
                "invalid target path",
            ))
        }
    };
    tokio::fs::write(&tmp, data).await?;
    tokio::fs::rename(&tmp, path).await
}

fn sanitize_scope(scope: &str) -> Result<String> {
    if scope.is_empty() {
        bail!("empty scope");
    }
    let mut out = String::with_capacity(scope.len());
    for c in scope.chars() {
        match c {
            'a'..='z' | 'A'..='Z' | '0'..='9' | '-' | '_' | '.' | '/' => out.push(c),
            _ => bail!("invalid character in scope {:?}: {:?}", scope, c),
        }
    }
    if out.contains("..") || out.starts_with('/') || out.contains("//") {
        bail!("invalid scope path: {}", scope);
    }
    Ok(out)
}

fn sanitize_filename(name: &str) -> Result<String> {
    if name.is_empty() {
        bail!("empty filename");
    }
    let mut out = String::with_capacity(name.len());
    for c in name.chars() {
        match c {
            'a'..='z' | 'A'..='Z' | '0'..='9' | '-' | '_' | '.' => out.push(c),
            _ => bail!("invalid character in filename {:?}: {:?}", name, c),
        }
    }
    if out.starts_with('.') || out.contains("..") {
        bail!("invalid filename: {}", name);
    }
    Ok(out)
}

/// Validate and normalise a path coming from an archive entry. Returns
/// `Some(rel)` if safe, `None` otherwise.
pub fn sanitize_archive_path(raw: &str, max_components: usize) -> Option<String> {
    let normalised = raw.replace('\\', "/");
    // Reject absolute paths outright instead of silently trimming the slash;
    // a `/etc/passwd` entry has no legitimate meaning inside an upload.
    if normalised.starts_with('/') {
        return None;
    }
    if normalised.is_empty() {
        return Some(String::new());
    }
    let p = Path::new(normalised.as_str());
    let mut depth = 0usize;
    let mut out = PathBuf::new();
    for c in p.components() {
        match c {
            Component::ParentDir | Component::RootDir | Component::Prefix(_) => return None,
            Component::CurDir => continue,
            Component::Normal(s) => {
                let txt = s.to_str()?;
                if txt.is_empty() || txt.contains(':') || txt.contains('\0') {
                    return None;
                }
                depth += 1;
                if depth > max_components {
                    return None;
                }
                out.push(txt);
            }
        }
    }
    Some(out.to_string_lossy().into_owned())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_zip_slip() {
        assert!(sanitize_archive_path("../etc/passwd", 32).is_none());
        assert!(sanitize_archive_path("/etc/passwd", 32).is_none());
        assert!(sanitize_archive_path("a/../../b", 32).is_none());
    }

    #[test]
    fn accepts_normal_paths() {
        assert_eq!(
            sanitize_archive_path("foo/bar.txt", 32).as_deref(),
            Some("foo/bar.txt")
        );
        assert_eq!(
            sanitize_archive_path("./foo/./bar.txt", 32).as_deref(),
            Some("foo/bar.txt")
        );
    }

    #[test]
    fn rejects_too_deep_path() {
        let deep = "a/".repeat(10) + "b";
        assert!(sanitize_archive_path(&deep, 5).is_none());
    }

    #[test]
    fn rejects_bad_scope() {
        assert!(sanitize_scope("../etc").is_err());
        assert!(sanitize_scope("/abs").is_err());
        assert!(sanitize_scope("").is_err());
        assert!(sanitize_scope("foo bar").is_err());
        assert!(sanitize_scope("foo//bar").is_err());
    }

    #[test]
    fn accepts_normal_scope() {
        assert_eq!(sanitize_scope("themes").unwrap(), "themes");
        assert_eq!(sanitize_scope("apps/foo-bar").unwrap(), "apps/foo-bar");
    }

    #[test]
    fn store_roundtrip() {
        let dir = tempdir_like();
        let store = SecureUploadStore::new(&dir).unwrap();
        let stored = store
            .store_bytes("scope/x", Some("hello.txt"), b"hi")
            .unwrap();
        assert_eq!(stored.size_bytes, 2);
        let bytes = store.read("scope/x", &stored.id).unwrap();
        assert_eq!(bytes, b"hi");
        store.delete("scope/x", &stored.id).unwrap();
        let _ = std::fs::remove_dir_all(&dir);
    }

    fn tempdir_like() -> PathBuf {
        let mut p = std::env::temp_dir();
        p.push(format!("iora-upload-store-test-{}", uuid::Uuid::new_v4()));
        p
    }
}
