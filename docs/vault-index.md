# The vault index, lazy folders and search

Covers [#27](https://github.com/puang59/nuza/issues/27), [#147](https://github.com/puang59/nuza/issues/147) and [#154](https://github.com/puang59/nuza/issues/154), which turned out to be one piece of work: how the app learns what is in a vault.

## The sidebar reads a folder at a time

Opening a vault reads only its top level (`folder::adopt_folder`). A folder in the tree has no `children` until it is opened; the sidebar then asks `list_folder` for what is directly inside it. A very large vault opens as fast as a small one, and nothing about a folder crosses the bridge until someone asks to see it.

A folder with no `children` is _unread_, which is not the same as one with `children: []`. The tree edits in `lib/fileTree.ts` leave an unread folder alone: a note created under it is not invented into a `children` list that would make it look read.

Symlinks: a link to a folder is followed only when it lands inside the vault and does not lead back to a folder the walk is already in. `ln -s . loop` is not listed. There is a depth cap of 64 as a second line of defence.

## One slow file does not stall a folder

On iCloud Drive, Dropbox or an SMB share a single `stat` can block for as long as the provider takes, or for good on an offline placeholder. Nothing in `std::fs` can be told to give up, so these calls run on a small pool (`slow.rs`) and the caller waits only until a deadline:

- `PATIENCE.entry` (1.5s): counted from when a folder's `stat`s were all asked for, so a folder of offline files costs one wait and not one each. An entry that has not answered is listed with `unavailable: true` and shown with a cloud-off icon. It is asked again the next time its folder is opened.
- `PATIENCE.listing` (8s): for reading a folder's names at all. A folder that does not answer is an error shown on its row.

A call that never returns holds its thread, so the pool is topped back up (to a cap of 48) with fresh threads, and shrinks again when the stuck calls come back. Calls that were still queued when the caller gave up are dropped, not run for nobody.

## The index

`index.rs` keeps, per window, every file in the vault and the text of its notes.

- It is built once when a folder is opened, on its own thread. A request made while it is being built waits up to ten seconds and then answers from what there is.
- A note's text is read the first time something asks for it (the content search, tags, backlinks) and kept until the note changes. A vault that is never searched never has its notes read, which matters on a cloud-synced vault, where reading a file can download it.
- It is patched from the filesystem watcher, and directly by the app's own writes (`search::note_changes`), so it is right even for a folder that could not be watched. A watcher that reports it lost count triggers a rescan.
- Paths in the index are spelled the way the folder was opened, which is how the sidebar spells them, not the way the watcher does.
- Text is kept up to 256 MiB; past that notes are read again each time rather than held.

The sidebar's quick-open, wiki-link resolution and the tags and backlinks panels read the whole-vault file list from the index (`list_files`, through `hooks/useFileIndex.ts`), not from the part of the tree that has been opened.

## Content search

The match is still a case-insensitive substring, because a fuzzy subsequence over whole lines matches almost every line in a vault. What is fuzzy-ranked, the way file names are, is the order: a match that starts a word, is the whole word, is in the case typed, is in a heading, comes early, is in a short line, or is in a note whose name holds the query outranks one buried mid-word in a long paragraph. Each note contributes its best five lines rather than its first five.

The regular-expression toggle beside the search box uses the `regex` crate, which matches in time linear in the line, so no pattern can hang the app. A pattern over 500 characters or one that does not compile is refused with a message in the results.
