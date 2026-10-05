/**
 * Keeps the webview's own browser behaviour out of the app.
 *
 * nuza is a desktop app that happens to be drawn by a web view, and it should
 * not feel like one: a right click that offers "Reload" and "Inspect Element"
 * is a browser, and a reload throws away everything on the page that has not
 * been written to disk yet - the open tabs' unsaved text among it.
 *
 * Everything here only ever cancels the default. It never stops an event
 * travelling, so the app's own shortcuts - which listen first, in the capture
 * phase - and the editor's - Vim's Ctrl+R, redo, among them - run as they did.
 */

/** The parts of a key event that decide whether it is a browser shortcut. */
interface KeyLike {
  key: string;
  code: string;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
}

/** `KeyR` and `r` both say R: `code` for the letter's place, `key` as the fallback. */
function letter(event: KeyLike) {
  return event.code.startsWith("Key") ? event.code.slice(3).toLowerCase() : event.key.toLowerCase();
}

/**
 * Whether a key press is the browser's way of reloading the page or opening
 * its developer tools: F5, F12, Ctrl or Cmd with R, Ctrl+Shift or Cmd+Alt
 * with I, J or C.
 *
 * Ctrl+Shift+I and the like need their extra modifiers, so Cmd+I - italic in
 * every editor - is not caught, and Ctrl+R is: Vim handles it before it gets
 * here, and what is left is the page reloading.
 */
export function isReloadOrInspectShortcut(event: KeyLike) {
  if (event.key === "F5" || event.key === "F12") return true;

  const key = letter(event);
  if ((event.ctrlKey || event.metaKey) && key === "r") return true;
  if ("ijc".includes(key) && key.length === 1) {
    return (event.ctrlKey && event.shiftKey) || (event.metaKey && event.altKey);
  }
  return false;
}

/**
 * Turns off the native right-click menu, and - in a build that is shipped, not
 * one being worked on - the shortcuts that reload the page or open the
 * inspector. A menu the app draws itself has already cancelled the event by
 * the time it gets here, and is not touched.
 *
 * In development the shortcuts are left alone, so the inspector is still one
 * keypress away for whoever is building the app; the right-click menu is not,
 * so it can be seen to be gone.
 */
export function installWebviewLockdown(target: EventTarget = window, shipped = import.meta.env.PROD) {
  const onContextMenu = (event: Event) => {
    if (!event.defaultPrevented) event.preventDefault();
  };
  const onKeyDown = (event: Event) => {
    if (isReloadOrInspectShortcut(event as unknown as KeyLike)) event.preventDefault();
  };

  target.addEventListener("contextmenu", onContextMenu);
  if (shipped) target.addEventListener("keydown", onKeyDown);

  return () => {
    target.removeEventListener("contextmenu", onContextMenu);
    target.removeEventListener("keydown", onKeyDown);
  };
}
