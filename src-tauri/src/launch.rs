use crate::state::{locked, LaunchTarget};
use std::path::PathBuf;
use tauri::Manager;

/// Announced when `nuza <path>` is run while the app is open, carrying what
/// was asked for.
pub(crate) const OPEN_TARGET_EVENT: &str = "open-target";

/// Announced when a note has changed underneath the app, carrying its path.
pub(crate) const FILE_CHANGED_EVENT: &str = "file-changed";

/// The note or folder the app was started on from a terminal, once: the
/// window asks as it comes up, and a second ask finds nothing.
#[tauri::command]
pub(crate) fn take_launch_target(app_handle: tauri::AppHandle) -> Option<crate::cli::OpenTarget> {
    locked(&app_handle.state::<LaunchTarget>().0).take()
}

/// The program as the user would start it: the AppImage itself when that is
/// what is running, since the executable inside it is gone once it exits.
pub(crate) fn command_program() -> Result<PathBuf, String> {
    match std::env::var_os("APPIMAGE") {
        Some(image) if !image.is_empty() => Ok(PathBuf::from(image)),
        _ => std::env::current_exe().map_err(|e| e.to_string()),
    }
}

pub(crate) fn home_directory() -> Result<PathBuf, String> {
    std::env::var_os("HOME")
        .or_else(|| std::env::var_os("USERPROFILE"))
        .map(PathBuf::from)
        .ok_or_else(|| "Can't tell where your home folder is".to_string())
}

/// Whether the `nuza` command is installed, for Settings.
#[tauri::command]
pub(crate) fn cli_status() -> Result<crate::cli::CliStatus, String> {
    Ok(crate::cli::status(&home_directory()?, &command_program()?))
}

#[tauri::command]
pub(crate) fn install_cli() -> Result<crate::cli::CliStatus, String> {
    crate::cli::install(&home_directory()?, &command_program()?)
}

#[tauri::command]
pub(crate) fn uninstall_cli() -> Result<crate::cli::CliStatus, String> {
    crate::cli::uninstall(&home_directory()?, &command_program()?)
}
