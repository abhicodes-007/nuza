use crate::search::{markdown_notes, PREVIEW_LENGTH, SEARCHABLE_BYTES};
use crate::state::{locked, vault_of};
use crate::tasks::off_thread;
use crate::tree::read_dir_recursive;
use std::fs;
use std::path::Path;

/// A `[[wiki-link]]` written in a note: which note, which line, and what is
/// between the brackets - resolving that to a note is the frontend's, which
/// knows the rules and already holds the tree they are applied to.
#[derive(serde::Serialize, Debug, PartialEq)]
pub(crate) struct WikiLinkRef {
    pub(crate) from: String,
    /// What is between `[[` and `]]`, as written.
    pub(crate) target: String,
    /// 1-based.
    pub(crate) line: usize,
    /// The line, cut down when it is long.
    pub(crate) preview: String,
}

/// Every `[[wiki-link]]` in `text`, on the lines outside fenced code. A link
/// cannot run across a line or hold a bracket, the same rules the editor's
/// parser follows.
pub(crate) fn wiki_links_in(from: &str, text: &str) -> Vec<WikiLinkRef> {
    let mut links = Vec::new();
    let mut fenced = false;

    for (index, line) in text.lines().enumerate() {
        let trimmed = line.trim_start();
        if trimmed.starts_with("```") || trimmed.starts_with("~~~") {
            fenced = !fenced;
            continue;
        }
        if fenced {
            continue;
        }

        let mut rest = line;
        while let Some(open) = rest.find("[[") {
            let after = &rest[open + 2..];
            let Some(close) = after.find("]]") else { break };
            let inner = &after[..close];
            // Not a link - empty, or holding a bracket: look again just past
            // its `[[`, since a real one can start inside it, as `[[x] [[y]]`.
            if inner.is_empty() || inner.contains('[') || inner.contains(']') {
                rest = after;
                continue;
            }
            let preview: String = line.trim().chars().take(PREVIEW_LENGTH).collect();
            links.push(WikiLinkRef {
                from: from.to_string(),
                target: inner.to_string(),
                line: index + 1,
                preview,
            });
            rest = &after[close + 2..];
        }
    }

    links
}

/// Reads each of the notes under `root` that the sidebar lists - and that are
/// small enough, and text - and collects what `scan` finds in them, given the
/// note's path and its text.
pub(crate) fn scan_vault<T>(
    root: &Path,
    scan: impl Fn(&str, &str) -> Vec<T>,
) -> Result<Vec<T>, String> {
    let mut notes = Vec::new();
    markdown_notes(&read_dir_recursive(root)?, &mut notes);

    let mut found = Vec::new();
    for note in notes {
        if fs::metadata(&note).map_or(true, |meta| meta.len() > SEARCHABLE_BYTES) {
            continue;
        }
        let Ok(text) = fs::read_to_string(&note) else {
            continue;
        };
        found.extend(scan(&note.to_string_lossy(), &text));
    }
    Ok(found)
}

/// Every wiki-link in the notes under `root`, the ones the sidebar lists.
pub(crate) fn vault_wiki_links(root: &Path) -> Result<Vec<WikiLinkRef>, String> {
    scan_vault(root, wiki_links_in)
}

/// Every wiki-link written in the open vault, for the backlinks panel.
#[tauri::command]
pub(crate) async fn list_wiki_links(
    window: tauri::WebviewWindow,
) -> Result<Vec<WikiLinkRef>, String> {
    off_thread(move || {
        let root = locked(&vault_of(&window).root).clone();
        match root {
            Some(root) => vault_wiki_links(&root),
            None => Ok(Vec::new()),
        }
    })
    .await
}
