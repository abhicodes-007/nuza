use crate::state::{locked, vault_of};
use crate::tasks::{off_thread, wait_for_picker};
use crate::tree::{read_dir_recursive, FileEntry};
use crate::watcher::watch_vault;
use std::path::Path;
use tauri_plugin_dialog::DialogExt;

#[derive(serde::Serialize)]
pub(crate) struct OpenedFolder {
    pub(crate) path: String,
    pub(crate) entries: Vec<FileEntry>,
}

/// Takes a folder on as the open one: reads its tree, and lets the asset
/// protocol reach inside it so a note's images resolve. Images embedded in a
/// note are served over that protocol, which is handed this folder and nothing
/// else - a note is text from disk that anything could have written, and it has
/// no business reaching the rest of it.
pub(crate) fn adopt_folder<R: tauri::Runtime>(
    window: &tauri::WebviewWindow<R>,
    path: String,
) -> Result<OpenedFolder, String> {
    let directory = Path::new(&path);
    if !directory.is_dir() {
        return Err(format!("\"{}\" is not there any more", path));
    }

    // The one place the boundary is set. Resolved here so that every later
    // check is a comparison between two paths the OS has already agreed on.
    let resolved = directory.canonicalize().map_err(|e| e.to_string())?;
    {
        let vault = vault_of(window);
        *locked(&vault.root) = Some(resolved.clone());
        // The notes of the folder being left are no longer anything to be out
        // of date with.
        locked(&vault.known).clear();
    }

    // A folder that cannot be watched is still a folder worth opening; what is
    // lost is the notice, not the vault.
    if let Err(error) = watch_vault(window, &resolved) {
        eprintln!("nuza: not watching \"{}\" for changes: {}", path, error);
    }

    let entries = read_dir_recursive(directory)?;
    Ok(OpenedFolder { path, entries })
}

/// Opens a native "open folder" dialog and returns the folder's path plus its
/// contents as a tree, read recursively. Returns `None` if the user cancels.
#[tauri::command]
pub(crate) async fn load_folder_picker(
    window: tauri::WebviewWindow,
) -> Result<Option<OpenedFolder>, String> {
    let scope = window.clone();
    wait_for_picker(|send| {
        window.dialog().file().pick_folder(move |folder_path| {
            let result = match folder_path {
                Some(path) => adopt_folder(&scope, path.to_string()).map(Some),
                None => Ok(None),
            };
            send(result);
        });
    })
    .await
}

/// Reopens a folder the app already knows about, without asking for it again.
#[tauri::command]
pub(crate) async fn open_folder(
    window: tauri::WebviewWindow,
    path: String,
) -> Result<OpenedFolder, String> {
    off_thread(move || adopt_folder(&window, path)).await
}
