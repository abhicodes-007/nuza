use crate::files::{
    already_exists, create_unused, duplicate_file, exact_file_name, move_destination,
    rename_no_replace, safe_file_name, write_atomically,
};
use crate::fonts::system_font_families;
use crate::media::{body_bytes, header_text, media_body, requested_path};
use crate::recovery::{recovery_file, Recovery};
use crate::search::{fold, search_text, search_vault, ContentHit};
use crate::state::{
    changed_since_read, locked, remember, within_vault, within_vault_to_create,
    within_vault_to_write, Vault, Windows,
};
use crate::tree::{read_dir_recursive, FileEntry, MAX_TREE_DEPTH};
use crate::wiki::{scan_vault, vault_wiki_links, wiki_links_in};
use std::fs;
use std::path::Path;
use std::sync::Mutex;
use std::time::SystemTime;

/// The note as it stands on disk, for asserting a write actually landed.
fn contents(path: &Path) -> String {
    fs::read_to_string(path).expect("the note should be readable")
}

#[test]
fn writes_a_new_note() {
    let vault = tempfile::tempdir().unwrap();
    let note = vault.path().join("note.md");

    write_atomically(&note, b"hello").unwrap();

    assert_eq!(contents(&note), "hello");
}

#[test]
fn replaces_an_existing_note() {
    let vault = tempfile::tempdir().unwrap();
    let note = vault.path().join("note.md");
    fs::write(&note, "the long version of the note").unwrap();

    write_atomically(&note, b"short").unwrap();

    assert_eq!(contents(&note), "short");
}

/// The temporary file is an implementation detail; a vault that collects
/// one per autosave would be one the sidebar fills up with rubbish.
#[test]
fn leaves_nothing_behind_beside_the_note() {
    let vault = tempfile::tempdir().unwrap();
    let note = vault.path().join("note.md");

    write_atomically(&note, b"one").unwrap();
    write_atomically(&note, b"two").unwrap();

    let entries: Vec<_> = fs::read_dir(vault.path()).unwrap().flatten().collect();
    assert_eq!(entries.len(), 1);
    assert_eq!(entries[0].path(), note);
}

/// A note that was readable by the group or the world stays that way after
/// the app has saved it once.
#[cfg(unix)]
#[test]
fn keeps_the_permissions_the_note_already_had() {
    use std::os::unix::fs::PermissionsExt;

    let vault = tempfile::tempdir().unwrap();
    let note = vault.path().join("note.md");
    fs::write(&note, "before").unwrap();
    fs::set_permissions(&note, fs::Permissions::from_mode(0o644)).unwrap();

    write_atomically(&note, b"after").unwrap();

    let mode = fs::metadata(&note).unwrap().permissions().mode() & 0o777;
    assert_eq!(mode, 0o644);
}

/// A write into a folder that is not there fails outright rather than
/// reporting success over a note that was never saved.
#[test]
fn refuses_a_directory_that_is_not_there() {
    let vault = tempfile::tempdir().unwrap();
    let note = vault.path().join("missing").join("note.md");

    assert!(write_atomically(&note, b"hello").is_err());
}

/// A vault with `root` open and nothing chosen by hand.
fn opened(root: &Path) -> Vault {
    Vault {
        root: Mutex::new(Some(root.canonicalize().unwrap())),
        ..Default::default()
    }
}

#[test]
fn allows_a_note_in_the_vault() {
    let dir = tempfile::tempdir().unwrap();
    let vault = opened(dir.path());
    let note = dir.path().join("note.md");
    fs::write(&note, "hello").unwrap();

    assert!(within_vault(&vault, &note).is_ok());
}

#[test]
fn refuses_a_file_outside_the_vault() {
    let dir = tempfile::tempdir().unwrap();
    let elsewhere = tempfile::tempdir().unwrap();
    let vault = opened(dir.path());
    let secret = elsewhere.path().join("secret.md");
    fs::write(&secret, "hello").unwrap();

    assert!(within_vault(&vault, &secret).is_err());
}

/// Nothing at all is reachable until a folder has been opened.
#[test]
fn refuses_everything_with_no_vault_open() {
    let dir = tempfile::tempdir().unwrap();
    let note = dir.path().join("note.md");
    fs::write(&note, "hello").unwrap();

    assert!(within_vault(&Vault::default(), &note).is_err());
}

/// Two windows on two folders are two vaults: a note in one's folder is
/// nothing to the other, and opening a folder in one does not move the other.
#[test]
fn windows_keep_their_own_folder() {
    let first_dir = tempfile::tempdir().unwrap();
    let second_dir = tempfile::tempdir().unwrap();
    let first_note = first_dir.path().join("note.md");
    let second_note = second_dir.path().join("note.md");
    fs::write(&first_note, "one").unwrap();
    fs::write(&second_note, "two").unwrap();

    let windows = Windows::default();
    *locked(&windows.vault("main").root) = Some(first_dir.path().canonicalize().unwrap());
    *locked(&windows.vault("w-1").root) = Some(second_dir.path().canonicalize().unwrap());

    assert!(within_vault(&windows.vault("main"), &first_note).is_ok());
    assert!(within_vault(&windows.vault("main"), &second_note).is_err());
    assert!(within_vault(&windows.vault("w-1"), &second_note).is_ok());
    assert!(within_vault(&windows.vault("w-1"), &first_note).is_err());
}

/// A window nobody has opened a folder in refuses everything, whatever the
/// other windows have open.
#[test]
fn a_new_window_starts_with_nothing_open() {
    let dir = tempfile::tempdir().unwrap();
    let note = dir.path().join("note.md");
    fs::write(&note, "hello").unwrap();

    let windows = Windows::default();
    *locked(&windows.vault("main").root) = Some(dir.path().canonicalize().unwrap());

    assert!(within_vault(&windows.vault("w-new"), &note).is_err());
}

/// Asking twice for the same window is the same vault, so what one command
/// records is what the next one sees.
#[test]
fn a_window_gets_the_same_vault_each_time() {
    let dir = tempfile::tempdir().unwrap();
    let note = dir.path().join("note.md");
    fs::write(&note, "hello").unwrap();

    let windows = Windows::default();
    remember(&windows.vault("main"), &note);
    fs::write(&note, "changed, and longer").unwrap();
    // Some filesystems keep a second's resolution; make the move unmistakable.
    let later = SystemTime::now() + std::time::Duration::from_secs(5);
    fs::File::options()
        .write(true)
        .open(&note)
        .unwrap()
        .set_modified(later)
        .unwrap();

    assert!(changed_since_read(&windows.vault("main"), &note));
    assert!(!changed_since_read(&windows.vault("w-1"), &note));
}

/// A note one window has read is not one another has: each notices a change
/// to it for itself.
#[test]
fn windows_track_what_they_have_read_separately() {
    let dir = tempfile::tempdir().unwrap();
    let note = dir.path().join("note.md");
    fs::write(&note, "hello").unwrap();

    let windows = Windows::default();
    remember(&windows.vault("main"), &note);
    remember(&windows.vault("w-1"), &note);
    let later = SystemTime::now() + std::time::Duration::from_secs(5);
    fs::File::options()
        .write(true)
        .open(&note)
        .unwrap()
        .set_modified(later)
        .unwrap();
    // `w-1` reads the new version; `main` still holds the old one.
    remember(&windows.vault("w-1"), &note);

    assert!(changed_since_read(&windows.vault("main"), &note));
    assert!(!changed_since_read(&windows.vault("w-1"), &note));
}

/// Closing a window lets go of its vault, and a window of the same name
/// afterwards starts clean.
#[test]
fn closing_a_window_forgets_its_vault() {
    let dir = tempfile::tempdir().unwrap();
    let windows = Windows::default();
    *locked(&windows.vault("w-1").root) = Some(dir.path().canonicalize().unwrap());

    let watching = std::sync::Arc::downgrade(&windows.vault("w-1"));
    windows.remove("w-1");

    assert!(watching.upgrade().is_none());
    assert!(locked(&windows.vault("w-1").root).is_none());
}

/// The reason paths are resolved rather than compared as text.
#[test]
fn refuses_a_way_out_through_dot_dot() {
    let dir = tempfile::tempdir().unwrap();
    let elsewhere = tempfile::tempdir().unwrap();
    let vault = opened(dir.path());
    let secret = elsewhere.path().join("secret.md");
    fs::write(&secret, "hello").unwrap();

    let climbing = dir.path().join("..").join(
        elsewhere
            .path()
            .file_name()
            .map(Path::new)
            .unwrap()
            .join("secret.md"),
    );
    assert!(within_vault(&vault, &climbing).is_err());
}

/// A symlink inside the vault pointing out of it is a way out too.
#[cfg(unix)]
#[test]
fn refuses_a_way_out_through_a_symlink() {
    let dir = tempfile::tempdir().unwrap();
    let elsewhere = tempfile::tempdir().unwrap();
    let vault = opened(dir.path());
    let secret = elsewhere.path().join("secret.md");
    fs::write(&secret, "hello").unwrap();

    let link = dir.path().join("looks-like-a-note.md");
    std::os::unix::fs::symlink(&secret, &link).unwrap();

    assert!(within_vault(&vault, &link).is_err());
    assert!(within_vault_to_write(&vault, &link).is_err());
}

/// A new note has nothing to resolve, so its parent is what is checked -
/// which is also what stops a "name" that is really a path.
#[test]
fn checks_the_parent_of_something_being_created() {
    let dir = tempfile::tempdir().unwrap();
    let vault = opened(dir.path());

    assert!(within_vault_to_create(&vault, &dir.path().join("new.md")).is_ok());
    assert!(within_vault_to_create(&vault, &dir.path().join("../escaped.md")).is_err());
}

/// A note deleted from under the app is still one the app may write back.
#[test]
fn allows_writing_back_a_note_that_has_gone_missing() {
    let dir = tempfile::tempdir().unwrap();
    let vault = opened(dir.path());

    assert!(within_vault_to_write(&vault, &dir.path().join("vanished.md")).is_ok());
}

/// Moves `path`'s modification time on, the way another editor writing to
/// it would - explicitly rather than by writing twice and hoping the clock
/// noticed.
fn touch(path: &Path) {
    let file = fs::OpenOptions::new().write(true).open(path).unwrap();
    let later = SystemTime::now() + std::time::Duration::from_secs(5);
    file.set_times(fs::FileTimes::new().set_modified(later))
        .unwrap();
}

/// A note the app has never read is not out of date with anything.
#[test]
fn a_note_never_read_has_not_changed() {
    let dir = tempfile::tempdir().unwrap();
    let vault = opened(dir.path());
    let note = dir.path().join("note.md");
    fs::write(&note, "hello").unwrap();

    assert!(!changed_since_read(&vault, &note));
}

#[test]
fn a_note_nobody_touched_has_not_changed() {
    let dir = tempfile::tempdir().unwrap();
    let vault = opened(dir.path());
    let note = dir.path().join("note.md");
    fs::write(&note, "hello").unwrap();
    remember(&vault, &note);

    assert!(!changed_since_read(&vault, &note));
}

/// The case the whole thing exists for: something else wrote to the note
/// after the app read it.
#[test]
fn a_note_written_elsewhere_has_changed() {
    let dir = tempfile::tempdir().unwrap();
    let vault = opened(dir.path());
    let note = dir.path().join("note.md");
    fs::write(&note, "hello").unwrap();
    remember(&vault, &note);

    touch(&note);

    assert!(changed_since_read(&vault, &note));
}

/// A note deleted from under the app is not what the app holds either.
#[test]
fn a_note_deleted_elsewhere_has_changed() {
    let dir = tempfile::tempdir().unwrap();
    let vault = opened(dir.path());
    let note = dir.path().join("note.md");
    fs::write(&note, "hello").unwrap();
    remember(&vault, &note);

    fs::remove_file(&note).unwrap();

    assert!(changed_since_read(&vault, &note));
}

/// The app's own save is not an external change: writing records where the
/// note now stands, so the next write is not refused over it.
#[test]
fn the_apps_own_write_is_not_a_change() {
    let dir = tempfile::tempdir().unwrap();
    let vault = opened(dir.path());
    let note = dir.path().join("note.md");
    fs::write(&note, "hello").unwrap();
    remember(&vault, &note);

    touch(&note);
    assert!(changed_since_read(&vault, &note));

    // What write_file does once it has written.
    write_atomically(&note, b"ours").unwrap();
    remember(&vault, &note);

    assert!(!changed_since_read(&vault, &note));
}

/// What `convertFileSrc` puts in the URI, read back out of it.
#[test]
fn reads_the_path_a_media_request_is_asking_for() {
    let uri: tauri::http::Uri = "nuza-media://localhost/%2Fvault%2Fmedia%2Fphoto.png"
        .parse()
        .unwrap();

    assert_eq!(requested_path(&uri), "/vault/media/photo.png");
}

/// A space, and anything else a filename is allowed to contain.
#[test]
fn reads_a_path_with_characters_that_had_to_be_encoded() {
    let uri: tauri::http::Uri = "nuza-media://localhost/%2Fvault%2Fa%20note%20(1).png"
        .parse()
        .unwrap();

    assert_eq!(requested_path(&uri), "/vault/a note (1).png");
}

/// A media file for the range tests, 26 bytes of known content.
fn alphabet(dir: &Path) -> (fs::File, u64) {
    let path = dir.join("media.bin");
    fs::write(&path, b"abcdefghijklmnopqrstuvwxyz").unwrap();
    let file = fs::File::open(&path).unwrap();
    let length = file.metadata().unwrap().len();
    (file, length)
}

#[test]
fn a_request_with_no_range_gets_the_whole_file() {
    let dir = tempfile::tempdir().unwrap();
    let (mut file, length) = alphabet(dir.path());

    let (bytes, content_range, status) = media_body(&mut file, length, None).unwrap();

    assert_eq!(bytes, b"abcdefghijklmnopqrstuvwxyz");
    assert_eq!(content_range, None);
    assert_eq!(status, 200);
}

/// The reason ranges are handled at all: a video is fetched in pieces, and
/// answering every request with the whole file is a video that cannot be
/// seeked.
#[test]
fn a_request_for_part_of_a_file_gets_that_part() {
    let dir = tempfile::tempdir().unwrap();
    let (mut file, length) = alphabet(dir.path());

    let (bytes, content_range, status) = media_body(&mut file, length, Some("bytes=3-7")).unwrap();

    assert_eq!(bytes, b"defgh");
    assert_eq!(content_range.as_deref(), Some("bytes 3-7/26"));
    assert_eq!(status, 206);
}

/// An open-ended range runs to the end of the file.
#[test]
fn a_request_from_a_point_onwards_runs_to_the_end() {
    let dir = tempfile::tempdir().unwrap();
    let (mut file, length) = alphabet(dir.path());

    let (bytes, content_range, _) = media_body(&mut file, length, Some("bytes=20-")).unwrap();

    assert_eq!(bytes, b"uvwxyz");
    assert_eq!(content_range.as_deref(), Some("bytes 20-25/26"));
}

/// A range header that makes no sense is not worth refusing over - the
/// whole file is a correct answer to "give me this file".
#[test]
fn a_range_that_cannot_be_read_gets_the_whole_file() {
    let dir = tempfile::tempdir().unwrap();
    let (mut file, length) = alphabet(dir.path());

    let (bytes, content_range, status) = media_body(&mut file, length, Some("pages=1-2")).unwrap();

    assert_eq!(bytes.len(), 26);
    assert_eq!(content_range, None);
    assert_eq!(status, 200);
}

/// The ordinary case: nothing is in the way and the note moves.
#[test]
fn renames_a_note() {
    let dir = tempfile::tempdir().unwrap();
    let from = dir.path().join("note.md");
    let to = dir.path().join("renamed.md");
    fs::write(&from, "hello").unwrap();

    rename_no_replace(&from, &to).unwrap();

    assert!(!from.exists());
    assert_eq!(contents(&to), "hello");
}

/// The one this exists for. `fs::rename` replaces the destination without
/// a word on Unix, so a note that happened to be there would be gone - and
/// the `exists()` check that used to be the only guard cannot see anything
/// created after it ran.
#[test]
fn refuses_to_rename_over_a_note_that_is_already_there() {
    let dir = tempfile::tempdir().unwrap();
    let from = dir.path().join("note.md");
    let to = dir.path().join("taken.md");
    fs::write(&from, "mine").unwrap();
    fs::write(&to, "someone else's").unwrap();

    let error = rename_no_replace(&from, &to).unwrap_err();

    assert!(
        already_exists(&error),
        "expected AlreadyExists, got {error:?}"
    );
    // Both are still there, and neither has been touched.
    assert_eq!(contents(&from), "mine");
    assert_eq!(contents(&to), "someone else's");
}

/// A folder in the way counts too - that one loses a whole subtree.
#[test]
fn refuses_to_rename_over_a_folder_that_is_already_there() {
    let dir = tempfile::tempdir().unwrap();
    let from = dir.path().join("notes");
    let to = dir.path().join("taken");
    fs::create_dir(&from).unwrap();
    fs::create_dir(&to).unwrap();
    fs::write(to.join("kept.md"), "still here").unwrap();

    assert!(rename_no_replace(&from, &to).is_err());
    assert_eq!(contents(&to.join("kept.md")), "still here");
}

#[test]
fn a_dropped_file_keeps_its_name_when_nothing_is_using_it() {
    let dir = tempfile::tempdir().unwrap();

    let (_, path) = create_unused(dir.path(), "photo.png").unwrap();

    assert_eq!(path, dir.path().join("photo.png"));
    assert!(path.exists());
}

/// Two attachments with the same name land beside each other rather than
/// one on top of the other.
#[test]
fn a_dropped_file_is_numbered_rather_than_written_over() {
    let dir = tempfile::tempdir().unwrap();
    fs::write(dir.path().join("photo.png"), "the first one").unwrap();

    let (_, path) = create_unused(dir.path(), "photo.png").unwrap();
    assert_eq!(path, dir.path().join("photo 1.png"));

    let (_, next) = create_unused(dir.path(), "photo.png").unwrap();
    assert_eq!(next, dir.path().join("photo 2.png"));

    // And the one that was there is untouched.
    assert_eq!(contents(&dir.path().join("photo.png")), "the first one");
}

/// The file comes back open, because creating it and writing it are the
/// same act - anything else is another gap for someone to write into.
#[test]
fn a_dropped_file_comes_back_ready_to_write() {
    use std::io::Write;

    let dir = tempfile::tempdir().unwrap();
    let (mut file, path) = create_unused(dir.path(), "photo.png").unwrap();

    file.write_all(b"the bytes").unwrap();
    drop(file);

    assert_eq!(contents(&path), "the bytes");
}

/// A name with no extension is numbered on the end rather than in the
/// middle of nothing.
#[test]
fn a_dropped_file_with_no_extension_is_numbered_too() {
    let dir = tempfile::tempdir().unwrap();
    fs::write(dir.path().join("scan"), "first").unwrap();

    let (_, path) = create_unused(dir.path(), "scan").unwrap();

    assert_eq!(path, dir.path().join("scan 1"));
}

/// A recovery file is named after the note's path, and two paths can in
/// principle hash to the same name. The path is recorded inside the file
/// so that one which does is not handed back as the other's edits.
#[test]
fn a_recovery_knows_which_note_it_belongs_to() {
    let kept = Recovery {
        path: "/vault/note.md".to_string(),
        content: "what was typed".to_string(),
    };
    let json = serde_json::to_vec(&kept).unwrap();

    let read: Recovery = serde_json::from_slice(&json).unwrap();
    assert_eq!(read.path, "/vault/note.md");
    assert_eq!(read.content, "what was typed");
}

/// One name per note, and a different one for a different note.
#[test]
fn a_note_is_kept_under_a_name_of_its_own() {
    let dir = Path::new("/recovery");

    assert_eq!(
        recovery_file(dir, "/vault/note.md"),
        recovery_file(dir, "/vault/note.md")
    );
    assert_ne!(
        recovery_file(dir, "/vault/note.md"),
        recovery_file(dir, "/vault/other.md")
    );
    // A path is not a filename: what lands in the directory is one.
    let file = recovery_file(dir, "/vault/deep/note.md");
    assert_eq!(file.parent(), Some(dir));
    assert!(file.extension().is_some_and(|e| e == "json"));
}

/// Saving the scratch note somewhere by hand is consent for that file, and
/// for nothing else in the folder it landed in.
#[test]
fn allows_only_the_file_a_dialog_chose() {
    let dir = tempfile::tempdir().unwrap();
    let elsewhere = tempfile::tempdir().unwrap();
    let chosen = elsewhere.path().join("saved.md");
    let neighbour = elsewhere.path().join("neighbour.md");
    fs::write(&chosen, "hello").unwrap();
    fs::write(&neighbour, "hello").unwrap();

    let vault = opened(dir.path());
    locked(&vault.chosen).insert(chosen.canonicalize().unwrap());

    assert!(within_vault(&vault, &chosen).is_ok());
    assert!(within_vault(&vault, &neighbour).is_err());
}

/// A dropped file keeps the name it came with when there is nothing wrong
/// with it.
#[test]
fn leaves_an_ordinary_name_alone() {
    assert_eq!(safe_file_name("photo.png").unwrap(), "photo.png");
    assert_eq!(
        safe_file_name("Notes from 2026 (draft).md").unwrap(),
        "Notes from 2026 (draft).md"
    );
}

/// The name on a dropped file is whatever the sending app put there, and
/// only the last component of it is a name.
#[test]
fn tidies_a_dropped_name_into_one_component() {
    assert_eq!(safe_file_name("../../photo.png").unwrap(), "photo.png");
    assert_eq!(
        safe_file_name("C:\\Windows\\photo.png").unwrap(),
        "photo.png"
    );
    assert_eq!(safe_file_name(".hidden.png").unwrap(), "hidden.png");
}

/// `:` is an NTFS alternate data stream: bytes written to `note.md:hidden`
/// do not show up in the file tree, or in the file's own size.
#[test]
fn takes_the_stream_separator_out_of_a_dropped_name() {
    assert_eq!(safe_file_name("note.md:hidden").unwrap(), "note.mdhidden");
    assert_eq!(safe_file_name("what?.png").unwrap(), "what.png");
}

/// Win32 drops trailing dots and spaces on the way to disk, so a name that
/// ends in one is not the name that lands - and `unused_path` would then be
/// checking whether the wrong path is free.
#[test]
fn takes_trailing_dots_and_spaces_off_a_dropped_name() {
    assert_eq!(safe_file_name("report.").unwrap(), "report");
    assert_eq!(safe_file_name("report. . ").unwrap(), "report");
}

#[test]
fn refuses_a_dropped_name_with_nothing_usable_left() {
    assert!(safe_file_name("..").is_err());
    assert!(safe_file_name("/").is_err());
    assert!(safe_file_name("   ").is_err());
    assert!(safe_file_name(":?*").is_err());
}

/// Reserved whatever is put after them: Win32 reads the stem, so `aux.md`
/// is the printer port and not a note.
#[test]
fn refuses_a_reserved_device_name() {
    assert!(safe_file_name("aux.md").is_err());
    assert!(safe_file_name("CON").is_err());
    assert!(safe_file_name("lpt1.txt").is_err());
    assert!(safe_file_name("auxiliary.md").is_ok());
}

/// A typed name is taken exactly as typed, or refused. The row the sidebar
/// draws is built from what was typed, so a file quietly written under a
/// different name is one the tree cannot find again.
#[test]
fn takes_a_typed_name_only_as_it_was_typed() {
    assert_eq!(exact_file_name("note.md").unwrap(), "note.md");
    assert_eq!(exact_file_name("  note.md  ").unwrap(), "note.md");

    for typed in [
        "../../notes.md",
        "sub/note.md",
        ".hidden",
        "note.md:x",
        "report.",
        "aux.md",
    ] {
        assert!(exact_file_name(typed).is_err(), "{typed} should be refused");
    }
}

/// A vault with `root` open, a folder in it, and a note in the folder.
fn vault_with_a_folder() -> (tempfile::TempDir, Vault) {
    let dir = tempfile::tempdir().unwrap();
    fs::create_dir(dir.path().join("folder")).unwrap();
    fs::create_dir(dir.path().join("folder").join("inner")).unwrap();
    fs::write(dir.path().join("note.md"), "hello").unwrap();
    let vault = opened(dir.path());
    (dir, vault)
}

#[test]
fn moves_a_note_into_a_folder() {
    let (dir, vault) = vault_with_a_folder();

    let (old, new) = move_destination(
        &vault,
        dir.path().join("note.md").to_str().unwrap(),
        dir.path().join("folder").to_str().unwrap(),
    )
    .unwrap();

    assert_eq!(old, dir.path().canonicalize().unwrap().join("note.md"));
    assert_eq!(new.file_name().unwrap(), "note.md");
    assert!(new.starts_with(dir.path().canonicalize().unwrap().join("folder")));
}

/// The move that loses a subtree if it goes through.
#[test]
fn refuses_moving_a_folder_into_its_own_child() {
    let (dir, vault) = vault_with_a_folder();
    let folder = dir.path().join("folder");

    assert!(move_destination(
        &vault,
        folder.to_str().unwrap(),
        folder.join("inner").to_str().unwrap(),
    )
    .is_err());

    // The same move, spelled so that a textual comparison would let it
    // past: the target does not start with the folder as written.
    assert!(move_destination(
        &vault,
        folder.to_str().unwrap(),
        folder
            .join("..")
            .join("folder")
            .join("inner")
            .to_str()
            .unwrap(),
    )
    .is_err());
}

/// And through a symlink, which no amount of string comparison would catch.
#[cfg(unix)]
#[test]
fn refuses_moving_a_folder_into_itself_through_a_symlink() {
    let (dir, vault) = vault_with_a_folder();
    let folder = dir.path().join("folder");
    let link = dir.path().join("shortcut");
    std::os::unix::fs::symlink(folder.join("inner"), &link).unwrap();

    assert!(move_destination(&vault, folder.to_str().unwrap(), link.to_str().unwrap()).is_err());
}

/// Dropping a note onto a file rather than a folder says so, instead of
/// handing the OS a path with a file in the middle of it.
#[test]
fn refuses_moving_into_something_that_is_not_a_folder() {
    let (dir, vault) = vault_with_a_folder();
    let other = dir.path().join("other.md");
    fs::write(&other, "hello").unwrap();

    assert!(move_destination(
        &vault,
        dir.path().join("note.md").to_str().unwrap(),
        other.to_str().unwrap(),
    )
    .is_err());
}

/// The names in a listing, folders marked with a trailing slash.
fn names(entries: &[FileEntry]) -> Vec<String> {
    entries
        .iter()
        .map(|entry| {
            if entry.is_directory {
                format!("{}/", entry.name)
            } else {
                entry.name.clone()
            }
        })
        .collect()
}

#[test]
fn reads_folders_first_then_by_name() {
    let dir = tempfile::tempdir().unwrap();
    fs::write(dir.path().join("b.md"), "").unwrap();
    fs::write(dir.path().join("A.md"), "").unwrap();
    fs::create_dir(dir.path().join("notes")).unwrap();
    fs::write(dir.path().join("notes").join("inner.md"), "").unwrap();
    fs::create_dir(dir.path().join(".git")).unwrap();

    let tree = read_dir_recursive(dir.path()).unwrap();
    assert_eq!(names(&tree), ["notes/", "A.md", "b.md"]);
    assert_eq!(names(tree[0].children.as_ref().unwrap()), ["inner.md"]);
    assert!(tree[1].children.is_none());
    // Every platform records when a file was last written.
    assert!(tree.iter().all(|entry| entry.modified.is_some()));
}

/// Past the depth cap a folder is listed, with nothing read inside it.
#[test]
fn stops_reading_at_the_depth_cap() {
    let dir = tempfile::tempdir().unwrap();
    let mut deepest = dir.path().to_path_buf();
    for _ in 0..MAX_TREE_DEPTH + 2 {
        deepest.push("d");
    }
    fs::create_dir_all(&deepest).unwrap();

    let tree = read_dir_recursive(dir.path()).unwrap();
    let mut level: &[FileEntry] = &tree;
    let mut depth = 1;
    while let Some(children) = level.first().and_then(|entry| entry.children.as_deref()) {
        if children.is_empty() {
            break;
        }
        level = children;
        depth += 1;
    }
    assert_eq!(depth, MAX_TREE_DEPTH);
}

/// `ln -s . loop` used to be walked until the stack overflowed.
#[cfg(unix)]
#[test]
fn leaves_out_a_link_back_up_the_tree() {
    let dir = tempfile::tempdir().unwrap();
    fs::create_dir(dir.path().join("notes")).unwrap();
    fs::write(dir.path().join("notes").join("a.md"), "").unwrap();
    std::os::unix::fs::symlink(dir.path(), dir.path().join("notes").join("up")).unwrap();
    std::os::unix::fs::symlink(".", dir.path().join("loop")).unwrap();

    let tree = read_dir_recursive(dir.path()).unwrap();
    assert_eq!(names(&tree), ["notes/"]);
    assert_eq!(names(tree[0].children.as_ref().unwrap()), ["a.md"]);
}

/// Nothing through a link out of the vault could be opened, so it is not listed.
#[cfg(unix)]
#[test]
fn leaves_out_a_link_to_a_folder_outside_the_vault() {
    let dir = tempfile::tempdir().unwrap();
    let elsewhere = tempfile::tempdir().unwrap();
    fs::write(elsewhere.path().join("secret.md"), "").unwrap();
    std::os::unix::fs::symlink(elsewhere.path(), dir.path().join("out")).unwrap();

    assert!(read_dir_recursive(dir.path()).unwrap().is_empty());
}

#[cfg(unix)]
#[test]
fn follows_a_link_to_another_folder_in_the_vault() {
    let dir = tempfile::tempdir().unwrap();
    fs::create_dir(dir.path().join("real")).unwrap();
    fs::write(dir.path().join("real").join("a.md"), "").unwrap();
    std::os::unix::fs::symlink(dir.path().join("real"), dir.path().join("alias")).unwrap();
    fs::write(dir.path().join("note.md"), "").unwrap();
    std::os::unix::fs::symlink(dir.path().join("note.md"), dir.path().join("linked.md")).unwrap();
    std::os::unix::fs::symlink(dir.path().join("gone"), dir.path().join("broken.md")).unwrap();

    let tree = read_dir_recursive(dir.path()).unwrap();
    assert_eq!(
        names(&tree),
        ["alias/", "real/", "broken.md", "linked.md", "note.md"]
    );
    assert_eq!(names(tree[0].children.as_ref().unwrap()), ["a.md"]);
}

#[test]
fn reads_a_percent_encoded_header() {
    let mut headers = tauri::http::HeaderMap::new();
    headers.insert(
        "x-nuza-name",
        "Screen%20Shot%20%E2%9C%93.png".parse().unwrap(),
    );
    assert_eq!(
        header_text(&headers, "x-nuza-name").unwrap(),
        "Screen Shot \u{2713}.png"
    );
    assert!(header_text(&headers, "x-nuza-directory").is_err());
}

#[test]
fn reads_a_body_sent_raw_or_as_json() {
    let raw = tauri::ipc::InvokeBody::Raw(vec![0, 1, 255]);
    assert_eq!(body_bytes(&raw).unwrap(), [0, 1, 255]);

    let json = tauri::ipc::InvokeBody::Json(serde_json::json!([0, 1, 255]));
    assert_eq!(body_bytes(&json).unwrap(), [0, 1, 255]);

    let wrong = tauri::ipc::InvokeBody::Json(serde_json::json!({ "data": "AAH/" }));
    assert!(body_bytes(&wrong).is_err());
}

fn folded(query: &str) -> Vec<char> {
    query.chars().map(fold).collect()
}

#[test]
fn finds_a_line_ignoring_case() {
    let hits = search_text("n.md", "first\nSecond Line here\nthird", &folded("line"), 5);
    assert_eq!(
        hits,
        [ContentHit {
            path: "n.md".into(),
            line: 2,
            column: 7,
            preview: "Second Line here".into(),
            preview_start: 7,
            match_length: 4,
        }]
    );
}

#[test]
fn counts_columns_in_utf16() {
    // The emoji is two UTF-16 units, as it is to CodeMirror.
    let hits = search_text("n.md", "\u{1F600} caf\u{e9} ok", &folded("OK"), 5);
    assert_eq!(hits[0].column, 8);
    assert_eq!(hits[0].preview_start, 8);
}

#[test]
fn cuts_a_long_line_down_around_the_match() {
    let line = format!("{}needle{}", "a".repeat(200), "b".repeat(200));
    let hit = &search_text("n.md", &line, &folded("needle"), 5)[0];
    assert!(hit.preview.starts_with('\u{2026}') && hit.preview.ends_with('\u{2026}'));
    let start = hit.preview_start;
    let shown: String = hit.preview.chars().skip(start).take(6).collect();
    assert_eq!(shown, "needle");
    assert_eq!(hit.column, 200);
}

#[test]
fn stops_at_the_limit() {
    let text = "x\n".repeat(10);
    assert_eq!(search_text("n.md", &text, &folded("x"), 3).len(), 3);
}

#[test]
fn searches_only_the_notes_the_tree_lists() {
    let dir = tempfile::tempdir().unwrap();
    fs::create_dir(dir.path().join("sub")).unwrap();
    fs::create_dir(dir.path().join(".obsidian")).unwrap();
    fs::write(dir.path().join("a.md"), "has the Word").unwrap();
    fs::write(dir.path().join("sub").join("b.MD"), "word again").unwrap();
    fs::write(dir.path().join("c.txt"), "word in a text file").unwrap();
    fs::write(dir.path().join(".obsidian").join("d.md"), "word hidden").unwrap();

    let hits = search_vault(dir.path(), "  WORD ").unwrap();
    let mut found: Vec<&str> = hits
        .iter()
        .map(|hit| Path::new(&hit.path).file_name().unwrap().to_str().unwrap())
        .collect();
    found.sort();
    assert_eq!(found, ["a.md", "b.MD"]);
    assert!(search_vault(dir.path(), "   ").unwrap().is_empty());
}

#[test]
fn duplicates_a_note_beside_itself_numbered() {
    let dir = tempfile::tempdir().unwrap();
    let note = dir.path().join("note.md");
    fs::write(&note, "hello").unwrap();

    let first = duplicate_file(&note).unwrap();
    let second = duplicate_file(&note).unwrap();

    assert_eq!(first, dir.path().join("note 1.md"));
    assert_eq!(second, dir.path().join("note 2.md"));
    assert_eq!(contents(&first), "hello");
    assert_eq!(contents(&note), "hello");
}

#[test]
fn refuses_to_duplicate_a_folder() {
    let dir = tempfile::tempdir().unwrap();
    assert!(duplicate_file(dir.path()).is_err());
}

#[cfg(unix)]
#[test]
fn a_duplicate_keeps_the_originals_permissions() {
    use std::os::unix::fs::PermissionsExt;
    let dir = tempfile::tempdir().unwrap();
    let note = dir.path().join("private.md");
    fs::write(&note, "x").unwrap();
    fs::set_permissions(&note, fs::Permissions::from_mode(0o600)).unwrap();

    let copy = duplicate_file(&note).unwrap();
    assert_eq!(
        fs::metadata(copy).unwrap().permissions().mode() & 0o777,
        0o600
    );
}

/// Whatever fonts the machine running this has - CI's may have few - the
/// list is sorted, has no repeats and no private dotted families.
#[test]
fn lists_font_families_sorted_and_public() {
    let families = system_font_families();
    let mut sorted = families.clone();
    sorted.sort_by_key(|name| name.to_lowercase());
    sorted.dedup();
    assert_eq!(families, sorted);
    assert!(families.iter().all(|name| !name.starts_with('.')));
}

#[test]
fn finds_wiki_links_outside_code() {
    let text = "see [[Ideas]] and [[a/b|label]]\n```\n[[not this]]\n```\n[[]] [[x] [[last]]";
    let links = wiki_links_in("n.md", text);
    let found: Vec<(&str, usize)> = links.iter().map(|l| (l.target.as_str(), l.line)).collect();
    assert_eq!(found, [("Ideas", 1), ("a/b|label", 1), ("last", 5)]);
    assert_eq!(links[0].preview, "see [[Ideas]] and [[a/b|label]]");
}

#[test]
fn lists_the_wiki_links_in_a_vault() {
    let dir = tempfile::tempdir().unwrap();
    fs::write(dir.path().join("a.md"), "to [[b]]").unwrap();
    fs::create_dir(dir.path().join(".hidden")).unwrap();
    fs::write(dir.path().join(".hidden").join("c.md"), "to [[b]]").unwrap();
    fs::write(dir.path().join("d.txt"), "to [[b]]").unwrap();

    let links = vault_wiki_links(dir.path()).unwrap();
    assert_eq!(links.len(), 1);
    assert!(links[0].from.ends_with("a.md"));
}

#[test]
fn lists_the_tags_in_the_notes_a_vault_shows() {
    let dir = tempfile::tempdir().unwrap();
    fs::write(dir.path().join("a.md"), "one #alpha\ntwo #beta").unwrap();
    fs::create_dir(dir.path().join(".hidden")).unwrap();
    fs::write(dir.path().join(".hidden").join("c.md"), "#hidden").unwrap();
    fs::write(dir.path().join("d.txt"), "#text").unwrap();

    let tags = scan_vault(dir.path(), crate::tags::tags_in).unwrap();
    assert_eq!(
        tags.iter()
            .map(|t| (t.tag.as_str(), t.line))
            .collect::<Vec<_>>(),
        [("alpha", 1), ("beta", 2)]
    );
    assert!(tags[0].from.ends_with("a.md"));
}

/// Two real windows, with no screen behind them: the label a command is called
/// from is what picks the vault.
mod windows {
    use super::*;
    use crate::folder::adopt_folder;
    use crate::launch::FILE_CHANGED_EVENT;
    use crate::state::vault_of;
    use std::sync::mpsc;
    use std::time::Duration;
    use tauri::test::{mock_builder, mock_context, noop_assets, MockRuntime};
    use tauri::{Listener, WebviewUrl, WebviewWindow, WebviewWindowBuilder};

    fn two_windows() -> (
        tauri::App<MockRuntime>,
        WebviewWindow<MockRuntime>,
        WebviewWindow<MockRuntime>,
    ) {
        let app = mock_builder()
            .manage(Windows::default())
            .build(mock_context(noop_assets()))
            .unwrap();
        let first = WebviewWindowBuilder::new(&app, "main", WebviewUrl::default())
            .build()
            .unwrap();
        let second = WebviewWindowBuilder::new(&app, "w-1", WebviewUrl::default())
            .build()
            .unwrap();
        (app, first, second)
    }

    #[test]
    fn opening_a_folder_in_one_window_leaves_the_other_alone() {
        let (_app, first, second) = two_windows();
        let first_dir = tempfile::tempdir().unwrap();
        let second_dir = tempfile::tempdir().unwrap();
        let first_note = first_dir.path().join("note.md");
        let second_note = second_dir.path().join("note.md");
        fs::write(&first_note, "one").unwrap();
        fs::write(&second_note, "two").unwrap();

        // The second window has nothing yet, while the first has its folder.
        adopt_folder(&first, first_dir.path().to_string_lossy().into_owned()).unwrap();
        assert!(within_vault(&vault_of(&first), &first_note).is_ok());
        assert!(within_vault(&vault_of(&second), &first_note).is_err());

        // Opening a folder in the second does not move the first.
        adopt_folder(&second, second_dir.path().to_string_lossy().into_owned()).unwrap();
        assert!(within_vault(&vault_of(&second), &second_note).is_ok());
        assert!(within_vault(&vault_of(&first), &first_note).is_ok());
        assert!(within_vault(&vault_of(&first), &second_note).is_err());
    }

    /// Both windows watch the same folder, but only the one that has read the
    /// note is told it changed - and it is told alone.
    #[test]
    fn a_change_is_announced_to_the_window_that_holds_the_note() {
        let (_app, first, second) = two_windows();
        let dir = tempfile::tempdir().unwrap();
        let note = dir.path().join("note.md");
        fs::write(&note, "hello").unwrap();
        let folder = dir.path().to_string_lossy().into_owned();
        adopt_folder(&first, folder.clone()).unwrap();
        adopt_folder(&second, folder).unwrap();

        let (heard_first, first_hears) = mpsc::channel();
        let (heard_second, second_hears) = mpsc::channel();
        first.listen(FILE_CHANGED_EVENT, move |_| {
            let _ = heard_first.send(());
        });
        second.listen(FILE_CHANGED_EVENT, move |_| {
            let _ = heard_second.send(());
        });

        let note = note.canonicalize().unwrap();
        remember(&vault_of(&first), &note);
        let later = SystemTime::now() + Duration::from_secs(5);
        fs::File::options()
            .write(true)
            .open(&note)
            .unwrap()
            .set_modified(later)
            .unwrap();

        assert!(first_hears.recv_timeout(Duration::from_secs(10)).is_ok());
        assert!(second_hears
            .recv_timeout(Duration::from_millis(500))
            .is_err());
    }
}
