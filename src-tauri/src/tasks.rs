/// Tauri's dialog pickers deliver their result through a callback fired from
/// another thread, but a `#[tauri::command]` has to return a value. This waits
/// for that callback without holding on to anything while it does.
///
/// It used to be a blocking `recv()`, inside an `async fn`, which meant a
/// worker of the async runtime was parked for exactly as long as the dialog
/// was on screen - and a file dialog is open for as long as somebody takes to
/// find a folder, which can be minutes. The runtime has a handful of those
/// workers and every other command needs one.
///
/// Awaiting a oneshot instead, the task is put aside until the answer comes
/// and the thread goes back to doing something useful.
pub(crate) async fn wait_for_picker<T, F>(register: F) -> Result<T, String>
where
    T: Send + 'static,
    F: FnOnce(Box<dyn FnOnce(Result<T, String>) + Send>),
{
    let (tx, rx) = tokio::sync::oneshot::channel();
    register(Box::new(move |result| {
        // Nothing to do if the other end has gone: the command was dropped,
        // and there is nobody left to tell.
        let _ = tx.send(result);
    }));

    rx.await
        .map_err(|_| "The dialog closed without saying anything".to_string())?
}

/// Runs `work` somewhere that is not the thread pumping the window.
///
/// A `#[tauri::command]` declared `fn` rather than `async fn` is called on the
/// main thread, which is also the thread running the event loop: while it is
/// reading a note, the window is not drawing, resizing or listening to the
/// keyboard. Every command below does filesystem work whose cost is the size
/// of what it is working on - a vault walked at startup, a note read on a tab
/// switch, an attachment decoded and written - so each of them was a stall the
/// length of that work, several times a minute in the case of autosave.
///
/// Declaring them `async` hands them to the async runtime; this then hands the
/// blocking part to a thread that is allowed to block. The state they need is
/// reached through the `AppHandle` rather than taken as a `State<'_, Vault>`,
/// because that borrow cannot cross onto another thread.
///
/// One thing does change with them: commands no longer run one after another
/// in the order they arrived. Nothing here relies on that - a note is written
/// atomically and the frontend debounces per path - but two writes to the same
/// note now finish in whichever order the OS gets to them rather than in call
/// order.
pub(crate) async fn off_thread<T, F>(work: F) -> Result<T, String>
where
    T: Send + 'static,
    F: FnOnce() -> Result<T, String> + Send + 'static,
{
    tauri::async_runtime::spawn_blocking(work)
        .await
        .map_err(|e| e.to_string())?
}
