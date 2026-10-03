use crate::state::{locked, vault_of};
use crate::tasks::off_thread;
use crate::tree::{read_dir_recursive, FileEntry};
use crate::wiki::scan_vault;
use std::fs;
use std::path::{Path, PathBuf};

/// A line of a note that holds what was searched for.
#[derive(serde::Serialize, Debug, PartialEq)]
pub(crate) struct ContentHit {
    pub(crate) path: String,
    /// 1-based, as an editor counts lines.
    pub(crate) line: usize,
    /// Where the match starts in its line, in UTF-16 code units - the unit
    /// both JavaScript strings and CodeMirror positions are counted in.
    pub(crate) column: usize,
    /// The line, cut down around the match when it is long.
    pub(crate) preview: String,
    /// Where the match starts and how long it is, within `preview`, in UTF-16.
    #[serde(rename = "previewStart")]
    pub(crate) preview_start: usize,
    #[serde(rename = "matchLength")]
    pub(crate) match_length: usize,
}

/// The most hits one search returns: past this, the query wants narrowing.
pub(crate) const CONTENT_HIT_LIMIT: usize = 200;
/// The most hits one note contributes, so one long note cannot crowd out the rest.
pub(crate) const HITS_PER_NOTE: usize = 5;
/// Notes larger than this are not searched - they are not notes anyone typed.
pub(crate) const SEARCHABLE_BYTES: u64 = 4 * 1024 * 1024;
/// How much of a line is shown before the match, and at most in all. Kept
/// short in front: the sidebar is narrow, and the row cuts the end off.
pub(crate) const PREVIEW_BEFORE: usize = 12;
pub(crate) const PREVIEW_LENGTH: usize = 120;

pub(crate) fn utf16_len(chars: &[char]) -> usize {
    chars.iter().map(|c| c.len_utf16()).sum()
}

/// A character folded for comparison. Only characters whose lower case is a
/// single character are folded, so a match always spans as many characters
/// in the line as there are in the query.
pub(crate) fn fold(c: char) -> char {
    let mut lower = c.to_lowercase();
    match (lower.next(), lower.next()) {
        (Some(single), None) => single,
        _ => c,
    }
}

/// Every place in `text` that `query` matches, ignoring case, as a hit on
/// `path`. `query` is already folded. At most `limit` are returned.
pub(crate) fn search_text(path: &str, text: &str, query: &[char], limit: usize) -> Vec<ContentHit> {
    let mut hits = Vec::new();
    if query.is_empty() {
        return hits;
    }

    for (index, line) in text.lines().enumerate() {
        let chars: Vec<char> = line.chars().collect();
        if chars.len() < query.len() {
            continue;
        }
        let folded: Vec<char> = chars.iter().map(|&c| fold(c)).collect();
        let Some(start) = folded
            .windows(query.len())
            .position(|window| window == query)
        else {
            continue;
        };

        let from = start.saturating_sub(PREVIEW_BEFORE);
        let to = (from + PREVIEW_LENGTH)
            .max(start + query.len())
            .min(chars.len());
        let mut preview = String::new();
        let mut preview_start = utf16_len(&chars[from..start]);
        if from > 0 {
            preview.push('\u{2026}');
            preview_start += 1;
        }
        preview.extend(&chars[from..to]);
        if to < chars.len() {
            preview.push('\u{2026}');
        }

        hits.push(ContentHit {
            path: path.to_string(),
            line: index + 1,
            column: utf16_len(&chars[..start]),
            preview,
            preview_start,
            match_length: utf16_len(&chars[start..start + query.len()]),
        });
        if hits.len() >= limit {
            break;
        }
    }

    hits
}

/// Every markdown note in a tree read by `read_dir_recursive`, in the order
/// the sidebar lists them.
pub(crate) fn markdown_notes(entries: &[FileEntry], out: &mut Vec<PathBuf>) {
    for entry in entries {
        if let Some(children) = &entry.children {
            markdown_notes(children, out);
        } else if Path::new(&entry.name)
            .extension()
            .is_some_and(|extension| extension.eq_ignore_ascii_case("md"))
        {
            out.push(PathBuf::from(&entry.path));
        }
    }
}

/// Searches the text of every note under `root` for `query`, ignoring case.
///
/// The notes are the ones the sidebar lists - the same walk, with the same
/// folders left out and the same rules for symlinks - so a hit is never in a
/// note the tree does not show.
pub(crate) fn search_vault(root: &Path, query: &str) -> Result<Vec<ContentHit>, String> {
    let query: Vec<char> = query.trim().chars().map(fold).collect();
    let mut hits = Vec::new();
    if query.is_empty() {
        return Ok(hits);
    }

    let mut notes = Vec::new();
    markdown_notes(&read_dir_recursive(root)?, &mut notes);

    for note in notes {
        let remaining = CONTENT_HIT_LIMIT - hits.len();
        if remaining == 0 {
            break;
        }
        if fs::metadata(&note).map_or(true, |meta| meta.len() > SEARCHABLE_BYTES) {
            continue;
        }
        // Unreadable, or not text: nothing in it to find.
        let Ok(text) = fs::read_to_string(&note) else {
            continue;
        };
        let path = note.to_string_lossy();
        hits.extend(search_text(
            &path,
            &text,
            &query,
            remaining.min(HITS_PER_NOTE),
        ));
    }

    Ok(hits)
}

/// Every `#tag` written in the open vault, for the sidebar's list of them.
#[tauri::command]
pub(crate) async fn list_tags(
    window: tauri::WebviewWindow,
) -> Result<Vec<crate::tags::TagRef>, String> {
    off_thread(move || {
        let root = locked(&vault_of(&window).root).clone();
        match root {
            Some(root) => scan_vault(&root, crate::tags::tags_in),
            None => Ok(Vec::new()),
        }
    })
    .await
}

/// The lines of the open vault's notes that contain `query`, ignoring case.
#[tauri::command]
pub(crate) async fn search_contents(
    window: tauri::WebviewWindow,
    query: String,
) -> Result<Vec<ContentHit>, String> {
    off_thread(move || {
        let root = locked(&vault_of(&window).root).clone();
        let Some(root) = root else {
            return Ok(Vec::new());
        };
        search_vault(&root, &query)
    })
    .await
}
