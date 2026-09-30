import { describe, expect, test } from "bun:test";
import { markdown } from "@codemirror/lang-markdown";
import { ensureSyntaxTree } from "@codemirror/language";
import { EditorState } from "@codemirror/state";
import { GFM } from "@lezer/markdown";
import { gutterNumber } from "../src/lib/markdown/lineGutter";

function state(doc: string) {
  const created = EditorState.create({ doc, extensions: [markdown({ extensions: GFM })] });
  ensureSyntaxTree(created, created.doc.length, 5000);
  return created;
}

/** What the gutter shows beside each line, in order. */
function numbers(doc: string) {
  const s = state(doc);
  return Array.from({ length: s.doc.lines }, (_, i) => gutterNumber(i + 1, s));
}

describe("gutterNumber", () => {
  test("numbers ordinary lines by their real line number", () => {
    expect(numbers("# Title\n\nprose")).toEqual(["1", "2", "3"]);
  });

  test("leaves the properties block unnumbered, and keeps real numbers after it", () => {
    expect(numbers("---\ntitle: x\n---\n\nprose")).toEqual(["", "", "", "4", "5"]);
  });

  test("numbers only a table's first line", () => {
    expect(numbers("text\n\n| a | b |\n| - | - |\n| 1 | 2 |\n\nafter")).toEqual([
      "1",
      "2",
      "3",
      "",
      "",
      "6",
      "7",
    ]);
  });

  test("answers for a number past the end, which the gutter sizes itself by", () => {
    expect(gutterNumber(99, state("one line"))).toBe("99");
  });
});
