import { describe, expect, test } from "bun:test";
import { notePaths, treeFromFiles } from "../src/lib/fileIndex";
import { matchesForPaths, searchFiles } from "../src/lib/fileSearch";
import type { FileEntry } from "../src/lib/types";

const file = (path: string): FileEntry => ({
  name: path.slice(path.lastIndexOf("/") + 1),
  path,
  isDirectory: false,
});

const files = [
  file("/v/index.md"),
  file("/v/essays/draft.md"),
  file("/v/essays/deep/markdown-rendering.md"),
  file("/v/media/pic.png"),
];

describe("notePaths", () => {
  test("keeps the markdown notes, whatever the case of the extension", () => {
    expect(notePaths([...files, file("/v/Shouting.MD")])).toEqual([
      "/v/index.md",
      "/v/essays/draft.md",
      "/v/essays/deep/markdown-rendering.md",
      "/v/Shouting.MD",
    ]);
  });
});

describe("treeFromFiles", () => {
  const tree = treeFromFiles(files, "/v");
  const find = (nodes: FileEntry[], name: string) => nodes.find((node) => node.name === name);

  test("puts a file at the root at the top", () => {
    expect(find(tree, "index.md")?.path).toBe("/v/index.md");
  });

  test("makes the folders a file's path runs through", () => {
    const essays = find(tree, "essays")!;
    expect(essays.isDirectory).toBe(true);
    expect(essays.path).toBe("/v/essays");
    expect(find(essays.children!, "draft.md")?.path).toBe("/v/essays/draft.md");
    expect(find(find(essays.children!, "deep")!.children!, "markdown-rendering.md")).toBeDefined();
  });

  test("makes each folder once", () => {
    expect(tree.filter((node) => node.name === "essays")).toHaveLength(1);
  });

  test("holds every file once", () => {
    const count = (nodes: FileEntry[]): number =>
      nodes.reduce((sum, node) => sum + (node.children ? count(node.children) : 1), 0);
    expect(count(tree)).toBe(files.length);
  });

  test("an empty vault is an empty tree", () => {
    expect(treeFromFiles([], "/v")).toEqual([]);
  });

  test("a file outside the root is listed rather than lost", () => {
    expect(treeFromFiles([file("/elsewhere/x.md")], "/v")).toHaveLength(1);
  });

  test("works with Windows separators", () => {
    const windows = treeFromFiles(
      [{ name: "a.md", path: "C:\\v\\notes\\a.md", isDirectory: false }],
      "C:\\v"
    );
    expect(windows[0].name).toBe("notes");
    expect(windows[0].children?.[0].name).toBe("a.md");
  });

  test("is what quick-open searches, with the folder of each hit", () => {
    const [match] = searchFiles(tree, "mdrn");
    expect(match.entry.name).toBe("markdown-rendering.md");
    expect(match.directory).toBe("essays/deep");
  });

  test("is what the recent list is looked up in", () => {
    expect(matchesForPaths(tree, ["/v/essays/draft.md"])[0].directory).toBe("essays");
  });
});
