use crate::launch::FILE_CHANGED_EVENT;
use crate::search::announce_files;
use crate::state::{changed_since_read, locked, vault_of};
use notify::{RecursiveMode, Watcher};
use std::path::Path;
use tauri::Emitter;

/// Watches the open folder and says so when a note in it changes.
///
/// Without this the app is the last to know. A `git pull`, a sync client or a
/// second editor moves a note on disk, the tab still shows what was read
/// minutes ago, and the first keystroke after that autosaves the stale buffer
/// over the newer file.
pub(crate) fn watch_vault<R: tauri::Runtime>(
    window: &tauri::WebviewWindow<R>,
    root: &Path,
) -> Result<(), String> {
    let handle = window.clone();
    let vault = vault_of(window);
    // Weak, because the vault owns this watcher: a callback holding the vault
    // itself would keep it alive after its window closed.
    let seen_by = std::sync::Arc::downgrade(&vault);

    let mut watcher = notify::recommended_watcher(move |event: notify::Result<notify::Event>| {
        let Ok(event) = event else { return };
        let Some(vault) = seen_by.upgrade() else {
            return;
        };
        // The watcher lost count of what happened - too many changes at once
        // for the OS to list - so the index cannot be patched, only read again.
        if event.need_rescan() {
            let announced = handle.clone();
            vault
                .index
                .rescan_in_background(move || announce_files(&announced, true));
            return;
        }
        if !event.kind.is_modify() && !event.kind.is_create() && !event.kind.is_remove() {
            return;
        }

        let mut files_changed = false;
        for path in &event.paths {
            files_changed |= vault.index.refresh(path);
        }
        announce_files(&handle, files_changed);

        for path in event.paths {
            // Only notes the app is actually holding, and only when what is on
            // disk is no longer what it read - which is what keeps the app's
            // own saves from coming back as news.
            if changed_since_read(&vault, &path) {
                let _ = handle.emit_to(
                    handle.label(),
                    FILE_CHANGED_EVENT,
                    path.to_string_lossy().into_owned(),
                );
            }
        }
    })
    .map_err(|e| e.to_string())?;

    watcher
        .watch(root, RecursiveMode::Recursive)
        .map_err(|e| e.to_string())?;

    // Replacing the old watcher drops it, which is how it stops watching.
    *locked(&vault.watcher) = Some(watcher);
    Ok(())
}
