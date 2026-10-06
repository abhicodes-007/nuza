//! Starting from an AppImage on a system newer than the one it was built on.
//!
//! The AppImage carries its own libwayland-client, from the release runner,
//! and puts it ahead of the system's. The graphics driver is always the
//! system's, though, and a newer one asks libwayland for things the bundled
//! copy does not have. WebKit then cannot get an EGL display - "Could not
//! create default EGL display: EGL_BAD_PARAMETER. Aborting..." - and the
//! window comes up empty. It is what happens on Arch under Wayland.
//!
//! So the system's libwayland-client is preloaded over the bundled one, which
//! has to be in place before the program is loaded: nuza starts itself again
//! with `LD_PRELOAD` set, and WebKit's own processes inherit it.

use std::ffi::{OsStr, OsString};
use std::os::unix::process::CommandExt;
use std::path::Path;

/// Set on the second start, so that it is not followed by a third.
const RESTARTED: &str = "NUZA_APPIMAGE_RESTARTED";

const LIBRARY: &str = "libwayland-client.so.0";

/// Where distributions keep their libraries, the build's own architecture
/// first among the Debian ones.
const LIBRARY_DIRS: &[&str] = &[
    "/usr/lib64",
    #[cfg(target_arch = "x86_64")]
    "/usr/lib/x86_64-linux-gnu",
    #[cfg(target_arch = "aarch64")]
    "/usr/lib/aarch64-linux-gnu",
    "/usr/lib",
];

/// Starts nuza again with the system's libwayland-client preloaded, when it
/// is running from an AppImage and has not already done so. Returns - and
/// the app starts as it is - whenever that is not possible.
pub(crate) fn prefer_system_wayland() {
    if std::env::var_os("APPIMAGE").is_none_or(|image| image.is_empty())
        || std::env::var_os(RESTARTED).is_some()
    {
        return;
    }
    let Some(library) = LIBRARY_DIRS
        .iter()
        .map(|dir| Path::new(dir).join(LIBRARY))
        .find(|path| path.is_file())
    else {
        return;
    };
    let Some(preload) = preload_with(std::env::var_os("LD_PRELOAD"), library.as_os_str()) else {
        return;
    };
    let Ok(program) = std::env::current_exe() else {
        return;
    };

    // `exec` only returns if it failed, and then the app carries on as it was.
    let error = std::process::Command::new(program)
        .args(std::env::args_os().skip(1))
        .env("LD_PRELOAD", preload)
        .env(RESTARTED, "1")
        .exec();
    eprintln!("nuza: could not restart with the system's {LIBRARY}: {error}");
}

/// `LD_PRELOAD` with `library` put first, or `None` if the person has already
/// chosen a libwayland-client of their own.
fn preload_with(existing: Option<OsString>, library: &OsStr) -> Option<OsString> {
    let Some(existing) = existing.filter(|value| !value.is_empty()) else {
        return Some(library.to_os_string());
    };
    if existing.to_string_lossy().contains("libwayland-client") {
        return None;
    }
    let mut preload = library.to_os_string();
    preload.push(":");
    preload.push(existing);
    Some(preload)
}

#[cfg(test)]
mod tests {
    use super::*;

    const SYSTEM: &str = "/usr/lib/libwayland-client.so.0";

    #[test]
    fn the_library_is_the_whole_preload_when_there_is_none() {
        assert_eq!(preload_with(None, OsStr::new(SYSTEM)), Some(SYSTEM.into()));
        assert_eq!(
            preload_with(Some("".into()), OsStr::new(SYSTEM)),
            Some(SYSTEM.into())
        );
    }

    #[test]
    fn the_library_goes_ahead_of_what_is_already_preloaded() {
        assert_eq!(
            preload_with(Some("/usr/lib/libfoo.so".into()), OsStr::new(SYSTEM)),
            Some("/usr/lib/libwayland-client.so.0:/usr/lib/libfoo.so".into())
        );
    }

    #[test]
    fn a_libwayland_the_person_chose_is_left_alone() {
        assert_eq!(
            preload_with(
                Some("/opt/wayland/libwayland-client.so.0".into()),
                OsStr::new(SYSTEM)
            ),
            None
        );
    }
}
