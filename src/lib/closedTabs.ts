/** A tab that was closed, and where it sat in the strip. */
export interface ClosedTab {
  path: string;
  index: number;
}

/** How many closed tabs are remembered - enough to undo a burst of closing. */
export const CLOSED_TAB_LIMIT = 20;

/**
 * The stack with `tab` on top. A note closed twice is remembered once, at the
 * most recent place it was closed from.
 */
export function rememberClosed(stack: readonly ClosedTab[], tab: ClosedTab, limit = CLOSED_TAB_LIMIT) {
  return [...stack.filter((closed) => closed.path !== tab.path), tab].slice(-limit);
}

/**
 * The tab strip with `path` moved to `index`, clamped to the strip - so a note
 * reopened comes back where it was rather than at the end. Unchanged when
 * `path` is not in the strip, which is what a reopen that failed leaves.
 */
export function placeAt(paths: string[], path: string, index: number): string[] {
  if (!paths.includes(path)) return paths;
  const rest = paths.filter((p) => p !== path);
  const at = Math.min(Math.max(index, 0), rest.length);
  return [...rest.slice(0, at), path, ...rest.slice(at)];
}
