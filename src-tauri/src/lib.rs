// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/

use notify::{RecursiveMode, Watcher};
use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::SystemTime;
#[cfg(target_os = "macos")]
use tauri::Wry;
use tauri::{Emitter, Manager};
use tauri_plugin_dialog::DialogExt;
#[cfg(target_os = "windows")]
use window_vibrancy::{apply_acrylic, apply_mica, clear_acrylic, clear_mica};
#[cfg(target_os = "macos")]
use window_vibrancy::{apply_vibrancy, clear_vibrancy, NSVisualEffectMaterial};

#[derive(serde::Serialize)]
struct FileEntry {
    name: String,
    path: String,
    #[serde(rename = "isDirectory")] // this ensures the JSON key is camel case
    is_directory: bool,
    children: Option<Vec<FileEntry>>,
}

/// Entries that are never notes: the dot-directories tools keep their own state
/// in, and dependency folders. A vault that happens to sit inside a repository
/// or a project can carry far more of these than it does notes, and walking
/// them costs more than everything the sidebar is actually there to show.
fn is_ignored(name: &str) -> bool {
    name.starts_with('.') || name == "node_modules"
}

fn read_dir_recursive(path: &Path) -> Result<Vec<FileEntry>, String> {
    let mut entries = Vec::new();

    if path.is_dir() {
        // Read the directory contents
        for entry in fs::read_dir(path).map_err(|e| e.to_string())? {
            let entry = entry.map_err(|e| e.to_string())?;
            let entry_path = entry.path();
            let name = entry.file_name().to_string_lossy().into_owned();

            if is_ignored(&name) {
                continue;
            }

            let is_directory = entry_path.is_dir();

            // If it's a directory, recursively read its children
            let children = if is_directory {
                Some(read_dir_recursive(&entry_path)?)
            } else {
                None
            };

            entries.push(FileEntry {
                name,
                path: entry_path.to_string_lossy().into_owned(),
                is_directory,
                children,
            });
        }
    }

    // Sort so directories appear first, then alphabetically
    entries.sort_by(|a, b| {
        b.is_directory
            .cmp(&a.is_directory)
            .then(a.name.to_lowercase().cmp(&b.name.to_lowercase()))
    });

    Ok(entries)
}

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
struct Vault {
    /// The open folder, resolved. Nothing is allowed before one is opened.
    root: Mutex<Option<PathBuf>>,
    /// Files outside it the user chose in a native dialog, which is consent -
    /// a scratch note saved to the desktop still has to be saved again.
    chosen: Mutex<HashSet<PathBuf>>,
    /// When each note the app has read was last written, as the filesystem
    /// sees it. This is what tells an edit made somewhere else apart from the
    /// app's own saves, in both directions: a write whose file has moved on is
    /// refused, and a change that is only the app's own is not announced.
    known: Mutex<HashMap<PathBuf, SystemTime>>,
    /// Kept alive for as long as its folder is open - dropping a watcher is
    /// how notify stops watching, so replacing this is how switching vaults
    /// stops listening to the old one.
    watcher: Mutex<Option<notify::RecommendedWatcher>>,
}

/// Announced when a note has changed underneath the app, carrying its path.
const FILE_CHANGED_EVENT: &str = "file-changed";

/// What `write_file` says when the note it was asked to write has moved on
/// since it was read. The frontend matches on this to tell a conflict apart
/// from a disk that is full or a file that has gone read-only.
const CHANGED_ON_DISK: &str = "The note changed on disk";

fn modified_at(path: &Path) -> Option<SystemTime> {
    fs::metadata(path).and_then(|data| data.modified()).ok()
}

/// Records where a note stands now, after reading or writing it.
fn remember(vault: &Vault, path: &Path) {
    if let Some(at) = modified_at(path) {
        locked(&vault.known).insert(path.to_path_buf(), at);
    }
}

/// Whether `path` has moved on since the app last read or wrote it.
///
/// A note the app has never read is not "changed" - there is nothing to be
/// out of date with, and nothing on screen that could be overwritten.
fn changed_since_read(vault: &Vault, path: &Path) -> bool {
    let Some(recorded) = locked(&vault.known).get(path).copied() else {
        return false;
    };
    // Gone, or no longer readable, counts: either way what the app holds is
    // no longer what is there.
    modified_at(path) != Some(recorded)
}

/// Watches the open folder and says so when a note in it changes.
///
/// Without this the app is the last to know. A `git pull`, a sync client or a
/// second editor moves a note on disk, the tab still shows what was read
/// minutes ago, and the first keystroke after that autosaves the stale buffer
/// over the newer file.
fn watch_vault(app_handle: &tauri::AppHandle, root: &Path) -> Result<(), String> {
    let handle = app_handle.clone();

    let mut watcher = notify::recommended_watcher(move |event: notify::Result<notify::Event>| {
        let Ok(event) = event else { return };
        if !event.kind.is_modify() && !event.kind.is_create() && !event.kind.is_remove() {
            return;
        }

        let vault = handle.state::<Vault>();
        for path in event.paths {
            // Only notes the app is actually holding, and only when what is on
            // disk is no longer what it read - which is what keeps the app's
            // own saves from coming back as news.
            if changed_since_read(&vault, &path) {
                let _ = handle.emit(FILE_CHANGED_EVENT, path.to_string_lossy().into_owned());
            }
        }
    })
    .map_err(|e| e.to_string())?;

    watcher
        .watch(root, RecursiveMode::Recursive)
        .map_err(|e| e.to_string())?;

    // Replacing the old watcher drops it, which is how it stops watching.
    *locked(&app_handle.state::<Vault>().watcher) = Some(watcher);
    Ok(())
}

/// A lock, with a poisoned one read anyway: the data behind it is a path and a
/// set of paths, and a panic elsewhere leaves both perfectly readable.
fn locked<T>(lock: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    lock.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
}

/// `resolved` itself, if it is somewhere the app is allowed to be.
fn allow(vault: &Vault, resolved: PathBuf) -> Result<PathBuf, String> {
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
fn within_vault(vault: &Vault, path: &Path) -> Result<PathBuf, String> {
    let resolved = path.canonicalize().map_err(|e| e.to_string())?;
    allow(vault, resolved)
}

/// A note on its way back to disk: resolved outright when it is there, and
/// through its parent when it is not, so a note deleted from under the app is
/// still one the app may write back. Anything that *is* there - a dangling
/// symlink included - goes the strict way and has to resolve into the vault.
fn within_vault_to_write(vault: &Vault, path: &Path) -> Result<PathBuf, String> {
    if path.symlink_metadata().is_ok() {
        within_vault(vault, path)
    } else {
        within_vault_to_create(vault, path)
    }
}

/// The same for somewhere that is about to exist: there is nothing yet to
/// resolve, so the parent is resolved and the name put back on afterwards.
/// This is also what stops a "name" of `../../elsewhere` from being one.
fn within_vault_to_create(vault: &Vault, path: &Path) -> Result<PathBuf, String> {
    let parent = path
        .parent()
        .ok_or_else(|| "Cannot write to this path".to_string())?;
    let name = path
        .file_name()
        .ok_or_else(|| "Invalid file name".to_string())?;

    let resolved = parent.canonicalize().map_err(|e| e.to_string())?;
    allow(vault, resolved.join(name))
}

/// Tauri's dialog pickers deliver their result via a callback fired from a
/// separate thread, but a `#[tauri::command]` needs to return a value - this
/// blocks the async command on a channel until that callback runs.
fn block_on_picker<T, F>(register: F) -> Result<T, String>
where
    T: Send + 'static,
    F: FnOnce(Box<dyn FnOnce(Result<T, String>) + Send>),
{
    let (tx, rx) = std::sync::mpsc::channel();
    register(Box::new(move |result| {
        let _ = tx.send(result);
    }));
    rx.recv().map_err(|e| format!("Channel error: {}", e))?
}

/// Runs `work` somewhere that is not the thread pumping the window.
///
/// A `#[tauri::command]` declared `fn` rather than `async fn` is called on the
/// main thread, which is also the thread running the event loop: while it is
/// reading a note, the window is not drawing, resizing or listening to the
/// keyboard. Every command below does filesystem work whose cost is the size
/// of what it is working on - a vault walked at startup, a note read on a tab
/// switch, an attachment decoded and written - so each of them was a stall the
/// length of that work, several times a minute in the case of autosave.
///
/// Declaring them `async` hands them to the async runtime; this then hands the
/// blocking part to a thread that is allowed to block. The state they need is
/// reached through the `AppHandle` rather than taken as a `State<'_, Vault>`,
/// because that borrow cannot cross onto another thread.
///
/// One thing does change with them: commands no longer run one after another
/// in the order they arrived. Nothing here relies on that - a note is written
/// atomically and the frontend debounces per path - but two writes to the same
/// note now finish in whichever order the OS gets to them rather than in call
/// order.
async fn off_thread<T, F>(work: F) -> Result<T, String>
where
    T: Send + 'static,
    F: FnOnce() -> Result<T, String> + Send + 'static,
{
    tauri::async_runtime::spawn_blocking(work)
        .await
        .map_err(|e| e.to_string())?
}

#[derive(serde::Serialize)]
struct OpenedFolder {
    path: String,
    entries: Vec<FileEntry>,
}

/// Takes a folder on as the open one: reads its tree, and lets the asset
/// protocol reach inside it so a note's images resolve. Images embedded in a
/// note are served over that protocol, which is handed this folder and nothing
/// else - a note is text from disk that anything could have written, and it has
/// no business reaching the rest of it.
fn adopt_folder(app_handle: &tauri::AppHandle, path: String) -> Result<OpenedFolder, String> {
    let directory = Path::new(&path);
    if !directory.is_dir() {
        return Err(format!("\"{}\" is not there any more", path));
    }

    app_handle
        .asset_protocol_scope()
        .allow_directory(&path, true)
        .map_err(|e| e.to_string())?;

    // The one place the boundary is set. Resolved here so that every later
    // check is a comparison between two paths the OS has already agreed on.
    let resolved = directory.canonicalize().map_err(|e| e.to_string())?;
    {
        let vault = app_handle.state::<Vault>();
        *locked(&vault.root) = Some(resolved.clone());
        // The notes of the folder being left are no longer anything to be out
        // of date with.
        locked(&vault.known).clear();
    }

    // A folder that cannot be watched is still a folder worth opening; what is
    // lost is the notice, not the vault.
    if let Err(error) = watch_vault(app_handle, &resolved) {
        eprintln!("nuza: not watching \"{}\" for changes: {}", path, error);
    }

    let entries = read_dir_recursive(directory)?;
    Ok(OpenedFolder { path, entries })
}

/// Opens a native "open folder" dialog and returns the folder's path plus its
/// contents as a tree, read recursively. Returns `None` if the user cancels.
#[tauri::command]
async fn load_folder_picker(app_handle: tauri::AppHandle) -> Result<Option<OpenedFolder>, String> {
    let scope = app_handle.clone();
    block_on_picker(|send| {
        app_handle.dialog().file().pick_folder(move |folder_path| {
            let result = match folder_path {
                Some(path) => adopt_folder(&scope, path.to_string()).map(Some),
                None => Ok(None),
            };
            send(result);
        });
    })
}

/// Reopens a folder the app already knows about, without asking for it again.
#[tauri::command]
async fn open_folder(app_handle: tauri::AppHandle, path: String) -> Result<OpenedFolder, String> {
    off_thread(move || adopt_folder(&app_handle, path)).await
}

#[tauri::command]
async fn create_file(
    app_handle: tauri::AppHandle,
    parent_path: String,
    name: String,
) -> Result<(), String> {
    off_thread(move || {
        let vault = app_handle.state::<Vault>();
        let name = exact_file_name(&name)?;
        let path = within_vault_to_create(&vault, &Path::new(&parent_path).join(&name))?;

        // `create_new` rather than a check and then a create: the check is a
        // statement about a moment that has passed by the time the file is
        // made, and `File::create` truncates whatever it finds. Together those
        // are a note emptied by someone else creating it first.
        fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&path)
            .map(|_| ())
            .map_err(|error| match already_exists(&error) {
                true => format!("\"{}\" already exists", name),
                false => error.to_string(),
            })
    })
    .await
}

#[tauri::command]
async fn create_folder(
    app_handle: tauri::AppHandle,
    parent_path: String,
    name: String,
) -> Result<(), String> {
    off_thread(move || {
        let vault = app_handle.state::<Vault>();
        let name = exact_file_name(&name)?;
        let path = within_vault_to_create(&vault, &Path::new(&parent_path).join(&name))?;

        // `create_dir` is already all-or-nothing; it just needed to be the
        // thing that decides, rather than a check in front of it.
        fs::create_dir(&path).map_err(|error| match already_exists(&error) {
            true => format!("\"{}\" already exists", name),
            false => error.to_string(),
        })
    })
    .await
}

/// Renames a file or folder in place, keeping it in the same parent
/// directory. Returns the new full path.
#[tauri::command]
async fn rename_entry(
    app_handle: tauri::AppHandle,
    path: String,
    new_name: String,
) -> Result<String, String> {
    off_thread(move || {
        let vault = app_handle.state::<Vault>();
        let new_name = exact_file_name(&new_name)?;
        let old = within_vault(&vault, Path::new(&path))?;
        let parent = old
            .parent()
            .ok_or_else(|| "Cannot rename this item".to_string())?;
        let new_path = within_vault_to_create(&vault, &parent.join(&new_name))?;

        rename_no_replace(&old, &new_path).map_err(|error| match already_exists(&error) {
            true => format!("\"{}\" already exists", new_name),
            false => error.to_string(),
        })?;
        Ok(new_path.to_string_lossy().into_owned())
    })
    .await
}

/// Moves a file or folder into `target_dir` (e.g. from a drag-and-drop),
/// keeping its name. Returns the new full path.
#[tauri::command]
async fn move_entry(
    app_handle: tauri::AppHandle,
    path: String,
    target_dir: String,
) -> Result<String, String> {
    off_thread(move || {
        let vault = app_handle.state::<Vault>();
        let (old, new_path) = move_destination(&vault, &path, &target_dir)?;
        let name = new_path.file_name().unwrap_or_default().to_string_lossy();

        rename_no_replace(&old, &new_path).map_err(|error| match already_exists(&error) {
            true => format!("\"{}\" already exists in destination", name),
            false => error.to_string(),
        })?;
        Ok(new_path.to_string_lossy().into_owned())
    })
    .await
}

/// Where the entry at `path` would land inside `target_dir`, as the pair of
/// resolved paths `fs::rename` needs, or why the move cannot happen.
///
/// Apart from the command so that the guards can be exercised without a window
/// and a running app: the one that matters most is the last, and getting it
/// wrong is a lost subtree rather than an error message.
fn move_destination(
    vault: &Vault,
    path: &str,
    target_dir: &str,
) -> Result<(PathBuf, PathBuf), String> {
    let old = within_vault(vault, Path::new(path))?;
    let name = old
        .file_name()
        .ok_or_else(|| "Invalid path".to_string())?
        .to_owned();
    let target = within_vault(vault, Path::new(target_dir))?;

    if !target.is_dir() {
        return Err("That is not a folder to move into".to_string());
    }

    // Both sides came back from `within_vault` resolved, which is what makes a
    // component-wise `starts_with` the right test here: a target written with
    // `..`, or reached through a symlink sitting inside the folder being moved,
    // is already spelled out as the directory it really is by the time it gets
    // this far. Comparing the two strings the frontend sent would not be -
    // `fs::rename` of a directory into its own descendant loses the subtree.
    if old.is_dir() && target.starts_with(&old) {
        return Err("Cannot move a folder into itself".to_string());
    }

    let new_path = target.join(&name);
    if new_path.exists() {
        return Err(format!(
            "\"{}\" already exists in destination",
            name.to_string_lossy()
        ));
    }

    Ok((old, new_path))
}

#[tauri::command]
async fn delete_entry(app_handle: tauri::AppHandle, path: String) -> Result<(), String> {
    off_thread(move || {
        let vault = app_handle.state::<Vault>();
        let p = within_vault(&vault, Path::new(&path))?;
        if p.is_dir() {
            fs::remove_dir_all(&p).map_err(|e| e.to_string())
        } else {
            fs::remove_file(&p).map_err(|e| e.to_string())
        }
    })
    .await
}

/// Opens a native "save file" dialog and writes `content` to the chosen path.
/// Returns the chosen path, or `None` if the user cancels the dialog.
#[tauri::command]
async fn save_file_picker(
    app_handle: tauri::AppHandle,
    content: String,
) -> Result<Option<String>, String> {
    let chosen = app_handle.clone();
    block_on_picker(|send| {
        app_handle
            .dialog()
            .file()
            .add_filter("Markdown Files", &["md", "markdown"])
            .set_file_name("untitled.md")
            .save_file(move |file_path| {
                let result = match file_path {
                    Some(path) => {
                        let path_str = path.to_string();
                        match write_atomically(Path::new(&path_str), content.as_bytes()) {
                            Ok(_) => {
                                // Somewhere the user pointed at themselves, which
                                // may well be outside the open folder. Recorded so
                                // that the autosave that follows is allowed to
                                // keep writing the note they just saved.
                                if let Ok(resolved) = Path::new(&path_str).canonicalize() {
                                    locked(&chosen.state::<Vault>().chosen).insert(resolved);
                                }
                                Ok(Some(path_str))
                            }
                            Err(e) => Err(format!("Failed to write file: {}", e)),
                        }
                    }
                    None => Ok(None),
                };
                send(result);
            });
    })
}

/// Names Win32 hands to a device rather than a file, whatever extension is put
/// on the end of them. Creating one fails, or opens a console.
const RESERVED_NAMES: &[&str] = &[
    "con", "prn", "aux", "nul", "com1", "com2", "com3", "com4", "com5", "com6", "com7", "com8",
    "com9", "lpt1", "lpt2", "lpt3", "lpt4", "lpt5", "lpt6", "lpt7", "lpt8", "lpt9",
];

/// Characters that make a name something other than a name: `:` opens an NTFS
/// alternate data stream, so `note.md:hidden` writes bytes the file tree has
/// no way to see, and the rest are Win32 wildcards or redirections.
const FORBIDDEN_CHARS: &[char] = &['"', '*', ':', '<', '>', '?', '|'];

/// Whether `name` would be a reserved device name on Windows. The extension is
/// not part of the question: `aux.md` is `AUX` as far as Win32 is concerned.
fn is_reserved(name: &str) -> bool {
    let stem = name.split('.').next().unwrap_or("").to_ascii_lowercase();
    RESERVED_NAMES.contains(&stem.as_str())
}

/// The final component of `name`, as it will actually land on disk, with
/// anything that could climb out of the target directory or confuse the
/// filesystem taken off it.
///
/// A dropped file's name is whatever the sending app put there, so it is
/// treated as a suggestion rather than a path. The rules are Windows' as well
/// as this platform's: a vault is very often a synced folder, and a note named
/// `report.` or `aux.md` is one that cannot be checked out on a machine that
/// is not this one. Trailing dots and spaces matter for a second reason -
/// Win32 drops them silently, so the name checked against what is already in
/// the folder would not be the name that ended up there, and `unused_path`
/// would hand back a path that overwrites a file it thought was free.
fn safe_file_name(name: &str) -> Result<String, String> {
    let cleaned: String = name
        .rsplit(['/', '\\'])
        .next()
        .unwrap_or("")
        .trim()
        .trim_start_matches('.')
        .chars()
        .filter(|c| !c.is_control() && !FORBIDDEN_CHARS.contains(c))
        .collect();
    let cleaned = cleaned.trim_end_matches(['.', ' ']).trim();

    if cleaned.is_empty() {
        return Err("Invalid file name".to_string());
    }
    if is_reserved(cleaned) {
        return Err(format!(
            "\"{}\" is a name Windows keeps for itself",
            cleaned
        ));
    }

    Ok(cleaned.to_string())
}

/// `name` exactly as it was given, once it is known to be usable.
///
/// The difference from `safe_file_name` is who is asking. A file arriving by
/// drag-and-drop is worth filing under a tidied-up version of whatever name it
/// came with; a name somebody typed into the sidebar is not, because the row
/// the tree then draws is built from what they typed. Quietly writing
/// `notes.md` for a typed `../notes.md` leaves the tree pointing at a file that
/// is not there, which is the shape the vault-escape bug had. So this refuses
/// instead, and the sidebar says why.
fn exact_file_name(name: &str) -> Result<String, String> {
    let trimmed = name.trim();
    if safe_file_name(trimmed)? != trimmed {
        return Err(format!("\"{}\" is not a name a file can have", trimmed));
    }
    Ok(trimmed.to_string())
}

/// Renames `from` to `to`, refusing rather than replacing when `to` is taken.
///
/// `fs::rename` is the wrong primitive for every rename in this file. On Unix
/// it replaces the destination silently, which makes the `exists()` check in
/// front of each one the only thing standing between a race and a note that is
/// simply gone - and a check is not a guarantee. The gap between asking and
/// acting is exactly where a sync client finishes writing the file being
/// renamed onto, and the loser of that race is whoever wrote first.
///
/// Every platform has a way to say "and fail if it is taken"; none of them is
/// the portable one. Where the filesystem underneath does not know the flag,
/// the call comes back unsupported and the plain rename is used after all -
/// no worse than before, with the check in front of it still catching every
/// case that is not a race.
fn rename_no_replace(from: &Path, to: &Path) -> std::io::Result<()> {
    match rename_exclusively(from, to) {
        Err(error) if not_supported(&error) => fs::rename(from, to),
        result => result,
    }
}

/// Whether the filesystem turned the request down for not understanding it,
/// rather than for the reason the request exists.
fn not_supported(error: &std::io::Error) -> bool {
    if error.kind() == std::io::ErrorKind::Unsupported {
        return true;
    }
    #[cfg(unix)]
    {
        // ENOSYS: the kernel has no such call. EINVAL / ENOTSUP / EOPNOTSUPP:
        // it has it, and this filesystem does not implement the flag.
        //
        // EOPNOTSUPP is compared rather than matched because on Linux it is
        // the same number as ENOTSUP, and two patterns for one value is an
        // unreachable arm there while being two distinct values on macOS.
        let code = error.raw_os_error();
        matches!(
            code,
            Some(libc::ENOSYS) | Some(libc::EINVAL) | Some(libc::ENOTSUP)
        ) || code == Some(libc::EOPNOTSUPP)
    }
    #[cfg(not(unix))]
    {
        false
    }
}

/// `from` and `to` as NUL-terminated strings, for the calls below.
#[cfg(unix)]
fn as_c_paths(from: &Path, to: &Path) -> std::io::Result<(std::ffi::CString, std::ffi::CString)> {
    use std::os::unix::ffi::OsStrExt;

    let source = std::ffi::CString::new(from.as_os_str().as_bytes())
        .map_err(|_| std::io::Error::from(std::io::ErrorKind::InvalidInput))?;
    let target = std::ffi::CString::new(to.as_os_str().as_bytes())
        .map_err(|_| std::io::Error::from(std::io::ErrorKind::InvalidInput))?;
    Ok((source, target))
}

#[cfg(target_os = "linux")]
fn rename_exclusively(from: &Path, to: &Path) -> std::io::Result<()> {
    let (source, target) = as_c_paths(from, to)?;

    // SAFETY: both are NUL-terminated strings that outlive the call, and
    // AT_FDCWD is the documented way to ask for paths as written.
    let result = unsafe {
        libc::renameat2(
            libc::AT_FDCWD,
            source.as_ptr(),
            libc::AT_FDCWD,
            target.as_ptr(),
            libc::RENAME_NOREPLACE,
        )
    };

    if result == 0 {
        Ok(())
    } else {
        Err(std::io::Error::last_os_error())
    }
}

#[cfg(target_os = "macos")]
fn rename_exclusively(from: &Path, to: &Path) -> std::io::Result<()> {
    let (source, target) = as_c_paths(from, to)?;

    // SAFETY: as above - two NUL-terminated strings that outlive the call.
    let result = unsafe { libc::renamex_np(source.as_ptr(), target.as_ptr(), libc::RENAME_EXCL) };

    if result == 0 {
        Ok(())
    } else {
        Err(std::io::Error::last_os_error())
    }
}

#[cfg(windows)]
fn rename_exclusively(from: &Path, to: &Path) -> std::io::Result<()> {
    use std::os::windows::ffi::OsStrExt;

    /// Win32 wants UTF-16, NUL-terminated.
    fn wide(path: &Path) -> Vec<u16> {
        path.as_os_str().encode_wide().chain(Some(0)).collect()
    }

    let (source, target) = (wide(from), wide(to));

    // `fs::rename` passes MOVEFILE_REPLACE_EXISTING; the whole point here is
    // not to. Without it MoveFileExW fails with ERROR_ALREADY_EXISTS, which
    // Rust maps to the AlreadyExists kind the callers are looking for.
    //
    // SAFETY: both are NUL-terminated wide strings that outlive the call.
    let moved = unsafe {
        windows_sys::Win32::Storage::FileSystem::MoveFileExW(source.as_ptr(), target.as_ptr(), 0)
    };

    if moved != 0 {
        Ok(())
    } else {
        Err(std::io::Error::last_os_error())
    }
}

#[cfg(not(any(target_os = "linux", target_os = "macos", windows)))]
fn rename_exclusively(_from: &Path, _to: &Path) -> std::io::Result<()> {
    Err(std::io::Error::from(std::io::ErrorKind::Unsupported))
}

/// Whether a failure was "something is already there".
fn already_exists(error: &std::io::Error) -> bool {
    error.kind() == std::io::ErrorKind::AlreadyExists
}

/// Creates a file in `directory` named after `name` that nothing was using,
/// adding " 1", " 2" and so on before the extension the way a file manager
/// would. Hands back the file itself along with where it landed.
///
/// Creating rather than choosing a name and leaving the caller to write it:
/// asking whether a path is free and then writing to it are two moments, and
/// two attachments dropped at once are perfectly capable of both being told
/// that "photo.png" is free. `create_new` asks and answers in one step, so
/// the one that loses moves on to "photo 1.png" instead of writing over the
/// one that won.
fn create_unused(directory: &Path, name: &str) -> Result<(fs::File, PathBuf), String> {
    let stem = Path::new(name)
        .file_stem()
        .map(|s| s.to_string_lossy().into_owned())
        .unwrap_or_default();
    let extension = Path::new(name)
        .extension()
        .map(|e| format!(".{}", e.to_string_lossy()))
        .unwrap_or_default();

    let mut last = None;
    for n in 0..10_000 {
        let candidate = match n {
            0 => directory.join(name),
            _ => directory.join(format!("{} {}{}", stem, n, extension)),
        };

        match fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&candidate)
        {
            Ok(file) => return Ok((file, candidate)),
            Err(error) if already_exists(&error) => continue,
            Err(error) => last = Some(error.to_string()),
        }
    }

    Err(last.unwrap_or_else(|| format!("Could not find a free name for \"{}\"", name)))
}

/// The folder to actually file media in, preferring one already sitting there
/// under a different case.
///
/// macOS and Windows are case-insensitive but case-preserving, so asking for
/// "media" beside an existing "Media" quietly writes into the latter while
/// every path handed back still says "media". The sidebar reads those paths
/// literally and invents a second, empty folder that vanishes on the next
/// restart - and on Linux, where the names really are distinct, the vault ends
/// up with two media folders side by side.
fn preferred_directory(directory: &Path) -> std::path::PathBuf {
    if directory.exists() {
        return directory.to_path_buf();
    }

    let (Some(parent), Some(name)) = (directory.parent(), directory.file_name()) else {
        return directory.to_path_buf();
    };

    let wanted = name.to_string_lossy().to_lowercase();
    let Ok(siblings) = fs::read_dir(parent) else {
        return directory.to_path_buf();
    };

    for sibling in siblings.flatten() {
        if sibling.file_name().to_string_lossy().to_lowercase() == wanted && sibling.path().is_dir()
        {
            return sibling.path();
        }
    }

    directory.to_path_buf()
}

/// Writes a dropped or pasted file into `directory`, creating it if it is not
/// there yet. The bytes arrive base64-encoded because that survives the JSON
/// the IPC bridge speaks at a third of the cost of an array of numbers.
/// Returns the full path actually written, which may have been renamed to
/// avoid overwriting something.
#[tauri::command]
async fn write_media(
    app_handle: tauri::AppHandle,
    directory: String,
    name: String,
    data: String,
) -> Result<String, String> {
    off_thread(move || {
        use base64::Engine;

        let vault = app_handle.state::<Vault>();
        let bytes = base64::engine::general_purpose::STANDARD
            .decode(data.as_bytes())
            .map_err(|e| format!("Could not read the dropped file: {}", e))?;

        let directory = preferred_directory(Path::new(&directory));
        let directory = within_vault_to_write(&vault, &directory)?;
        fs::create_dir_all(&directory).map_err(|e| e.to_string())?;

        // Checked again now that it exists: create_dir_all resolves nothing,
        // and a media folder that is a symlink out of the vault would have
        // passed above.
        let directory = within_vault(&vault, &directory)?;
        let (mut file, path) = create_unused(&directory, &safe_file_name(&name)?)?;
        std::io::Write::write_all(&mut file, &bytes).map_err(|e| e.to_string())?;

        Ok(path.to_string_lossy().into_owned())
    })
    .await
}

#[tauri::command]
async fn read_file(app_handle: tauri::AppHandle, path: String) -> Result<String, String> {
    off_thread(move || {
        let vault = app_handle.state::<Vault>();
        let path = within_vault(&vault, Path::new(&path))?;
        let content = fs::read_to_string(&path).map_err(|e| e.to_string())?;
        // Where the note stood when it was read, so a later write can tell
        // whether anything else has been at it in the meantime.
        remember(&vault, &path);
        Ok(content)
    })
    .await
}

/// Writes `bytes` to `path` without ever leaving what is already there half
/// replaced.
///
/// `fs::write` truncates the file and then writes it, and autosave runs several
/// times a minute per open note: a panic, a power cut or a full disk in the gap
/// between those two steps is a note that is empty or cut in half, with no
/// backup and nothing to roll back to. The bytes go to a temporary file beside
/// the target instead, are flushed all the way to the disk, and are then
/// renamed over it - a rename within one filesystem is atomic, so a reader sees
/// either the note as it was or the note as it now is, never the gap.
fn write_atomically(path: &Path, bytes: &[u8]) -> Result<(), String> {
    use std::io::Write;

    /// A failure in its own words, without the name of the temporary file it
    /// happened to be using. That name is this function's business; someone
    /// being told their note could not be saved has no use for it, and every
    /// save picks a different one.
    fn plainly(error: impl ToString) -> String {
        let said = error.to_string();
        match said.split_once(" at path ") {
            Some((reason, _)) => reason.to_string(),
            None => said,
        }
    }

    let directory = path
        .parent()
        .filter(|parent| !parent.as_os_str().is_empty())
        .ok_or_else(|| "Cannot write to this path".to_string())?;

    let mut file = tempfile::NamedTempFile::new_in(directory).map_err(plainly)?;

    // A temporary file is created private to its owner. Left as it is, the
    // first autosave would quietly take a note's own permissions away from it.
    if let Ok(existing) = fs::metadata(path) {
        let _ = file.as_file().set_permissions(existing.permissions());
    }

    file.write_all(bytes).map_err(plainly)?;
    // Ordering the write before the rename, rather than trusting that a rename
    // recorded after it means the contents reached the disk as well.
    file.as_file().sync_all().map_err(plainly)?;
    file.persist(path).map_err(plainly)?;

    Ok(())
}

/// Writes a note back, refusing if it has moved on since the app read it.
///
/// `force` is the answer to that refusal, and only ever comes from someone
/// being asked which copy they want to keep.
#[tauri::command]
async fn write_file(
    app_handle: tauri::AppHandle,
    path: String,
    content: String,
    force: Option<bool>,
) -> Result<(), String> {
    off_thread(move || {
        let vault = app_handle.state::<Vault>();
        let path = within_vault_to_write(&vault, Path::new(&path))?;

        if !force.unwrap_or(false) && changed_since_read(&vault, &path) {
            return Err(CHANGED_ON_DISK.to_string());
        }

        write_atomically(&path, content.as_bytes())?;
        remember(&vault, &path);
        Ok(())
    })
    .await
}

/// Edits that were in a tab and nowhere else when the app went away.
///
/// A note that changed on disk while it had unsaved edits is held: neither
/// copy is written until someone answers the bar. That is the right answer
/// while the app is running and the wrong one on the way out, because the
/// edits only ever existed in the editor's own state - leaving took them with
/// it, with no warning at any point.
///
/// So the buffer is kept here instead, outside the vault, in the app's own
/// data directory. Nothing in anyone's notes is touched and no copy is
/// declared the winner; the question is simply still answerable the next time
/// that note is opened.
///
/// The note's own path is stored alongside the text because the file is named
/// after a hash of that path - a path is not a filename - and a hash can in
/// principle collide. A file whose recorded path is not the one being asked
/// about is not that note's, and is treated as though it were not there.
#[derive(serde::Serialize, serde::Deserialize)]
struct Recovery {
    path: String,
    content: String,
}

/// Where those buffers live, created if this is the first one.
fn recovery_dir(app_handle: &tauri::AppHandle) -> Result<PathBuf, String> {
    let dir = app_handle
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("recovery");
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

/// The file `note` would be kept in: its path, hashed, since the path itself
/// has separators in it and is very often longer than a name may be.
fn recovery_file(dir: &Path, note: &str) -> PathBuf {
    use std::hash::{Hash, Hasher};

    let mut hasher = std::collections::hash_map::DefaultHasher::new();
    note.hash(&mut hasher);
    dir.join(format!("{:016x}.json", hasher.finish()))
}

/// Puts the unsaved edits in `path` somewhere they will survive the window
/// closing. Written on every flush while the conflict is unanswered, so what
/// is kept is what was last typed rather than what was there when the bar
/// first appeared.
#[tauri::command]
async fn keep_recovery(
    app_handle: tauri::AppHandle,
    path: String,
    content: String,
) -> Result<(), String> {
    off_thread(move || {
        let dir = recovery_dir(&app_handle)?;
        let kept = Recovery {
            path: path.clone(),
            content,
        };
        let json = serde_json::to_vec(&kept).map_err(|e| e.to_string())?;
        write_atomically(&recovery_file(&dir, &path), &json)
    })
    .await
}

/// The edits being held for `path`, if there are any.
///
/// Reading does not throw them away: until someone has said what to do with
/// them, an app that goes away again should still have them to offer.
#[tauri::command]
async fn take_recovery(
    app_handle: tauri::AppHandle,
    path: String,
) -> Result<Option<String>, String> {
    off_thread(move || {
        let dir = recovery_dir(&app_handle)?;
        let Ok(json) = fs::read(recovery_file(&dir, &path)) else {
            return Ok(None);
        };

        let Ok(kept) = serde_json::from_slice::<Recovery>(&json) else {
            // Half-written or from an older shape of this file. Nothing can be
            // done with it and nothing should be said about it.
            return Ok(None);
        };

        Ok((kept.path == path).then_some(kept.content))
    })
    .await
}

/// Forgets them, once the question has been answered either way.
#[tauri::command]
async fn drop_recovery(app_handle: tauri::AppHandle, path: String) -> Result<(), String> {
    off_thread(move || {
        let dir = recovery_dir(&app_handle)?;
        match fs::remove_file(recovery_file(&dir, &path)) {
            Ok(()) => Ok(()),
            // Already gone is the state being asked for.
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
            Err(error) => Err(error.to_string()),
        }
    })
    .await
}

/// True for legacy symbol-encoded fonts (Wingdings, Webdings, ...), which map
/// plain letters to pictographs. Picking one would turn every note - and the
/// line numbers - into symbols, since the monospace fallback never kicks in.
fn is_symbol_font(data: &[u8], index: u32) -> bool {
    let Some(cmap) = ttf_parser::Face::parse(data, index)
        .ok()
        .and_then(|face| face.tables().cmap)
    else {
        return false;
    };
    let subtables: Vec<_> = cmap.subtables.into_iter().collect();
    !subtables.iter().any(|s| s.is_unicode())
        && subtables
            .iter()
            .any(|s| s.platform_id == ttf_parser::PlatformId::Windows && s.encoding_id == 0)
}

/// Lists the family names of every font installed on the system, sorted
/// case-insensitively. Async so the font scan runs off the main thread.
#[tauri::command]
async fn list_system_fonts() -> Vec<String> {
    let mut db = fontdb::Database::new();
    db.load_system_fonts();

    let families: std::collections::BTreeSet<String> = db
        .faces()
        .filter(|face| !db.with_face_data(face.id, is_symbol_font).unwrap_or(false))
        .filter_map(|face| face.families.first().map(|(name, _)| name.clone()))
        // macOS keeps private system fonts (e.g. ".SF NS") behind a leading dot
        .filter(|name| !name.starts_with('.'))
        .collect();

    let mut families: Vec<String> = families.into_iter().collect();
    families.sort_by_key(|name| name.to_lowercase());
    families
}

/// The Windows backdrop that does not make the window crawl.
///
/// DWM's blur-behind - what `apply_blur` reaches for - redraws the entire
/// window on every frame of a drag or a resize on anything past Windows 10
/// v1809, which is why dragging nuza across a Windows desktop took seconds
/// rather than following the pointer. Mica is the documented replacement and
/// costs nothing to move, so Windows 11 gets that, the one Windows 10 build
/// where acrylic is still cheap gets acrylic, and anything older goes without
/// a backdrop rather than going slow.
#[cfg(target_os = "windows")]
fn apply_windows_backdrop(window: &tauri::WebviewWindow, enabled: bool) -> Result<bool, String> {
    /// Windows 11, where mica exists.
    const MICA: u32 = 22000;
    /// Windows 10 v1809, where acrylic arrived.
    const ACRYLIC: u32 = 17763;
    /// Windows 10 v1903, from which acrylic drags as badly as blur does.
    const ACRYLIC_SLOWED: u32 = 18362;

    let build = windows_version::OsVersion::current().build;

    if build >= MICA {
        if enabled {
            apply_mica(window, Some(true)).map_err(|e| e.to_string())?;
        } else {
            clear_mica(window).map_err(|e| e.to_string())?;
        }
        Ok(true)
    } else if (ACRYLIC..ACRYLIC_SLOWED).contains(&build) {
        if enabled {
            apply_acrylic(window, Some((18, 18, 18, 125))).map_err(|e| e.to_string())?;
        } else {
            clear_acrylic(window).map_err(|e| e.to_string())?;
        }
        Ok(true)
    } else {
        Ok(false)
    }
}

/// Applies or clears the OS-level window transparency/vibrancy effect, and
/// says whether this platform has one at all. Where it does not - Linux, or a
/// Windows build with no backdrop worth the frame rate - the frontend paints
/// the window opaque instead of leaving a hole through to the desktop.
fn apply_transparency(window: &tauri::WebviewWindow, enabled: bool) -> Result<bool, String> {
    #[cfg(target_os = "macos")]
    {
        if enabled {
            apply_vibrancy(window, NSVisualEffectMaterial::Sidebar, None, None)
                .map_err(|e| e.to_string())?;
        } else {
            clear_vibrancy(window).map_err(|e| e.to_string())?;
        }
        Ok(true)
    }

    #[cfg(target_os = "windows")]
    {
        apply_windows_backdrop(window, enabled)
    }

    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        let _ = (window, enabled);
        Ok(false)
    }
}

/// Tauri command wrapper around [`apply_transparency`] for toggling the
/// effect at runtime from the frontend's settings panel.
///
/// One of the two commands that stays on the main thread deliberately: it is
/// the window it is changing, and a window is the main thread's to touch.
/// There is no IO here to be slow about either.
#[tauri::command]
fn set_transparency(window: tauri::WebviewWindow, enabled: bool) -> Result<bool, String> {
    apply_transparency(&window, enabled)
}

/// macOS hands ⌘W to the window, not to whatever is in front of you: the menu
/// bar takes the key before the webview is offered it, and closing the window
/// closes the app. The default menu is rebuilt here with "Close Window"
/// replaced by a "Close Tab" item of our own, which the frontend answers by
/// closing the open note.
#[cfg(target_os = "macos")]
const CLOSE_TAB_ITEM: &str = "close-tab";

/// The event the item fires, listened for by the app's keymap handling.
#[cfg(target_os = "macos")]
const CLOSE_TAB_EVENT: &str = "menu:close-tab";

/// Quitting has the same problem as ⌘W, and it costs more: the predefined
/// Quit item ends the process the moment the key is pressed, which may be in
/// the second after a keystroke while the note it changed is still waiting on
/// the autosave timer. This item announces the quit to the frontend instead,
/// which writes what is outstanding and then exits.
#[cfg(target_os = "macos")]
const QUIT_ITEM: &str = "quit-app";

/// The event that item fires.
#[cfg(target_os = "macos")]
const QUIT_EVENT: &str = "menu:quit";

/// Kept around so the shortcut can follow a rebind in Settings.
#[cfg(target_os = "macos")]
struct CloseTabItem(tauri::menu::MenuItem<Wry>);

#[cfg(target_os = "macos")]
fn build_menu(app: &tauri::AppHandle) -> tauri::Result<tauri::menu::Menu<Wry>> {
    use tauri::menu::{AboutMetadata, Menu, MenuItem, PredefinedMenuItem, Submenu};

    let package = app.package_info();
    let bundle = &app.config().bundle;
    let about = AboutMetadata {
        name: Some(package.name.clone()),
        version: Some(package.version.to_string()),
        copyright: bundle.copyright.clone(),
        authors: bundle.publisher.clone().map(|publisher| vec![publisher]),
        ..Default::default()
    };

    // The accelerator is only the default one; the frontend points it at
    // whatever "Close Tab" is actually bound to as soon as it has started.
    let close_tab = MenuItem::with_id(app, CLOSE_TAB_ITEM, "Close Tab", true, Some("CmdOrCtrl+W"))?;
    let quit = MenuItem::with_id(
        app,
        QUIT_ITEM,
        format!("Quit {}", package.name),
        true,
        Some("CmdOrCtrl+Q"),
    )?;

    let menu = Menu::with_items(
        app,
        &[
            &Submenu::with_items(
                app,
                package.name.clone(),
                true,
                &[
                    &PredefinedMenuItem::about(app, None, Some(about))?,
                    &PredefinedMenuItem::separator(app)?,
                    &PredefinedMenuItem::services(app, None)?,
                    &PredefinedMenuItem::separator(app)?,
                    &PredefinedMenuItem::hide(app, None)?,
                    &PredefinedMenuItem::hide_others(app, None)?,
                    &PredefinedMenuItem::separator(app)?,
                    &quit,
                ],
            )?,
            &Submenu::with_items(app, "File", true, &[&close_tab])?,
            // The editing commands are menu items on macOS or they do not work
            // at all: ⌘C and friends are key equivalents, not webview keys.
            &Submenu::with_items(
                app,
                "Edit",
                true,
                &[
                    &PredefinedMenuItem::undo(app, None)?,
                    &PredefinedMenuItem::redo(app, None)?,
                    &PredefinedMenuItem::separator(app)?,
                    &PredefinedMenuItem::cut(app, None)?,
                    &PredefinedMenuItem::copy(app, None)?,
                    &PredefinedMenuItem::paste(app, None)?,
                    &PredefinedMenuItem::select_all(app, None)?,
                ],
            )?,
            &Submenu::with_items(
                app,
                "View",
                true,
                &[&PredefinedMenuItem::fullscreen(app, None)?],
            )?,
            &Submenu::with_items(
                app,
                "Window",
                true,
                &[
                    &PredefinedMenuItem::minimize(app, None)?,
                    &PredefinedMenuItem::maximize(app, None)?,
                ],
            )?,
        ],
    )?;

    app.manage(CloseTabItem(close_tab));
    Ok(menu)
}

/// Points the "Close Tab" item at the shortcut the app has bound to closing a
/// tab, so rebinding it in Settings moves the menu's key equivalent with it.
/// A binding the menu bar cannot express leaves the item without one, and the
/// webview handles the key itself.
///
/// The other command that stays on the main thread: it is the menu bar it is
/// changing, and that belongs to the main thread as much as the window does.
#[tauri::command]
fn set_close_tab_shortcut(
    #[allow(unused_variables)] app: tauri::AppHandle,
    #[allow(unused_variables)] accelerator: Option<String>,
) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        let item = app.state::<CloseTabItem>();
        if item.0.set_accelerator(accelerator).is_err() {
            item.0
                .set_accelerator(None::<&str>)
                .map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            // Empty until a folder is opened, which is also what makes every
            // filesystem command refuse until then.
            app.manage(Vault::default());

            // A window without a backdrop is a window that paints itself
            // opaque - the frontend already handles that, and it is not worth
            // refusing to start over.
            if let Some(window) = app.get_webview_window("main") {
                if let Err(error) = apply_transparency(&window, true) {
                    eprintln!("nuza: no window backdrop on this platform: {}", error);
                }
            }
            Ok(())
        })
        .plugin(tauri_plugin_opener::init());

    #[cfg(target_os = "macos")]
    let builder = builder.menu(build_menu).on_menu_event(|app, event| {
        if event.id() == CLOSE_TAB_ITEM {
            let _ = app.emit(CLOSE_TAB_EVENT, ());
        } else if event.id() == QUIT_ITEM {
            let _ = app.emit(QUIT_EVENT, ());
        }
    });

    builder
        .invoke_handler(tauri::generate_handler![
            save_file_picker,
            load_folder_picker,
            open_folder,
            read_file,
            write_file,
            write_media,
            keep_recovery,
            take_recovery,
            drop_recovery,
            create_file,
            create_folder,
            rename_entry,
            move_entry,
            delete_entry,
            list_system_fonts,
            set_transparency,
            set_close_tab_shortcut
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The note as it stands on disk, for asserting a write actually landed.
    fn contents(path: &Path) -> String {
        fs::read_to_string(path).expect("the note should be readable")
    }

    #[test]
    fn writes_a_new_note() {
        let vault = tempfile::tempdir().unwrap();
        let note = vault.path().join("note.md");

        write_atomically(&note, b"hello").unwrap();

        assert_eq!(contents(&note), "hello");
    }

    #[test]
    fn replaces_an_existing_note() {
        let vault = tempfile::tempdir().unwrap();
        let note = vault.path().join("note.md");
        fs::write(&note, "the long version of the note").unwrap();

        write_atomically(&note, b"short").unwrap();

        assert_eq!(contents(&note), "short");
    }

    /// The temporary file is an implementation detail; a vault that collects
    /// one per autosave would be one the sidebar fills up with rubbish.
    #[test]
    fn leaves_nothing_behind_beside_the_note() {
        let vault = tempfile::tempdir().unwrap();
        let note = vault.path().join("note.md");

        write_atomically(&note, b"one").unwrap();
        write_atomically(&note, b"two").unwrap();

        let entries: Vec<_> = fs::read_dir(vault.path()).unwrap().flatten().collect();
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].path(), note);
    }

    /// A note that was readable by the group or the world stays that way after
    /// the app has saved it once.
    #[cfg(unix)]
    #[test]
    fn keeps_the_permissions_the_note_already_had() {
        use std::os::unix::fs::PermissionsExt;

        let vault = tempfile::tempdir().unwrap();
        let note = vault.path().join("note.md");
        fs::write(&note, "before").unwrap();
        fs::set_permissions(&note, fs::Permissions::from_mode(0o644)).unwrap();

        write_atomically(&note, b"after").unwrap();

        let mode = fs::metadata(&note).unwrap().permissions().mode() & 0o777;
        assert_eq!(mode, 0o644);
    }

    /// A write into a folder that is not there fails outright rather than
    /// reporting success over a note that was never saved.
    #[test]
    fn refuses_a_directory_that_is_not_there() {
        let vault = tempfile::tempdir().unwrap();
        let note = vault.path().join("missing").join("note.md");

        assert!(write_atomically(&note, b"hello").is_err());
    }

    /// A vault with `root` open and nothing chosen by hand.
    fn opened(root: &Path) -> Vault {
        Vault {
            root: Mutex::new(Some(root.canonicalize().unwrap())),
            ..Default::default()
        }
    }

    #[test]
    fn allows_a_note_in_the_vault() {
        let dir = tempfile::tempdir().unwrap();
        let vault = opened(dir.path());
        let note = dir.path().join("note.md");
        fs::write(&note, "hello").unwrap();

        assert!(within_vault(&vault, &note).is_ok());
    }

    #[test]
    fn refuses_a_file_outside_the_vault() {
        let dir = tempfile::tempdir().unwrap();
        let elsewhere = tempfile::tempdir().unwrap();
        let vault = opened(dir.path());
        let secret = elsewhere.path().join("secret.md");
        fs::write(&secret, "hello").unwrap();

        assert!(within_vault(&vault, &secret).is_err());
    }

    /// Nothing at all is reachable until a folder has been opened.
    #[test]
    fn refuses_everything_with_no_vault_open() {
        let dir = tempfile::tempdir().unwrap();
        let note = dir.path().join("note.md");
        fs::write(&note, "hello").unwrap();

        assert!(within_vault(&Vault::default(), &note).is_err());
    }

    /// The reason paths are resolved rather than compared as text.
    #[test]
    fn refuses_a_way_out_through_dot_dot() {
        let dir = tempfile::tempdir().unwrap();
        let elsewhere = tempfile::tempdir().unwrap();
        let vault = opened(dir.path());
        let secret = elsewhere.path().join("secret.md");
        fs::write(&secret, "hello").unwrap();

        let climbing = dir.path().join("..").join(
            elsewhere
                .path()
                .file_name()
                .map(Path::new)
                .unwrap()
                .join("secret.md"),
        );
        assert!(within_vault(&vault, &climbing).is_err());
    }

    /// A symlink inside the vault pointing out of it is a way out too.
    #[cfg(unix)]
    #[test]
    fn refuses_a_way_out_through_a_symlink() {
        let dir = tempfile::tempdir().unwrap();
        let elsewhere = tempfile::tempdir().unwrap();
        let vault = opened(dir.path());
        let secret = elsewhere.path().join("secret.md");
        fs::write(&secret, "hello").unwrap();

        let link = dir.path().join("looks-like-a-note.md");
        std::os::unix::fs::symlink(&secret, &link).unwrap();

        assert!(within_vault(&vault, &link).is_err());
        assert!(within_vault_to_write(&vault, &link).is_err());
    }

    /// A new note has nothing to resolve, so its parent is what is checked -
    /// which is also what stops a "name" that is really a path.
    #[test]
    fn checks_the_parent_of_something_being_created() {
        let dir = tempfile::tempdir().unwrap();
        let vault = opened(dir.path());

        assert!(within_vault_to_create(&vault, &dir.path().join("new.md")).is_ok());
        assert!(within_vault_to_create(&vault, &dir.path().join("../escaped.md")).is_err());
    }

    /// A note deleted from under the app is still one the app may write back.
    #[test]
    fn allows_writing_back_a_note_that_has_gone_missing() {
        let dir = tempfile::tempdir().unwrap();
        let vault = opened(dir.path());

        assert!(within_vault_to_write(&vault, &dir.path().join("vanished.md")).is_ok());
    }

    /// Moves `path`'s modification time on, the way another editor writing to
    /// it would - explicitly rather than by writing twice and hoping the clock
    /// noticed.
    fn touch(path: &Path) {
        let file = fs::OpenOptions::new().write(true).open(path).unwrap();
        let later = SystemTime::now() + std::time::Duration::from_secs(5);
        file.set_times(fs::FileTimes::new().set_modified(later))
            .unwrap();
    }

    /// A note the app has never read is not out of date with anything.
    #[test]
    fn a_note_never_read_has_not_changed() {
        let dir = tempfile::tempdir().unwrap();
        let vault = opened(dir.path());
        let note = dir.path().join("note.md");
        fs::write(&note, "hello").unwrap();

        assert!(!changed_since_read(&vault, &note));
    }

    #[test]
    fn a_note_nobody_touched_has_not_changed() {
        let dir = tempfile::tempdir().unwrap();
        let vault = opened(dir.path());
        let note = dir.path().join("note.md");
        fs::write(&note, "hello").unwrap();
        remember(&vault, &note);

        assert!(!changed_since_read(&vault, &note));
    }

    /// The case the whole thing exists for: something else wrote to the note
    /// after the app read it.
    #[test]
    fn a_note_written_elsewhere_has_changed() {
        let dir = tempfile::tempdir().unwrap();
        let vault = opened(dir.path());
        let note = dir.path().join("note.md");
        fs::write(&note, "hello").unwrap();
        remember(&vault, &note);

        touch(&note);

        assert!(changed_since_read(&vault, &note));
    }

    /// A note deleted from under the app is not what the app holds either.
    #[test]
    fn a_note_deleted_elsewhere_has_changed() {
        let dir = tempfile::tempdir().unwrap();
        let vault = opened(dir.path());
        let note = dir.path().join("note.md");
        fs::write(&note, "hello").unwrap();
        remember(&vault, &note);

        fs::remove_file(&note).unwrap();

        assert!(changed_since_read(&vault, &note));
    }

    /// The app's own save is not an external change: writing records where the
    /// note now stands, so the next write is not refused over it.
    #[test]
    fn the_apps_own_write_is_not_a_change() {
        let dir = tempfile::tempdir().unwrap();
        let vault = opened(dir.path());
        let note = dir.path().join("note.md");
        fs::write(&note, "hello").unwrap();
        remember(&vault, &note);

        touch(&note);
        assert!(changed_since_read(&vault, &note));

        // What write_file does once it has written.
        write_atomically(&note, b"ours").unwrap();
        remember(&vault, &note);

        assert!(!changed_since_read(&vault, &note));
    }

    /// The ordinary case: nothing is in the way and the note moves.
    #[test]
    fn renames_a_note() {
        let dir = tempfile::tempdir().unwrap();
        let from = dir.path().join("note.md");
        let to = dir.path().join("renamed.md");
        fs::write(&from, "hello").unwrap();

        rename_no_replace(&from, &to).unwrap();

        assert!(!from.exists());
        assert_eq!(contents(&to), "hello");
    }

    /// The one this exists for. `fs::rename` replaces the destination without
    /// a word on Unix, so a note that happened to be there would be gone - and
    /// the `exists()` check that used to be the only guard cannot see anything
    /// created after it ran.
    #[test]
    fn refuses_to_rename_over_a_note_that_is_already_there() {
        let dir = tempfile::tempdir().unwrap();
        let from = dir.path().join("note.md");
        let to = dir.path().join("taken.md");
        fs::write(&from, "mine").unwrap();
        fs::write(&to, "someone else's").unwrap();

        let error = rename_no_replace(&from, &to).unwrap_err();

        assert!(
            already_exists(&error),
            "expected AlreadyExists, got {error:?}"
        );
        // Both are still there, and neither has been touched.
        assert_eq!(contents(&from), "mine");
        assert_eq!(contents(&to), "someone else's");
    }

    /// A folder in the way counts too - that one loses a whole subtree.
    #[test]
    fn refuses_to_rename_over_a_folder_that_is_already_there() {
        let dir = tempfile::tempdir().unwrap();
        let from = dir.path().join("notes");
        let to = dir.path().join("taken");
        fs::create_dir(&from).unwrap();
        fs::create_dir(&to).unwrap();
        fs::write(to.join("kept.md"), "still here").unwrap();

        assert!(rename_no_replace(&from, &to).is_err());
        assert_eq!(contents(&to.join("kept.md")), "still here");
    }

    #[test]
    fn a_dropped_file_keeps_its_name_when_nothing_is_using_it() {
        let dir = tempfile::tempdir().unwrap();

        let (_, path) = create_unused(dir.path(), "photo.png").unwrap();

        assert_eq!(path, dir.path().join("photo.png"));
        assert!(path.exists());
    }

    /// Two attachments with the same name land beside each other rather than
    /// one on top of the other.
    #[test]
    fn a_dropped_file_is_numbered_rather_than_written_over() {
        let dir = tempfile::tempdir().unwrap();
        fs::write(dir.path().join("photo.png"), "the first one").unwrap();

        let (_, path) = create_unused(dir.path(), "photo.png").unwrap();
        assert_eq!(path, dir.path().join("photo 1.png"));

        let (_, next) = create_unused(dir.path(), "photo.png").unwrap();
        assert_eq!(next, dir.path().join("photo 2.png"));

        // And the one that was there is untouched.
        assert_eq!(contents(&dir.path().join("photo.png")), "the first one");
    }

    /// The file comes back open, because creating it and writing it are the
    /// same act - anything else is another gap for someone to write into.
    #[test]
    fn a_dropped_file_comes_back_ready_to_write() {
        use std::io::Write;

        let dir = tempfile::tempdir().unwrap();
        let (mut file, path) = create_unused(dir.path(), "photo.png").unwrap();

        file.write_all(b"the bytes").unwrap();
        drop(file);

        assert_eq!(contents(&path), "the bytes");
    }

    /// A name with no extension is numbered on the end rather than in the
    /// middle of nothing.
    #[test]
    fn a_dropped_file_with_no_extension_is_numbered_too() {
        let dir = tempfile::tempdir().unwrap();
        fs::write(dir.path().join("scan"), "first").unwrap();

        let (_, path) = create_unused(dir.path(), "scan").unwrap();

        assert_eq!(path, dir.path().join("scan 1"));
    }

    /// A recovery file is named after the note's path, and two paths can in
    /// principle hash to the same name. The path is recorded inside the file
    /// so that one which does is not handed back as the other's edits.
    #[test]
    fn a_recovery_knows_which_note_it_belongs_to() {
        let kept = Recovery {
            path: "/vault/note.md".to_string(),
            content: "what was typed".to_string(),
        };
        let json = serde_json::to_vec(&kept).unwrap();

        let read: Recovery = serde_json::from_slice(&json).unwrap();
        assert_eq!(read.path, "/vault/note.md");
        assert_eq!(read.content, "what was typed");
    }

    /// One name per note, and a different one for a different note.
    #[test]
    fn a_note_is_kept_under_a_name_of_its_own() {
        let dir = Path::new("/recovery");

        assert_eq!(
            recovery_file(dir, "/vault/note.md"),
            recovery_file(dir, "/vault/note.md")
        );
        assert_ne!(
            recovery_file(dir, "/vault/note.md"),
            recovery_file(dir, "/vault/other.md")
        );
        // A path is not a filename: what lands in the directory is one.
        let file = recovery_file(dir, "/vault/deep/note.md");
        assert_eq!(file.parent(), Some(dir));
        assert!(file.extension().is_some_and(|e| e == "json"));
    }

    /// Saving the scratch note somewhere by hand is consent for that file, and
    /// for nothing else in the folder it landed in.
    #[test]
    fn allows_only_the_file_a_dialog_chose() {
        let dir = tempfile::tempdir().unwrap();
        let elsewhere = tempfile::tempdir().unwrap();
        let chosen = elsewhere.path().join("saved.md");
        let neighbour = elsewhere.path().join("neighbour.md");
        fs::write(&chosen, "hello").unwrap();
        fs::write(&neighbour, "hello").unwrap();

        let vault = opened(dir.path());
        locked(&vault.chosen).insert(chosen.canonicalize().unwrap());

        assert!(within_vault(&vault, &chosen).is_ok());
        assert!(within_vault(&vault, &neighbour).is_err());
    }

    /// A dropped file keeps the name it came with when there is nothing wrong
    /// with it.
    #[test]
    fn leaves_an_ordinary_name_alone() {
        assert_eq!(safe_file_name("photo.png").unwrap(), "photo.png");
        assert_eq!(
            safe_file_name("Notes from 2026 (draft).md").unwrap(),
            "Notes from 2026 (draft).md"
        );
    }

    /// The name on a dropped file is whatever the sending app put there, and
    /// only the last component of it is a name.
    #[test]
    fn tidies_a_dropped_name_into_one_component() {
        assert_eq!(safe_file_name("../../photo.png").unwrap(), "photo.png");
        assert_eq!(
            safe_file_name("C:\\Windows\\photo.png").unwrap(),
            "photo.png"
        );
        assert_eq!(safe_file_name(".hidden.png").unwrap(), "hidden.png");
    }

    /// `:` is an NTFS alternate data stream: bytes written to `note.md:hidden`
    /// do not show up in the file tree, or in the file's own size.
    #[test]
    fn takes_the_stream_separator_out_of_a_dropped_name() {
        assert_eq!(safe_file_name("note.md:hidden").unwrap(), "note.mdhidden");
        assert_eq!(safe_file_name("what?.png").unwrap(), "what.png");
    }

    /// Win32 drops trailing dots and spaces on the way to disk, so a name that
    /// ends in one is not the name that lands - and `unused_path` would then be
    /// checking whether the wrong path is free.
    #[test]
    fn takes_trailing_dots_and_spaces_off_a_dropped_name() {
        assert_eq!(safe_file_name("report.").unwrap(), "report");
        assert_eq!(safe_file_name("report. . ").unwrap(), "report");
    }

    #[test]
    fn refuses_a_dropped_name_with_nothing_usable_left() {
        assert!(safe_file_name("..").is_err());
        assert!(safe_file_name("/").is_err());
        assert!(safe_file_name("   ").is_err());
        assert!(safe_file_name(":?*").is_err());
    }

    /// Reserved whatever is put after them: Win32 reads the stem, so `aux.md`
    /// is the printer port and not a note.
    #[test]
    fn refuses_a_reserved_device_name() {
        assert!(safe_file_name("aux.md").is_err());
        assert!(safe_file_name("CON").is_err());
        assert!(safe_file_name("lpt1.txt").is_err());
        assert!(safe_file_name("auxiliary.md").is_ok());
    }

    /// A typed name is taken exactly as typed, or refused. The row the sidebar
    /// draws is built from what was typed, so a file quietly written under a
    /// different name is one the tree cannot find again.
    #[test]
    fn takes_a_typed_name_only_as_it_was_typed() {
        assert_eq!(exact_file_name("note.md").unwrap(), "note.md");
        assert_eq!(exact_file_name("  note.md  ").unwrap(), "note.md");

        for typed in [
            "../../notes.md",
            "sub/note.md",
            ".hidden",
            "note.md:x",
            "report.",
            "aux.md",
        ] {
            assert!(exact_file_name(typed).is_err(), "{typed} should be refused");
        }
    }

    /// A vault with `root` open, a folder in it, and a note in the folder.
    fn vault_with_a_folder() -> (tempfile::TempDir, Vault) {
        let dir = tempfile::tempdir().unwrap();
        fs::create_dir(dir.path().join("folder")).unwrap();
        fs::create_dir(dir.path().join("folder").join("inner")).unwrap();
        fs::write(dir.path().join("note.md"), "hello").unwrap();
        let vault = opened(dir.path());
        (dir, vault)
    }

    #[test]
    fn moves_a_note_into_a_folder() {
        let (dir, vault) = vault_with_a_folder();

        let (old, new) = move_destination(
            &vault,
            dir.path().join("note.md").to_str().unwrap(),
            dir.path().join("folder").to_str().unwrap(),
        )
        .unwrap();

        assert_eq!(old, dir.path().canonicalize().unwrap().join("note.md"));
        assert_eq!(new.file_name().unwrap(), "note.md");
        assert!(new.starts_with(dir.path().canonicalize().unwrap().join("folder")));
    }

    /// The move that loses a subtree if it goes through.
    #[test]
    fn refuses_moving_a_folder_into_its_own_child() {
        let (dir, vault) = vault_with_a_folder();
        let folder = dir.path().join("folder");

        assert!(move_destination(
            &vault,
            folder.to_str().unwrap(),
            folder.join("inner").to_str().unwrap(),
        )
        .is_err());

        // The same move, spelled so that a textual comparison would let it
        // past: the target does not start with the folder as written.
        assert!(move_destination(
            &vault,
            folder.to_str().unwrap(),
            folder
                .join("..")
                .join("folder")
                .join("inner")
                .to_str()
                .unwrap(),
        )
        .is_err());
    }

    /// And through a symlink, which no amount of string comparison would catch.
    #[cfg(unix)]
    #[test]
    fn refuses_moving_a_folder_into_itself_through_a_symlink() {
        let (dir, vault) = vault_with_a_folder();
        let folder = dir.path().join("folder");
        let link = dir.path().join("shortcut");
        std::os::unix::fs::symlink(folder.join("inner"), &link).unwrap();

        assert!(
            move_destination(&vault, folder.to_str().unwrap(), link.to_str().unwrap()).is_err()
        );
    }

    /// Dropping a note onto a file rather than a folder says so, instead of
    /// handing the OS a path with a file in the middle of it.
    #[test]
    fn refuses_moving_into_something_that_is_not_a_folder() {
        let (dir, vault) = vault_with_a_folder();
        let other = dir.path().join("other.md");
        fs::write(&other, "hello").unwrap();

        assert!(move_destination(
            &vault,
            dir.path().join("note.md").to_str().unwrap(),
            other.to_str().unwrap(),
        )
        .is_err());
    }
}
