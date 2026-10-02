import { describe, expect, test } from "bun:test";
import { estimateTableHeight } from "../src/lib/markdown/widgets";

describe("estimateTableHeight", () => {
  test("grows with each row", () => {
    const one = estimateTableHeight(1);
    expect(estimateTableHeight(2)).toBeGreaterThan(one);
    expect(estimateTableHeight(11) - estimateTableHeight(10)).toBe(estimateTableHeight(2) - one);
  });

  test("scales with the editor's font size", () => {
    expect(estimateTableHeight(5, 32)).toBeGreaterThan(estimateTableHeight(5, 16) * 1.9);
  });

  test("is taller than the lines of source it stands in for", () => {
    // A table of n rows is n + 1 lines of source (the delimiter row), at the
    // editor's 28px line height - which is what CodeMirror guesses without this.
    for (const rows of [3, 10, 30]) {
      expect(estimateTableHeight(rows)).toBeGreaterThan((rows + 1) * 28);
    }
  });
});
