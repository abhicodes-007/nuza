/**
 * How many closed notes keep their editor state once nothing else needs them.
 *
 * Closing a tab keeps the note's state, so reopening it comes back with its
 * caret and undo history rather than a fresh read. Kept for every note ever
 * opened, that is the full text and the undo history of each one for as long
 * as the vault stays open - browse five hundred notes and all five hundred are
 * resident. Past this many, the ones looked at longest ago are let go.
 */
export const CLOSED_DOCUMENT_LIMIT = 50;

/**
 * Which of the held documents to let go of, oldest first.
 *
 * `order` is every held path, least recently used first. `keep` says which of
 * them must stay - an open tab, a note with unsaved edits, the one on screen -
 * and those neither count towards the limit nor are ever returned. Of the
 * rest, everything beyond the newest `limit` is.
 */
export function documentsToEvict(
  order: Iterable<string>,
  keep: (path: string) => boolean,
  limit = CLOSED_DOCUMENT_LIMIT
): string[] {
  const closed = Array.from(order).filter((path) => !keep(path));
  return closed.slice(0, Math.max(0, closed.length - limit));
}
