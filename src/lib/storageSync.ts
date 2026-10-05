/**
 * Settings shared between windows.
 *
 * Every window of the app is its own webview with its own React tree, but they
 * share one `localStorage`: a setting changed in one window is written where
 * the others can see it, and the browser says so to every window but the one
 * that wrote it, in a `storage` event. This reads such an event.
 */

/** The parts of a `StorageEvent` this needs, so it can be tried without a browser. */
export interface StorageChange {
  key: string | null;
  newValue: string | null;
  /** Whether the change was to `localStorage`, and not `sessionStorage`. */
  local: boolean;
}

/**
 * The value another window has stored under `key`, if `change` is that and it
 * is not what this window already holds. `undefined` otherwise - not `null`,
 * which a stored value can be.
 *
 * "What this window already holds" is compared as stored text, so a value that
 * was only ever echoed back to the window that wrote it does nothing.
 */
export function valueFromChange<T>(change: StorageChange, key: string, current: T): { value: T } | undefined {
  if (!change.local || change.key !== key || change.newValue === null) return undefined;
  if (change.newValue === JSON.stringify(current)) return undefined;

  try {
    return { value: JSON.parse(change.newValue) as T };
  } catch {
    // Not something this window wrote, and not something worth stopping for.
    return undefined;
  }
}

/** A browser's `StorageEvent`, as the part of it that matters here. */
export function changeFrom(event: StorageEvent): StorageChange {
  return { key: event.key, newValue: event.newValue, local: event.storageArea === localStorage };
}
