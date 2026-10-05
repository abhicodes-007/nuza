import { Event, UnlistenFn } from "@tauri-apps/api/event";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";

/**
 * Listens for an event the backend sent to this window - and to no other.
 *
 * `listen` from `@tauri-apps/api/event` registers for any target, and a
 * listener for any target is handed every event of that name whoever it was
 * addressed to: with two windows open, a file-changed notice for one, or the
 * folder `nuza <path>` asked for, would be acted on by both. A listener on the
 * window itself hears what was sent to its label, and what was sent to
 * everyone, and nothing else.
 */
export function listenHere<T>(event: string, handler: (event: Event<T>) => void): Promise<UnlistenFn> {
  return getCurrentWebviewWindow().listen<T>(event, handler);
}
