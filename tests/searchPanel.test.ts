import { describe, expect, test } from "bun:test";
import { SearchQuery } from "@codemirror/search";
import { EditorSelection, EditorState } from "@codemirror/state";
import { matchPosition } from "../src/lib/markdown/searchPanel";

const doc = "one two one three ONE";

function at(from: number, to = from) {
  return EditorState.create({ doc, selection: EditorSelection.range(from, to) });
}

describe("matchPosition", () => {
  test("counts every match, ignoring case unless asked", () => {
    expect(matchPosition(at(0), new SearchQuery({ search: "one" })).total).toBe(3);
    expect(matchPosition(at(0), new SearchQuery({ search: "one", caseSensitive: true })).total).toBe(2);
  });

  test("says which match the selection is on", () => {
    const second = doc.indexOf("one", 1);
    expect(matchPosition(at(second, second + 3), new SearchQuery({ search: "one" })).current).toBe(2);
  });

  test("is on none while the selection is not a match", () => {
    expect(matchPosition(at(5), new SearchQuery({ search: "one" })).current).toBe(0);
  });

  test("has nothing to count for an empty or broken query", () => {
    expect(matchPosition(at(0), new SearchQuery({ search: "" })).total).toBe(0);
    expect(matchPosition(at(0), new SearchQuery({ search: "(", regexp: true })).total).toBe(0);
  });

  test("stops counting at the limit", () => {
    const many = EditorState.create({ doc: "a".repeat(1500) });
    const result = matchPosition(many, new SearchQuery({ search: "a" }));
    expect(result).toEqual({ total: 1000, current: 0, capped: true });
  });
});
