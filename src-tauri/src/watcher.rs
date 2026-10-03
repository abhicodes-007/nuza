use crate::launch::FILE_CHANGED_EVENT;
use crate::state::{changed_since_read, locked, Vault};
use notify::{RecursiveMode, Watcher};
use std::path::Path;
use tauri::{Emitter, Manager};

/// Watches the open folder and says so when a note in it changes.
///
/// Without this the app is the last to know. A `git pull`, a sync client or a
/// second editor moves a note on disk, the tab still shows what was read
/// minutes ago, and the first keystroke after that autosaves the stale buffer
/// over the newer file.
pub(crate) fn watch_vault(app_handle: &tauri::AppHandle, root: &Path) -> Result<(), String> {
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
