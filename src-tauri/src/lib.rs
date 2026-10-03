mod cli;
mod files;
mod folder;
mod fonts;
mod launch;
mod media;
mod menu;
mod recovery;
mod search;
mod state;
mod tags;
mod tasks;
mod tree;
mod watcher;
mod wiki;
mod window;

#[cfg(test)]
mod tests;

use std::path::Path;
use std::sync::Mutex;
use tauri::{Emitter, Manager};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default();

    // First of the plugins, which is what it asks for: a second `nuza` is
    // stopped before it sets anything else up, and its arguments come here.
    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    let builder = builder.plugin(tauri_plugin_single_instance::init(|app, args, cwd| {
        if let Some(target) = cli::target_from_args(&args, Path::new(&cwd)) {
            let _ = app.emit(launch::OPEN_TARGET_EVENT, target);
        }
        // Whether or not it named anything, the person has just run the
        // command, and wants to see the app.
        if let Some(window) = app.get_webview_window("main") {
            let _ = window.unminimize();
            let _ = window.show();
            let _ = window.set_focus();
        }
    }));

    let builder = builder
        // A note's images and video, served against the open folder rather
        // than against a list of every folder ever opened.
        .register_asynchronous_uri_scheme_protocol(
            media::MEDIA_PROTOCOL,
            |context, request, responder| {
                let app_handle = context.app_handle().clone();
                // Which window asked decides which folder the file may come from.
                let label = context.webview_label().to_string();
                // Off the main thread for the same reason the commands are:
                // this reads a file, and a video asks for a great many of
                // these while the window is trying to draw.
                tauri::async_runtime::spawn_blocking(move || {
                    responder.respond(media::serve_media(&app_handle, &label, &request));
                });
            },
        )
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            // Empty until a folder is opened, which is also what makes every
            // filesystem command refuse until then.
            app.manage(state::Windows::default());

            // What `nuza <path>` started this run on, if it did. Read here, not
            // by the window, so it does not depend on who asks first.
            let launched = std::env::current_dir()
                .ok()
                .and_then(|cwd| cli::target_from_args(&std::env::args().collect::<Vec<_>>(), &cwd));
            app.manage(state::LaunchTarget(Mutex::new(launched)));

            // A window without a backdrop is a window that paints itself
            // opaque - the frontend already handles that, and it is not worth
            // refusing to start over.
            if let Some(window) = app.get_webview_window("main") {
                if let Err(error) = window::apply_transparency(&window, true) {
                    eprintln!("nuza: no window backdrop on this platform: {}", error);
                }
            }
            Ok(())
        })
        .on_window_event(|window, event| {
            // The window's folder goes with it, and its watcher with that.
            if let tauri::WindowEvent::Destroyed = event {
                window.state::<state::Windows>().remove(window.label());
            }
        })
        .plugin(tauri_plugin_opener::init());

    #[cfg(target_os = "macos")]
    let builder = builder.menu(menu::build_menu).on_menu_event(|app, event| {
        if event.id() == menu::CLOSE_TAB_ITEM {
            let _ = app.emit(menu::CLOSE_TAB_EVENT, ());
        } else if event.id() == menu::QUIT_ITEM {
            let _ = app.emit(menu::QUIT_EVENT, ());
        }
    });

    builder
        .invoke_handler(tauri::generate_handler![
            files::save_file_picker,
            folder::load_folder_picker,
            folder::open_folder,
            files::read_file,
            search::search_contents,
            wiki::list_wiki_links,
            search::list_tags,
            launch::take_launch_target,
            launch::cli_status,
            launch::install_cli,
            launch::uninstall_cli,
            files::duplicate_entry,
            files::write_file,
            media::write_media,
            recovery::keep_recovery,
            recovery::take_recovery,
            recovery::drop_recovery,
            files::create_file,
            files::create_folder,
            files::rename_entry,
            files::move_entry,
            files::delete_entry,
            fonts::list_system_fonts,
            window::set_transparency,
            window::print_page,
            menu::set_close_tab_shortcut
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
