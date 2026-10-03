use std::fs;
use std::path::{Path, PathBuf};
use std::time::SystemTime;

#[derive(serde::Serialize)]
pub(crate) struct FileEntry {
    pub(crate) name: String,
    pub(crate) path: String,
    #[serde(rename = "isDirectory")] // this ensures the JSON key is camel case
    pub(crate) is_directory: bool,
    // Left off a file rather than sent as `null`: a large vault is mostly
    // files, and the whole tree crosses the bridge as one string.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) children: Option<Vec<FileEntry>>,
    /// Milliseconds since the epoch, for sorting the tree by date. Left off
    /// when the filesystem does not say - some do not record creation at all.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) modified: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) created: Option<u64>,
}

pub(crate) fn epoch_millis(time: std::io::Result<SystemTime>) -> Option<u64> {
    let since = time.ok()?.duration_since(SystemTime::UNIX_EPOCH).ok()?;
    u64::try_from(since.as_millis()).ok()
}

/// Entries that are never notes: the dot-directories tools keep their own state
/// in, and dependency folders. A vault that happens to sit inside a repository
/// or a project can carry far more of these than it does notes, and walking
/// them costs more than everything the sidebar is actually there to show.
pub(crate) fn is_ignored(name: &str) -> bool {
    name.starts_with('.') || name == "node_modules"
}

/// How many folders deep a vault is read. Past this a folder is listed with
/// nothing in it: no vault of notes goes this deep, and a walk that does has
/// found a way around in circles that the checks below did not catch.
pub(crate) const MAX_TREE_DEPTH: usize = 64;

/// The vault's tree, read in full.
///
/// A symlink is not followed the way a folder is. `Path::is_dir` follows
/// links, so a link back up the tree - `ln -s . loop` - was walked forever,
/// until the stack ran out and took the app with it. A link to a folder is
/// only followed when it lands inside the vault and not on a folder the walk
/// is already inside; one that leads out is left out altogether, since every
/// command here refuses a path outside the vault and its notes could only
/// ever fail to open.
pub(crate) fn read_dir_recursive(path: &Path) -> Result<Vec<FileEntry>, String> {
    let root = path.canonicalize().map_err(|e| e.to_string())?;
    let mut ancestors = vec![root.clone()];
    read_tree(path, &root, &mut ancestors)
}

/// `path`'s entries, with `ancestors` holding the resolved folders the walk
/// is inside, `path`'s own last.
pub(crate) fn read_tree(
    path: &Path,
    root: &Path,
    ancestors: &mut Vec<PathBuf>,
) -> Result<Vec<FileEntry>, String> {
    let mut entries = Vec::new();

    for entry in fs::read_dir(path).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let entry_path = entry.path();
        let name = entry.file_name().to_string_lossy().into_owned();

        if is_ignored(&name) {
            continue;
        }

        // `file_type` describes the entry itself, and does not follow a link.
        let file_type = entry.file_type().map_err(|e| e.to_string())?;
        let resolved = if file_type.is_symlink() {
            match fs::canonicalize(&entry_path) {
                Ok(target) if target.is_dir() => {
                    if !target.starts_with(root) || ancestors.contains(&target) {
                        continue;
                    }
                    Some(target)
                }
                // A link to a file, or one that leads nowhere, is listed as
                // the file it names - as it always was.
                _ => None,
            }
        } else if file_type.is_dir() {
            ancestors.last().map(|parent| parent.join(&name))
        } else {
            None
        };

        let is_directory = resolved.is_some();
        let children = match resolved {
            Some(folder) if ancestors.len() < MAX_TREE_DEPTH => {
                ancestors.push(folder);
                let children = read_tree(&entry_path, root, ancestors);
                ancestors.pop();
                Some(children?)
            }
            Some(_) => Some(Vec::new()),
            None => None,
        };

        // The entry's own times, not a link's target's: it is the row that is
        // being sorted. On Windows this costs nothing, the listing carries it.
        let metadata = entry.metadata().ok();
        entries.push(FileEntry {
            name,
            path: entry_path.to_string_lossy().into_owned(),
            is_directory,
            children,
            modified: metadata.as_ref().and_then(|m| epoch_millis(m.modified())),
            created: metadata.as_ref().and_then(|m| epoch_millis(m.created())),
        });
    }

    // Sort so directories appear first, then alphabetically
    entries.sort_by(|a, b| {
        b.is_directory
            .cmp(&a.is_directory)
            .then(a.name.to_lowercase().cmp(&b.name.to_lowercase()))
    });

    Ok(entries)
}
