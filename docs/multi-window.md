# Multi-window design

Tracks [#148](https://github.com/puang59/nuza/issues/148). Status: design, nothing built yet.

## What it is for

- One vault open per window, so two vaults can sit on two monitors.
- A second window on the same machine without a second process.
- Later: a note popped out of the window it is in.

## Goals

- `File > New Window` (`Cmd/Ctrl+Shift+N`) opens a window on the welcome screen.
- Each window owns its vault, tabs, sidebar, search and watcher. Closing one leaves the others alone.
- `nuza <path>` goes to the window that already has that vault, or opens a new one. It never starts a second process.
- Quitting saves every window; relaunching brings the windows back.
- No new dependency and no growth in the bundle: this is plumbing, and the app stays well under 10MB.

## Non-goals (v1)

- Tab tear-off, cross-window drag and drop.
- Live syncing of tabs between windows. The disk is the shared state.
- The same vault in two windows. It is focused, not duplicated (see below).

## Where one-window assumptions live today

Found by reading the code, not guessed:

| Assumption                                                                                                           | Where                                                               | What breaks with two windows                                               |
| -------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| One global `Vault` (root, chosen files, `known` mtimes, watcher)                                                     | `state.rs`, read through `app_handle.state::<Vault>()` at ~17 sites | A second window's `open_folder` re-roots the first one's filesystem access |
| `LaunchTarget` is one slot                                                                                           | `state.rs`, `launch.rs`                                             | Only one window can be started on a path                                   |
| Events are `app.emit(...)` to everyone                                                                               | `watcher.rs`, `lib.rs` (open-target, close-tab, quit)               | Window A's file change, `Cmd+W` and quit all land in window B too          |
| Closing a window runs `exit(0)`                                                                                      | `useSaveOnExit.ts`                                                  | Closing any window kills the app                                           |
| Media protocol reads the one `Vault`                                                                                 | `media.rs`, `serve_media`                                           | Images resolve against the wrong root                                      |
| Capability is `windows: ["main"]`                                                                                    | `capabilities/default.json`                                         | A second window has no permissions at all                                  |
| Window set-up (transparency, traffic lights) is applied to `main` only                                               | `lib.rs` setup                                                      | A second window paints opaque                                              |
| Settings, session, vault list and scratch note live in one `localStorage`, shared by every window of the same origin | `usePersistedState.ts`, `session.ts`, `scratch.ts`                  | See "Frontend" below                                                       |

## Design

### Rust: a vault per window

Replace the single managed `Vault` with a map from window label to vault:

```rust
pub(crate) struct Windows(Mutex<HashMap<String, Arc<Vault>>>);
```

`Vault` itself stays as it is: it is already exactly the per-window state (root, chosen files, `known`, watcher). That keeps the diff mechanical and keeps every security property in `state.rs` (`within_vault` and friends) untouched.

- A helper `vault_for(&WebviewWindow) -> Arc<Vault>` creates the entry on first use. Commands take `window: tauri::WebviewWindow` (Tauri injects the caller) and replace `app_handle.state::<Vault>()` with it.
- `serve_media` gets the label from the URI scheme context (`context.webview_label()`), so each window's images resolve against its own root.
- The watcher is per window and emits with `emit_to(&label, ...)`. Two windows on two vaults never hear each other.
- On `WindowEvent::Destroyed` the entry is removed, which drops the watcher.
- A window that has not opened a folder has `root = None`, so every filesystem command refuses, exactly as today.

### Creating windows

- Label: `main` for the first, `w-<uuid>` for the rest.
- Built with `WebviewWindowBuilder` from the same settings as `tauri.conf.json` (overlay title bar, traffic lights, transparent, `dragDropEnabled: false`), then through the existing `apply_transparency`. This lives in one function, `window::open_window(app, target)`, so the config is not duplicated.
- Capability becomes `windows: ["main", "w-*"]` (globs are supported).
- `LaunchTarget` becomes `HashMap<label, OpenTarget>`. `open_window` queues the target for the new label; `take_launch_target` reads the caller's own entry. Same one-shot behaviour as today, per window.
- New windows are cascaded (offset from the focused one) so they do not stack exactly.

### Opening paths: `nuza <path>`, Finder, the dock

One resolver decides, for any incoming target:

1. Find a window whose vault root contains the path (or equals the folder). If there is one: focus it and `emit_to` it an `open-target`.
2. Otherwise open a new window with the target queued.
3. No path (plain `nuza` or a dock click): focus the most recently focused window.

Cold start is unchanged: the target is queued for `main`.

### Same vault in two windows

Not duplicated in v1; step 1 above focuses the existing window. Two windows holding one vault would mean two watchers on one tree and two autosave timers racing on one note.

It still has to be safe when it happens anyway (a note opened from a different vault's window, or a folder reached through a symlink). That case is already handled by the existing conflict path: each window has its own `known` mtimes, so the other window's save shows up as "changed on disk" there, and `write_file` refuses a write whose file moved on. No new mechanism is needed, which is the main reason `Vault` stays per window rather than becoming shared.

### Events

| Event            | Today        | After                            |
| ---------------- | ------------ | -------------------------------- |
| `file-changed`   | `emit` (all) | `emit_to` the owning window      |
| `open-target`    | `emit` (all) | `emit_to` the chosen window      |
| `menu:close-tab` | `emit` (all) | `emit_to` the focused window     |
| `menu:quit`      | `emit` (all) | all windows, with an ack (below) |

### Close and quit

Today both `onCloseRequested` and the quit item end in `exit(0)`. Split them:

- **Close a window:** save that window, flush its settings, then `window.destroy()`. The process exits when the last window is gone; whether macOS should instead stay in the dock with no window is an open question below.
- **Quit (`Cmd+Q`):** Rust emits `menu:quit` to every window and counts `window_ready_to_quit` calls back from them. Each window saves, then acks. When all have acked, or after a short timeout, Rust calls `exit`. A window that hangs cannot block quitting.

### Frontend

Each window is its own webview with its own JS context and React tree, so module-level state (`documentCache`, `closedTabs`, recent files, the open tabs) is per window with no work. The shared thing is `localStorage`:

- **Settings** (`usePersistedState`) are read once at mount. Add a `storage` event listener so a change in one window (Vim mode, font, theme) applies live in the others. `storage` events fire only in the other windows, which is what is wanted.
- **Sessions** (`session.ts`) keep one JSON object for every vault, behind an in-memory `cache` that assumes this module is the only writer. With two windows each cache goes stale and the second write erases the first's vault. Fix: re-read storage before each write and replace only that vault's entry.
- **Vault list** (`useVaults`): same read-modify-write fix.
- **Scratch note** (`nuza:scratch`) is a single buffer. Open question below.
- **Window restore:** at quit, write the list of open vault roots (plus window frames) to one key. On cold start `main` takes the first and the rest are opened with `open_window`. Per-vault tabs already restore from the session store.

### Menus

The macOS menu is app-wide, so `Window` menu entries listing open windows, and `New Window`, are added once. `Close Tab` and `Quit` already route through custom items; only their targets change.

## Rollout

Each step is its own PR, and each leaves the app working with one window.

1. **Per-window vault (Rust only).** `Windows` map, commands take the calling window, `emit_to`, media label lookup, `Destroyed` cleanup. One window exists, so nothing is visible. Unit tests for the map, and for two vaults not seeing each other's paths or events.
2. **Open a window.** `open_window`, capability glob, per-label launch targets, `New Window` command and shortcut, window set-up on every window, focus-existing resolver, single-instance routing.
3. **Close and quit.** Per-window close, quit coordination with acks, per-window `close-tab`.
4. **Frontend sharing.** `storage` listener for settings, session and vault list read-modify-write, scratch decision.
5. **Restore windows** at launch, and the macOS `Window` menu.
6. _(Later)_ pop a note out into its own window.

## Testing

- Rust: the window map, label routing, the open-target resolver (pure function: roots + target in, "focus label" or "new window" out), and quit-ack counting (pure counter with a timeout).
- Frontend: session and vault-list merging with a stale cache, `storage`-driven settings.
- Manual, in the test vault (not the real notes): two windows on two vaults; edit the same file from two windows and check the changed-on-disk path; close one and confirm the other keeps saving; `nuza <path>` from a terminal with the app open; quit with unsaved edits in both.

## Open questions

- **Scratch note.** Keep it shared (last writer wins), key it by window, or give it to `main` only? Leaning: `main` only, other windows start empty.
- **Close behaviour on macOS** with zero windows: quit, or stay in the dock as today? Needs checking against the current behaviour before step 3.
- **Duplicate-vault policy.** Focus-existing is simple; some people want one vault in two windows to compare notes. Split view (a second note beside the first) already covers that.
- **Watcher cost.** One watcher per window is simplest; if many windows open the same large vault it could be shared behind a refcount. Not worth building until it is seen to matter.
