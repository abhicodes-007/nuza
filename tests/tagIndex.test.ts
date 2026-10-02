import { describe, expect, test } from "bun:test";
import { TagRef, buildTagIndex, firstUseInEachNote } from "../src/lib/tagIndex";

const ref = (from: string, tag: string, line = 1): TagRef => ({ from, tag, line, preview: `#${tag}` });

describe("buildTagIndex", () => {
  test("lists the tags most used first, then by name", () => {
    const { tags } = buildTagIndex([
      ref("a.md", "beta"),
      ref("a.md", "alpha"),
      ref("b.md", "beta"),
      ref("c.md", "gamma"),
    ]);
    expect(tags.map((t) => [t.name, t.notes])).toEqual([
      ["beta", 2],
      ["alpha", 1],
      ["gamma", 1],
    ]);
  });

  test("counts notes, not mentions", () => {
    const { tags } = buildTagIndex([ref("a.md", "x", 1), ref("a.md", "x", 5), ref("a.md", "x", 9)]);
    expect(tags[0].notes).toBe(1);
    expect(tags[0].uses).toHaveLength(3);
  });

  test("takes #Todo and #todo as one tag, named as first written", () => {
    const { tags } = buildTagIndex([ref("a.md", "Todo"), ref("b.md", "todo"), ref("c.md", "TODO")]);
    expect(tags).toHaveLength(1);
    expect(tags[0].name).toBe("Todo");
    expect(tags[0].notes).toBe(3);
  });

  test("keeps each tag's places in note and line order", () => {
    const { tags } = buildTagIndex([ref("b.md", "x", 2), ref("a.md", "x", 9), ref("a.md", "x", 3)]);
    expect(tags[0].uses.map((u) => [u.from, u.line])).toEqual([
      ["a.md", 3],
      ["a.md", 9],
      ["b.md", 2],
    ]);
  });

  test("says which tags each note uses, once each", () => {
    const { byNote } = buildTagIndex([
      ref("a.md", "x"),
      ref("a.md", "X", 4),
      ref("a.md", "y"),
      ref("b.md", "x"),
    ]);
    expect(byNote.get("a.md")).toEqual(["x", "y"]);
    expect(byNote.get("b.md")).toEqual(["x"]);
    expect(byNote.get("c.md")).toBeUndefined();
  });

  test("is empty for no tags", () => {
    const { tags, byNote } = buildTagIndex([]);
    expect(tags).toEqual([]);
    expect(byNote.size).toBe(0);
  });
});

describe("firstUseInEachNote", () => {
  test("keeps the first line of each note a tag is in", () => {
    const { tags } = buildTagIndex([ref("a.md", "x", 3), ref("a.md", "x", 8), ref("b.md", "x", 2)]);
    expect(firstUseInEachNote(tags[0]).map((u) => [u.from, u.line])).toEqual([
      ["a.md", 3],
      ["b.md", 2],
    ]);
  });
});
