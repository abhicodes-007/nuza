import { EditorSelection, StateCommand, Text } from "@codemirror/state";

/**
 * Bold, italic and links from the keyboard.
 *
 * Emphasis is written with `*` - two for bold, one for italic, three for both
 * - and toggling works by counting the stars on either side of the selection:
 * an even run of two or more is bold, an odd run is italic, three is both. So
 * italic toggled inside `**word**` adds a star rather than stripping one off
 * the bold, and bold toggled inside `***word***` leaves the italic standing.
 */

/** How many `*` sit directly before `from` and directly after `to`. */
function starsAround(doc: Text, from: number, to: number) {
  let before = 0;
  while (from - before > 0 && doc.sliceString(from - before - 1, from - before) === "*") before++;
  let after = 0;
  while (to + after < doc.length && doc.sliceString(to + after, to + after + 1) === "*") after++;
  return Math.min(before, after);
}

/** How many `*` the text itself opens and closes with. */
function starsWithin(text: string) {
  let count = 0;
  while (count * 2 < text.length && text[count] === "*" && text[text.length - 1 - count] === "*") count++;
  return count;
}

const isBold = (stars: number) => stars >= 2;
const isItalic = (stars: number) => stars % 2 === 1;

function toggleEmphasis(width: 1 | 2): StateCommand {
  const has = width === 2 ? isBold : isItalic;

  return ({ state, dispatch }) => {
    const change = state.changeByRange((range) => {
      const { from, to } = range;
      const text = state.sliceDoc(from, to);

      // The stars are part of the selection: `**word**` selected whole.
      const inside = starsWithin(text);
      if (!range.empty && has(inside) && text.length > inside * 2) {
        return {
          changes: [
            { from, to: from + width },
            { from: to - width, to },
          ],
          range: EditorSelection.range(from, to - width * 2),
        };
      }

      // The stars are around the selection, or around the caret.
      if (has(starsAround(state.doc, from, to))) {
        return {
          changes: [
            { from: from - width, to: from },
            { from: to, to: to + width },
          ],
          range: EditorSelection.range(from - width, to - width),
        };
      }

      const marker = "*".repeat(width);
      return {
        changes: [
          { from, insert: marker },
          { from: to, insert: marker },
        ],
        range: EditorSelection.range(from + width, to + width),
      };
    });

    dispatch(state.update(change, { scrollIntoView: true, userEvent: "input.format" }));
    return true;
  };
}

export const toggleBold = toggleEmphasis(2);
export const toggleItalic = toggleEmphasis(1);

const URL = /^(https?:\/\/|mailto:|www\.)\S+$/i;

/**
 * Wraps the selection in a link and leaves the caret where the rest of it
 * goes: selected text becomes the label with the caret in the empty target,
 * a selected URL becomes the target with the caret in the empty label, and
 * with nothing selected both are empty and the caret is in the label.
 */
export const insertLink: StateCommand = ({ state, dispatch }) => {
  const change = state.changeByRange(({ from, to }) => {
    const text = state.sliceDoc(from, to);

    if (text && URL.test(text.trim())) {
      return { changes: { from, to, insert: `[](${text.trim()})` }, range: EditorSelection.cursor(from + 1) };
    }
    const insert = `[${text}]()`;
    const caret = text ? from + insert.length - 1 : from + 1;
    return { changes: { from, to, insert }, range: EditorSelection.cursor(caret) };
  });

  dispatch(state.update(change, { scrollIntoView: true, userEvent: "input.format" }));
  return true;
};
