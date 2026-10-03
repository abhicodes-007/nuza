use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::SystemTime;

/// What the app is allowed to touch: the folder that is open, and whatever the
/// user has pointed at directly through a save dialog.
///
/// Every filesystem command here takes a path from the frontend, and a note is
/// text from disk that a sync client, a collaborator or a generator could have
/// written. Without something in the way, the distance between a malformed note
/// rendering wrong and `delete_entry` being handed someone's home directory is
/// one bug in the markdown sanitiser. The asset protocol has been scoped to the
/// open folder since it was added, for exactly this reason; this is the rest of
/// it.
#[derive(Default)]
pub(crate) struct Vault {
    /// The open folder, resolved. Nothing is allowed before one is opened.
    pub(crate) root: Mutex<Option<PathBuf>>,
    /// Files outside it the user chose in a native dialog, which is consent -
    /// a scratch note saved to the desktop still has to be saved again.
    pub(crate) chosen: Mutex<HashSet<PathBuf>>,
    /// When each note the app has read was last written, as the filesystem
    /// sees it. This is what tells an edit made somewhere else apart from the
    /// app's own saves, in both directions: a write whose file has moved on is
    /// refused, and a change that is only the app's own is not announced.
    pub(crate) known: Mutex<HashMap<PathBuf, SystemTime>>,
    /// Kept alive for as long as its folder is open - dropping a watcher is
    /// how notify stops watching, so replacing this is how switching vaults
    /// stops listening to the old one.
    pub(crate) watcher: Mutex<Option<notify::RecommendedWatcher>>,
}

/// What `write_file` says when the note it was asked to write has moved on
/// since it was read. The frontend matches on this to tell a conflict apart
/// from a disk that is full or a file that has gone read-only.
pub(crate) const CHANGED_ON_DISK: &str = "The note changed on disk";

pub(crate) fn modified_at(path: &Path) -> Option<SystemTime> {
    fs::metadata(path).and_then(|data| data.modified()).ok()
}

/// Records where a note stands now, after reading or writing it.
pub(crate) fn remember(vault: &Vault, path: &Path) {
    if let Some(at) = modified_at(path) {
        locked(&vault.known).insert(path.to_path_buf(), at);
    }
}

/// Whether `path` has moved on since the app last read or wrote it.
///
/// A note the app has never read is not "changed" - there is nothing to be
/// out of date with, and nothing on screen that could be overwritten.
pub(crate) fn changed_since_read(vault: &Vault, path: &Path) -> bool {
    let Some(recorded) = locked(&vault.known).get(path).copied() else {
        return false;
    };
    // Gone, or no longer readable, counts: either way what the app holds is
    // no longer what is there.
    modified_at(path) != Some(recorded)
}

/// A lock, with a poisoned one read anyway: the data behind it is a path and a
/// set of paths, and a panic elsewhere leaves both perfectly readable.
pub(crate) fn locked<T>(lock: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    lock.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
}

/// `resolved` itself, if it is somewhere the app is allowed to be.
pub(crate) fn allow(vault: &Vault, resolved: PathBuf) -> Result<PathBuf, String> {
    let inside = match locked(&vault.root).as_ref() {
        Some(root) => resolved.starts_with(root),
        None => false,
    };

    if inside || locked(&vault.chosen).contains(&resolved) {
        Ok(resolved)
    } else {
        Err("That is outside the open folder".to_string())
    }
}

/// `path`, resolved, if it is inside the open folder.
///
/// Resolved rather than compared as text: `..` and a symlink pointing out of
/// the vault both read as vault paths right up until the OS has had its say.
pub(crate) fn within_vault(vault: &Vault, path: &Path) -> Result<PathBuf, String> {
    let resolved = path.canonicalize().map_err(|e| e.to_string())?;
    allow(vault, resolved)
}

/// A note on its way back to disk: resolved outright when it is there, and
/// through its parent when it is not, so a note deleted from under the app is
/// still one the app may write back. Anything that *is* there - a dangling
/// symlink included - goes the strict way and has to resolve into the vault.
pub(crate) fn within_vault_to_write(vault: &Vault, path: &Path) -> Result<PathBuf, String> {
    if path.symlink_metadata().is_ok() {
        within_vault(vault, path)
    } else {
        within_vault_to_create(vault, path)
    }
}

/// The same for somewhere that is about to exist: there is nothing yet to
/// resolve, so the parent is resolved and the name put back on afterwards.
/// This is also what stops a "name" of `../../elsewhere` from being one.
pub(crate) fn within_vault_to_create(vault: &Vault, path: &Path) -> Result<PathBuf, String> {
    let parent = path
        .parent()
        .ok_or_else(|| "Cannot write to this path".to_string())?;
    let name = path
        .file_name()
        .ok_or_else(|| "Invalid file name".to_string())?;

    let resolved = parent.canonicalize().map_err(|e| e.to_string())?;
    allow(vault, resolved.join(name))
}

/// What the command line the app was started with asked to open, until the
/// window has asked for it.
#[derive(Default)]
pub(crate) struct LaunchTarget(pub(crate) Mutex<Option<crate::cli::OpenTarget>>);
