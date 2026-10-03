use crate::tasks::off_thread;

/// True for legacy symbol-encoded fonts (Wingdings, Webdings, ...), which map
/// plain letters to pictographs. Picking one would turn every note - and the
/// line numbers - into symbols, since the monospace fallback never kicks in.
pub(crate) fn is_symbol_font(data: &[u8], index: u32) -> bool {
    let Some(cmap) = ttf_parser::Face::parse(data, index)
        .ok()
        .and_then(|face| face.tables().cmap)
    else {
        return false;
    };
    // One pass, and out at the first Unicode table - which is most fonts, on
    // their first subtable.
    let mut symbol = false;
    for subtable in cmap.subtables {
        if subtable.is_unicode() {
            return false;
        }
        symbol |=
            subtable.platform_id == ttf_parser::PlatformId::Windows && subtable.encoding_id == 0;
    }
    symbol
}

/// Lists the family names of every font installed on the system, sorted
/// case-insensitively. Async so the font scan runs off the main thread.
#[tauri::command]
pub(crate) async fn list_system_fonts() -> Vec<String> {
    // Parsing every face on the system is the slow part of opening the font
    // picker, and its answer does not change while the app is running - so it
    // is worked out once per launch rather than once per webview load. A font
    // installed while the app is open turns up after a restart.
    static FAMILIES: std::sync::OnceLock<Vec<String>> = std::sync::OnceLock::new();
    if let Some(families) = FAMILIES.get() {
        return families.clone();
    }

    // Off the async runtime's threads: this is seconds of blocking file reads.
    off_thread(|| Ok(FAMILIES.get_or_init(system_font_families).clone()))
        .await
        .unwrap_or_default()
}

pub(crate) fn system_font_families() -> Vec<String> {
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
