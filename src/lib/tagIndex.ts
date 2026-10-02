/**
 * The vault's tags: which notes use each, and which tags each note uses.
 *
 * Built from the flat list the backend returns - one entry per `#tag` written,
 * with its note and line - because that is the cheapest thing for it to say.
 * Tags are the same tag whatever their case, as they are everywhere else:
 * `#Todo` and `#todo` are one, shown the way they were first written.
 */

/** A `#tag` written in a note, as `list_tags` returns it. */
export interface TagRef {
  from: string;
  /** Without the `#`, as written. */
  tag: string;
  line: number;
  preview: string;
}

export interface TagEntry {
  /** The tag as it was first written. */
  name: string;
  /** Every place it is written, by note and then line. */
  uses: TagRef[];
  /** How many notes it is in - which is what is counted, not how often it is said. */
  notes: number;
}

export interface TagIndex {
  /** The most used first, then by name. */
  tags: TagEntry[];
  /** The tags each note uses, by the note's path. */
  byNote: Map<string, string[]>;
}

const keyOf = (tag: string) => tag.toLowerCase();

export function buildTagIndex(refs: TagRef[]): TagIndex {
  const entries = new Map<string, TagEntry>();
  const byNote = new Map<string, string[]>();

  for (const ref of refs) {
    const key = keyOf(ref.tag);
    let entry = entries.get(key);
    if (!entry) {
      entry = { name: ref.tag, uses: [], notes: 0 };
      entries.set(key, entry);
    }
    entry.uses.push(ref);

    const used = byNote.get(ref.from);
    if (!used) byNote.set(ref.from, [entry.name]);
    else if (!used.includes(entry.name)) used.push(entry.name);
  }

  for (const entry of entries.values()) {
    entry.uses.sort((a, b) => a.from.localeCompare(b.from) || a.line - b.line);
    entry.notes = new Set(entry.uses.map((use) => use.from)).size;
  }

  const tags = [...entries.values()].sort(
    (a, b) => b.notes - a.notes || a.name.localeCompare(b.name, undefined, { sensitivity: "base" })
  );
  return { tags, byNote };
}

/** The places `entry` is written, one for each note: the first line it is on in that note. */
export function firstUseInEachNote(entry: TagEntry): TagRef[] {
  const seen = new Set<string>();
  return entry.uses.filter((use) => !seen.has(use.from) && !!seen.add(use.from));
}
