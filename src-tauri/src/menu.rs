#[cfg(target_os = "macos")]
use tauri::Manager;
#[cfg(target_os = "macos")]
use tauri::Wry;

/// macOS hands ⌘W to the window, not to whatever is in front of you: the menu
/// bar takes the key before the webview is offered it, and closing the window
/// closes the app. The default menu is rebuilt here with "Close Window"
/// replaced by a "Close Tab" item of our own, which the frontend answers by
/// closing the open note.
#[cfg(target_os = "macos")]
pub(crate) const CLOSE_TAB_ITEM: &str = "close-tab";

/// The event the item fires, listened for by the app's keymap handling.
#[cfg(target_os = "macos")]
pub(crate) const CLOSE_TAB_EVENT: &str = "menu:close-tab";

/// Quitting has the same problem as ⌘W, and it costs more: the predefined
/// Quit item ends the process the moment the key is pressed, which may be in
/// the second after a keystroke while the note it changed is still waiting on
/// the autosave timer. This item announces the quit to the frontend instead,
/// which writes what is outstanding and then exits.
#[cfg(target_os = "macos")]
pub(crate) const QUIT_ITEM: &str = "quit-app";

/// The event that item fires.
#[cfg(target_os = "macos")]
pub(crate) const QUIT_EVENT: &str = "menu:quit";

/// Kept around so the shortcut can follow a rebind in Settings.
#[cfg(target_os = "macos")]
pub(crate) struct CloseTabItem(pub(crate) tauri::menu::MenuItem<Wry>);

#[cfg(target_os = "macos")]
pub(crate) fn build_menu(app: &tauri::AppHandle) -> tauri::Result<tauri::menu::Menu<Wry>> {
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
pub(crate) fn set_close_tab_shortcut(
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
