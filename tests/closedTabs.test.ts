import { describe, expect, test } from "bun:test";
import { placeAt, rememberClosed } from "../src/lib/closedTabs";

describe("rememberClosed", () => {
  test("puts the latest on top", () => {
    const stack = rememberClosed(rememberClosed([], { path: "a", index: 0 }), { path: "b", index: 1 });
    expect(stack.map((tab) => tab.path)).toEqual(["a", "b"]);
  });

  test("remembers a note closed twice once, where it was closed last", () => {
    let stack = rememberClosed([], { path: "a", index: 0 });
    stack = rememberClosed(stack, { path: "b", index: 1 });
    stack = rememberClosed(stack, { path: "a", index: 3 });
    expect(stack).toEqual([
      { path: "b", index: 1 },
      { path: "a", index: 3 },
    ]);
  });

  test("forgets the oldest past the limit", () => {
    let stack = rememberClosed([], { path: "a", index: 0 }, 2);
    stack = rememberClosed(stack, { path: "b", index: 0 }, 2);
    stack = rememberClosed(stack, { path: "c", index: 0 }, 2);
    expect(stack.map((tab) => tab.path)).toEqual(["b", "c"]);
  });
});

describe("placeAt", () => {
  test("moves a reopened tab back to where it sat", () => {
    expect(placeAt(["a", "b", "c"], "c", 1)).toEqual(["a", "c", "b"]);
  });

  test("clamps a position past the end of a strip that has since shrunk", () => {
    expect(placeAt(["a", "c"], "c", 5)).toEqual(["a", "c"]);
  });

  test("leaves the strip alone when the tab is not in it", () => {
    const paths = ["a", "b"];
    expect(placeAt(paths, "x", 0)).toBe(paths);
  });
});
