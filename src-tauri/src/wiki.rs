use crate::index::VaultIndex;
use crate::search::PREVIEW_LENGTH;
use crate::state::vault_of;
use crate::tasks::off_thread;

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

/// What `scan` finds in each of the notes `index` holds - the ones the sidebar
/// lists, that are small enough, and text - given the note's path and its text.
pub(crate) fn scan_index<T>(index: &VaultIndex, scan: impl Fn(&str, &str) -> Vec<T>) -> Vec<T> {
    index
        .notes()
        .iter()
        .flat_map(|note| scan(&note.path, &note.text))
        .collect()
}

#[cfg(test)]
/// The same for the notes under `root`, read from a fresh index of it.
pub(crate) fn scan_vault<T>(
    root: &std::path::Path,
    scan: impl Fn(&str, &str) -> Vec<T>,
) -> Result<Vec<T>, String> {
    Ok(scan_index(&*VaultIndex::for_folder(root)?, scan))
}

#[cfg(test)]
/// Every wiki-link in the notes under `root`, the ones the sidebar lists.
pub(crate) fn vault_wiki_links(root: &std::path::Path) -> Result<Vec<WikiLinkRef>, String> {
    scan_vault(root, wiki_links_in)
}

/// Every wiki-link written in the open vault, for the backlinks panel.
#[tauri::command]
pub(crate) async fn list_wiki_links(
    window: tauri::WebviewWindow,
) -> Result<Vec<WikiLinkRef>, String> {
    off_thread(move || {
        let index = vault_of(&window).index.clone();
        Ok(scan_index(&index, wiki_links_in))
    })
    .await
}
