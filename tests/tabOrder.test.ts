import { describe, expect, test } from "bun:test";
import { moveTab } from "../src/lib/tabOrder";

describe("moveTab", () => {
  const tabs = ["a", "b", "c", "d"];

  test("moves a tab left, before the one it was dropped on", () => {
    expect(moveTab(tabs, "d", 1)).toEqual(["a", "d", "b", "c"]);
  });

  test("moves a tab right, allowing for the gap it leaves", () => {
    expect(moveTab(tabs, "a", 3)).toEqual(["b", "c", "a", "d"]);
  });

  test("moves a tab to the end", () => {
    expect(moveTab(tabs, "b", 4)).toEqual(["a", "c", "d", "b"]);
  });

  test("gives back the same strip when the tab lands where it was", () => {
    expect(moveTab(tabs, "b", 1)).toBe(tabs);
    expect(moveTab(tabs, "b", 2)).toBe(tabs);
  });

  test("ignores a tab that is not in the strip", () => {
    expect(moveTab(tabs, "x", 0)).toBe(tabs);
  });
});
