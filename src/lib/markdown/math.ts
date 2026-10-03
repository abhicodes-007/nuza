import type { MarkdownConfig } from "@lezer/markdown";
import { tags as highlightTags } from "@lezer/highlight";

/**
 * `$tex$` and `$$tex$$`: TeX math, inline and as a block.
 *
 * Dollar signs are also just money, so the rules are Pandoc's rather than
 * "anything between two of them":
 *
 * - the opening `$` has to be followed by something that is not a space;
 * - the closing `$` has to follow something that is not a space, and must not
 *   be followed by a digit - which is what keeps `it cost $5 and $10` prose;
 * - an inline span stays on one line;
 * - a block is a line starting `$$` and the next line ending `$$`, with no
 *   blank line between them. A `$$` that is never closed is not a block, so a
 *   half-typed one does not swallow the rest of the note.
 *
 * Code, fenced or inline, never reaches this: the parser has already taken it.
 */

const DOLLAR = 36;

const SPACE = /\s/;
const DIGIT = /[0-9]/;

/** How far past a `$$` opener to look for its closer before giving up. */
const BLOCK_LOOKAHEAD = 20_000;

/**
 * The document behind a block parser. `BlockContext` holds it as `input` but
 * does not put it in its typings; reading ahead is the only way to know a `$$`
 * has a closer before committing the lines in between to it.
 */
type WithInput = { input: { length: number; read(from: number, to: number): string } };

/**
 * The end of the inline span `text` opens with, or -1 if it opens none. `text`
 * starts at the opening `$` and runs to the end of the line.
 */
export function inlineMathEnd(text: string) {
  const open = text.startsWith("$$") ? 2 : 1;
  const first = text[open];
  if (first === undefined || SPACE.test(first)) return -1;

  for (let i = open; i < text.length; i++) {
    if (text[i] === "\\") {
      i++;
      continue;
    }
    if (text[i] !== "$") continue;
    if (open === 2 && text[i + 1] !== "$") continue;
    if (SPACE.test(text[i - 1])) continue;

    const end = i + open;
    if (DIGIT.test(text[end] ?? "")) continue;
    return end;
  }
  return -1;
}

/** The TeX inside a span's delimiters. */
export function mathSource(text: string) {
  const dollars = text.startsWith("$$") ? 2 : 1;
  const delimiter = "$".repeat(dollars);
  const inner = text.slice(dollars, text.endsWith(delimiter) ? text.length - dollars : undefined);
  return inner.trim();
}

/** The parser extension: `InlineMath` and `BlockMath` nodes, `$` included. */
export const MathSyntax: MarkdownConfig = {
  defineNodes: [
    { name: "InlineMath", style: highlightTags.special(highlightTags.string) },
    { name: "BlockMath", block: true, style: highlightTags.special(highlightTags.string) },
  ],
  parseInline: [
    {
      name: "InlineMath",
      parse(cx, next, pos) {
        if (next !== DOLLAR) return -1;

        const rest = cx.slice(pos, cx.end);
        const newline = rest.indexOf("\n");
        const end = inlineMathEnd(newline < 0 ? rest : rest.slice(0, newline));
        if (end < 0) return -1;

        return cx.addElement(cx.elt("InlineMath", pos, pos + end));
      },
      // Ahead of the escape parser, which would otherwise take the
      // backslashes inside the TeX one at a time.
      before: "Escape",
    },
  ],
  parseBlock: [
    {
      name: "BlockMath",
      parse(cx, line) {
        const text = line.text.trimEnd();
        if (!text.slice(line.pos).startsWith("$$")) return false;

        const from = cx.lineStart + line.pos;

        // `$$ x $$` on one line.
        if (text.length - line.pos > 4 && text.endsWith("$$")) {
          const end = cx.lineStart + text.length;
          cx.nextLine();
          cx.addElement(cx.elt("BlockMath", from, end));
          return true;
        }

        // Otherwise it opens a block, if a line before the next gap closes it.
        const bodyStart = cx.lineStart + line.text.length + 1;
        const { input } = cx as unknown as WithInput;
        const lines = input.read(bodyStart, Math.min(input.length, bodyStart + BLOCK_LOOKAHEAD)).split("\n");
        let lineStart = bodyStart;
        let closing: { start: number; end: number } | null = null;
        for (const next of lines) {
          const trimmed = next.trimEnd();
          if (!trimmed) break;
          if (trimmed.endsWith("$$")) {
            closing = { start: lineStart, end: lineStart + trimmed.length };
            break;
          }
          lineStart += next.length + 1;
        }
        if (!closing) return false;

        while (cx.nextLine() && cx.lineStart < closing.start);
        cx.nextLine();
        cx.addElement(cx.elt("BlockMath", from, closing.end));
        return true;
      },
      before: "FencedCode",
    },
  ],
};
