use crate::files::write_atomically;
use crate::tasks::off_thread;
use std::fs;
use std::path::{Path, PathBuf};
use tauri::Manager;

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
pub(crate) struct Recovery {
    pub(crate) path: String,
    pub(crate) content: String,
}

/// Where those buffers live, created if this is the first one.
pub(crate) fn recovery_dir(app_handle: &tauri::AppHandle) -> Result<PathBuf, String> {
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
pub(crate) fn recovery_file(dir: &Path, note: &str) -> PathBuf {
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
pub(crate) async fn keep_recovery(
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
pub(crate) async fn take_recovery(
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
pub(crate) async fn drop_recovery(
    app_handle: tauri::AppHandle,
    path: String,
) -> Result<(), String> {
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
