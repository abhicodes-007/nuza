import { describe, expect, test } from "bun:test";
import { documentsToEvict } from "../src/lib/documentCache";

describe("documentsToEvict", () => {
  test("keeps everything up to the limit", () => {
    expect(documentsToEvict(["a", "b", "c"], () => false, 3)).toEqual([]);
  });

  test("lets go of the least recently used first", () => {
    expect(documentsToEvict(["a", "b", "c", "d"], () => false, 2)).toEqual(["a", "b"]);
  });

  test("never lets go of a kept document, and does not count it", () => {
    const kept = new Set(["a", "c"]);
    expect(documentsToEvict(["a", "b", "c", "d", "e"], (path) => kept.has(path), 2)).toEqual(["b"]);
  });

  test("keeps every kept document even past the limit", () => {
    expect(documentsToEvict(["a", "b", "c"], () => true, 0)).toEqual([]);
  });
});
