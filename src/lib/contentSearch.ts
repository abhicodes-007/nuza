/** A line of a note holding what was searched for, as `search_contents` returns it. */
export interface ContentHit {
  path: string;
  /** 1-based. */
  line: number;
  /** Where the match starts in its line, in UTF-16 units - an editor position. */
  column: number;
  /** The line, cut down around the match when it is long. */
  preview: string;
  /** Where the match starts in `preview`, and how long it is, in UTF-16 units. */
  previewStart: number;
  matchLength: number;
}

/** Queries shorter than this match nearly every line in the vault. */
export const MIN_CONTENT_QUERY = 2;

/** The indices of the match in a hit's preview, in the shape `MatchedText` highlights. */
export function previewHighlight(hit: ContentHit) {
  return Array.from({ length: hit.matchLength }, (_, offset) => hit.previewStart + offset);
}

/** The folders between the vault and a note, for the dimmed half of a row. */
export function folderWithin(root: string, path: string) {
  const parts = path
    .slice(root.length)
    .split(/[\\/]+/)
    .filter(Boolean);
  return parts.slice(0, -1).join("/");
}
