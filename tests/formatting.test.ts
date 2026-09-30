import { describe, expect, test } from "bun:test";
import { EditorSelection, EditorState, StateCommand } from "@codemirror/state";
import { insertLink, toggleBold, toggleItalic } from "../src/lib/markdown/formatting";

/**
 * Runs `command` on `doc`, where `[` and `]` mark the selection (or `|` a
 * caret), and returns the result marked the same way.
 */
function run(command: StateCommand, marked: string) {
  const caret = marked.indexOf("|");
  const from = caret >= 0 ? caret : marked.indexOf("[");
  const to = caret >= 0 ? caret : marked.indexOf("]") - 1;
  const doc = marked.replace(/[[\]|]/g, "");

  let state = EditorState.create({ doc, selection: EditorSelection.range(from, to) });
  command({ state, dispatch: (transaction) => (state = transaction.state) });

  const { from: a, to: b } = state.selection.main;
  const text = state.doc.toString();
  return a === b
    ? `${text.slice(0, a)}|${text.slice(a)}`
    : `${text.slice(0, a)}[${text.slice(a, b)}]${text.slice(b)}`;
}

describe("toggleBold", () => {
  test("wraps a selection, keeping the words selected", () => {
    expect(run(toggleBold, "a [word] b")).toBe("a **[word]** b");
  });

  test("unwraps a selection sitting inside the stars", () => {
    expect(run(toggleBold, "a **[word]** b")).toBe("a [word] b");
  });

  test("unwraps a selection that takes the stars in", () => {
    expect(run(toggleBold, "a [**word**] b")).toBe("a [word] b");
  });

  test("puts a pair of stars round the caret, and takes an empty pair away", () => {
    expect(run(toggleBold, "a | b")).toBe("a **|** b");
    expect(run(toggleBold, "a **|** b")).toBe("a | b");
  });

  test("leaves the italic standing in bold italic", () => {
    expect(run(toggleBold, "***[word]***")).toBe("*[word]*");
  });
});

describe("toggleItalic", () => {
  test("wraps and unwraps with one star", () => {
    expect(run(toggleItalic, "[word]")).toBe("*[word]*");
    expect(run(toggleItalic, "*[word]*")).toBe("[word]");
  });

  test("adds a star inside bold rather than stripping one off it", () => {
    expect(run(toggleItalic, "**[word]**")).toBe("***[word]***");
  });

  test("takes the italic out of bold italic, leaving the bold", () => {
    expect(run(toggleItalic, "***[word]***")).toBe("**[word]**");
  });
});

describe("insertLink", () => {
  test("makes selected text the label, with the caret in the target", () => {
    expect(run(insertLink, "see [the docs] now")).toBe("see [the docs](|) now");
  });

  test("makes a selected URL the target, with the caret in the label", () => {
    expect(run(insertLink, "[https://example.com]")).toBe("[|](https://example.com)");
  });

  test("with nothing selected, leaves the caret in an empty label", () => {
    expect(run(insertLink, "a | b")).toBe("a [|]() b");
  });
});
