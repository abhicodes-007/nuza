import { describe, expect, test } from "bun:test";
import { readRecent, recordRecent } from "../src/lib/recentFiles";

describe("recordRecent", () => {
  test("puts the latest first", () => {
    expect(recordRecent(["a", "b"], "c")).toEqual(["c", "a", "b"]);
  });

  test("moves a note opened again to the front rather than listing it twice", () => {
    expect(recordRecent(["a", "b", "c"], "c")).toEqual(["c", "a", "b"]);
  });

  test("forgets the oldest past the limit", () => {
    expect(recordRecent(["a", "b"], "c", 2)).toEqual(["c", "a"]);
  });

  test("ignores an empty path, as the scratch note has", () => {
    const list = ["a"];
    expect(recordRecent(list, "")).toBe(list);
  });
});

describe("readRecent", () => {
  test("keeps what is a list of paths", () => {
    expect(readRecent(["a", "b"])).toEqual(["a", "b"]);
  });

  test("drops what is not a path, and repeats", () => {
    expect(readRecent(["a", 3, "", null, "a", "b"])).toEqual(["a", "b"]);
  });

  test("reads anything else as empty", () => {
    expect(readRecent(null)).toEqual([]);
    expect(readRecent({ a: 1 })).toEqual([]);
    expect(readRecent("a")).toEqual([]);
  });
});
