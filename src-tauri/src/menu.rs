#[cfg(target_os = "macos")]
use crate::multiwindow;
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
/// which writes what is outstanding and then exits - for every window, now:
/// see `multiwindow::begin_quit`.
#[cfg(target_os = "macos")]
pub(crate) const QUIT_ITEM: &str = "quit-app";

/// "New Window", which opens a window on the welcome screen.
#[cfg(target_os = "macos")]
pub(crate) const NEW_WINDOW_ITEM: &str = "new-window";

/// The menu bar is the app's and not a window's, so the windows open are listed
/// in the Window menu by items of this id, followed by the window's label.
#[cfg(target_os = "macos")]
pub(crate) const WINDOW_ITEM_PREFIX: &str = "window:";

/// Kept around so the shortcut can follow a rebind in Settings.
#[cfg(target_os = "macos")]
pub(crate) struct CloseTabItem(pub(crate) tauri::menu::MenuItem<Wry>);

/// Kept around so the list of windows in it can follow the windows.
#[cfg(target_os = "macos")]
pub(crate) struct WindowMenu(pub(crate) tauri::menu::Submenu<Wry>);

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

    let new_window = MenuItem::with_id(
        app,
        NEW_WINDOW_ITEM,
        "New Window",
        true,
        Some("CmdOrCtrl+Shift+N"),
    )?;
    let windows = Submenu::with_items(
        app,
        "Window",
        true,
        &[
            &PredefinedMenuItem::minimize(app, None)?,
            &PredefinedMenuItem::maximize(app, None)?,
        ],
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
            &Submenu::with_items(
                app,
                "File",
                true,
                &[
                    &new_window,
                    &PredefinedMenuItem::separator(app)?,
                    &close_tab,
                ],
            )?,
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
            &windows,
        ],
    )?;

    app.manage(CloseTabItem(close_tab));
    app.manage(WindowMenu(windows));
    Ok(menu)
}

/// What the menu bar's items do.
#[cfg(target_os = "macos")]
pub(crate) fn on_menu_event(app: &tauri::AppHandle, event: tauri::menu::MenuEvent) {
    let id = event.id().as_ref();
    if id == CLOSE_TAB_ITEM {
        // The window in front is the one whose tab is closed: the others are
        // not listening for the key, and a tab is not theirs to lose.
        let target = app
            .webview_windows()
            .into_values()
            .find(|window| window.is_focused().unwrap_or(false))
            .map(|window| window.label().to_string())
            .or_else(|| {
                multiwindow::open_windows(app)
                    .into_iter()
                    .next()
                    .map(|window| window.label)
            });
        if let Some(label) = target {
            use tauri::Emitter;
            let _ = app.emit_to(&label, CLOSE_TAB_EVENT, ());
        }
    } else if id == QUIT_ITEM {
        multiwindow::begin_quit(app);
    } else if id == NEW_WINDOW_ITEM {
        multiwindow::open_window_soon(app, None);
    } else if let Some(label) = id.strip_prefix(WINDOW_ITEM_PREFIX) {
        if let Some(window) = app.get_webview_window(label) {
            let _ = window.unminimize();
            let _ = window.show();
            let _ = window.set_focus();
        }
    }
}

/// What a window is called in the Window menu: the folder it has open, since
/// the windows themselves have no title.
#[cfg(target_os = "macos")]
fn window_title(root: Option<&std::path::Path>) -> String {
    root.and_then(|root| root.file_name())
        .map(|name| name.to_string_lossy().into_owned())
        .unwrap_or_else(|| "New Window".to_string())
}

/// Brings the Window menu's list of windows into line with the windows that
/// are open: one item for each, after the two that are always there.
#[cfg(target_os = "macos")]
pub(crate) fn refresh_window_menu(app: &tauri::AppHandle) {
    use tauri::menu::{MenuItem, PredefinedMenuItem};

    let Some(menu) = app.try_state::<WindowMenu>() else {
        return;
    };
    let menu = &menu.0;

    // Everything this put there last time, and the separator in front of it.
    if let Ok(items) = menu.items() {
        for item in items.iter().skip(2) {
            let _ = menu.remove(item);
        }
    }

    let mut windows = multiwindow::open_windows(app);
    windows.sort_by_key(|window| creation_rank(&window.label));
    if windows.is_empty() {
        return;
    }
    if let Ok(separator) = PredefinedMenuItem::separator(app) {
        let _ = menu.append(&separator);
    }
    let vaults = app.state::<crate::state::Windows>();
    for window in windows {
        let title = window_title(vaults.root(&window.label).as_deref());
        let id = format!("{WINDOW_ITEM_PREFIX}{}", window.label);
        if let Ok(item) = MenuItem::with_id(app, id, title, true, None::<&str>) {
            let _ = menu.append(&item);
        }
    }
}

/// `main` first, then the rest as they were opened.
#[cfg(target_os = "macos")]
fn creation_rank(label: &str) -> usize {
    label
        .strip_prefix("w-")
        .and_then(|n| n.parse().ok())
        .unwrap_or(0)
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
