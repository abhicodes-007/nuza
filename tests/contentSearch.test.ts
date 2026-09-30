import { describe, expect, test } from "bun:test";
import { folderWithin, previewHighlight } from "../src/lib/contentSearch";
import { splitOnHighlight } from "../src/lib/fileSearch";

describe("previewHighlight", () => {
  test("marks the match inside the preview", () => {
    const hit = {
      path: "",
      line: 1,
      column: 4,
      preview: "…the needle here",
      previewStart: 5,
      matchLength: 6,
    };
    expect(splitOnHighlight(hit.preview, previewHighlight(hit))).toEqual(["…the ", "needle", " here"]);
  });
});

describe("folderWithin", () => {
  test("gives the folders between the vault and the note", () => {
    expect(folderWithin("/v", "/v/a/b/note.md")).toBe("a/b");
    expect(folderWithin("/v", "/v/note.md")).toBe("");
  });

  test("works with Windows paths", () => {
    expect(folderWithin("C:\\v", "C:\\v\\a\\note.md")).toBe("a");
  });
});
