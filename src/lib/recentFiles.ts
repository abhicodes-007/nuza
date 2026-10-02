/**
 * The notes opened most recently, newest first, kept across restarts and
 * across vaults.
 *
 * The session restores the tabs that were open; this is for what was closed
 * since, or what sat in another vault - "what was I just working on" rather
 * than "what was open". Only paths are kept, and nothing here checks that
 * they still exist: a file that has been moved or deleted simply fails to
 * match anything in the tree when the list is shown.
 */

/** How many notes are remembered. */
export const RECENT_LIMIT = 30;

/** Storage is a file anyone can edit, so what comes back is checked. */
export function readRecent(stored: unknown): string[] {
  if (!Array.isArray(stored)) return [];
  const paths = stored.filter((path): path is string => typeof path === "string" && !!path);
  return [...new Set(paths)].slice(0, RECENT_LIMIT);
}

/** `path` moved to the front of `list`, and the oldest dropped past the limit. */
export function recordRecent(list: string[], path: string, limit = RECENT_LIMIT): string[] {
  if (!path) return list;
  return [path, ...list.filter((other) => other !== path)].slice(0, limit);
}
