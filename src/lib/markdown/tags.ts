import type { MarkdownConfig } from "@lezer/markdown";
import { tags as highlightTags } from "@lezer/highlight";

/**
 * `#tags`: a word with a `#` on the front, written anywhere in a note's prose.
 *
 * The same few rules as the Rust side, which reads them out of raw text for
 * the sidebar's list (`src-tauri/src/tags.rs`) - what is drawn as a tag and
 * what is listed as one should never disagree:
 *
 * - letters, digits, `_` and `-`, in any script, with at least one that is
 *   not a digit - `#2024` is a number, not a tag;
 * - the `#` has to start the text or follow whitespace, which keeps
 *   `example.com#section`, `[x](#heading)` and `[[note#heading]]` out;
 * - code, fenced or inline, and frontmatter never reach this: the parser has
 *   already taken them, and the editor draws frontmatter as its own widget.
 */

const HASH = 35;

const WHITESPACE = /\p{White_Space}/u;
const TAG_BODY = /^[\p{Alphabetic}\p{N}_-]+/u;
const NOT_A_DIGIT = /[^\p{N}]/u;

/**
 * The tag a `#` begins, without the `#`, or null if it begins none. `before`
 * is the character in front of the `#` (empty at the start of the text) and
 * `after` is everything behind it.
 */
export function tagAfterHash(before: string, after: string) {
  if (before && !WHITESPACE.test(before)) return null;

  const body = TAG_BODY.exec(after)?.[0];
  return body && NOT_A_DIGIT.test(body) ? body : null;
}

/** The parser extension: a `Tag` node for each `#tag`, `#` included. */
export const Tag: MarkdownConfig = {
  defineNodes: [{ name: "Tag", style: highlightTags.labelName }],
  parseInline: [
    {
      name: "Tag",
      parse(cx, next, pos) {
        if (next !== HASH) return -1;

        const before = pos > cx.offset ? String.fromCharCode(cx.char(pos - 1)) : "";
        const tag = tagAfterHash(before, cx.slice(pos + 1, cx.end));
        if (!tag) return -1;

        return cx.addElement(cx.elt("Tag", pos, pos + 1 + tag.length));
      },
    },
  ],
};
