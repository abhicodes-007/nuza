import { describe, expect, test } from "bun:test";
import {
  addEntry,
  addFile,
  ensureDirectory,
  findEntry,
  moveEntry,
  nameOf,
  parentOf,
  removeEntry,
  sortTree,
  touchEntry,
} from "../src/lib/fileTree";
import type { FileEntry } from "../src/lib/types";

const ROOT = "/v";

function tree(): FileEntry[] {
  return [
    {
      name: "notes",
      path: "/v/notes",
      isDirectory: true,
      children: [{ name: "a.md", path: "/v/notes/a.md", isDirectory: false }],
    },
    { name: "b.md", path: "/v/b.md", isDirectory: false },
  ];
}

describe("parentOf / nameOf", () => {
  test("split either separator", () => {
    expect(parentOf("/v/notes/a.md")).toBe("/v/notes");
    expect(nameOf("/v/notes/a.md")).toBe("a.md");
    expect(parentOf("C:\\v\\a.md")).toBe("C:\\v");
    expect(nameOf("C:\\v\\a.md")).toBe("a.md");
  });

  test("a bare name has no parent", () => {
    expect(parentOf("a.md")).toBe("");
  });
});

describe("findEntry", () => {
  test("finds at the root and nested", () => {
    expect(findEntry(tree(), "/v/b.md")?.name).toBe("b.md");
    expect(findEntry(tree(), "/v/notes/a.md")?.name).toBe("a.md");
  });

  test("returns null for something not there", () => {
    expect(findEntry(tree(), "/v/nope.md")).toBeNull();
  });
});

describe("addEntry", () => {
  test("inserts into a directory and keeps directories first, then name order", () => {
    const next = addEntry(tree(), ROOT, { name: "A.md", path: "/v/notes/A.md", isDirectory: false });
    const names = findEntry(next, "/v/notes")!.children!.map((c) => c.name);
    expect(names).toEqual(["a.md", "A.md"]);
  });

  test("inserts at the root", () => {
    const next = addEntry(tree(), ROOT, { name: "zzz", path: "/v/zzz", isDirectory: true, children: [] });
    expect(next.map((e) => e.name)).toEqual(["notes", "zzz", "b.md"]);
  });

  test("leaves untouched subtrees referentially identical", () => {
    const before = tree();
    const next = addEntry(before, ROOT, { name: "c.md", path: "/v/c.md", isDirectory: false });
    expect(next.find((e) => e.name === "notes")).toBe(before.find((e) => e.name === "notes"));
  });
});

describe("removeEntry", () => {
  test("drops a nested file", () => {
    expect(findEntry(removeEntry(tree(), ROOT, "/v/notes/a.md"), "/v/notes/a.md")).toBeNull();
  });

  test("drops a directory and everything under it", () => {
    const next = removeEntry(tree(), ROOT, "/v/notes");
    expect(findEntry(next, "/v/notes")).toBeNull();
    expect(findEntry(next, "/v/notes/a.md")).toBeNull();
  });
});

describe("moveEntry", () => {
  test("rewrites the entry's own path and its descendants'", () => {
    const next = moveEntry(tree(), ROOT, "/v/notes", "/v/archive");
    expect(findEntry(next, "/v/notes")).toBeNull();
    expect(findEntry(next, "/v/archive")?.name).toBe("archive");
    expect(findEntry(next, "/v/archive/a.md")?.name).toBe("a.md");
  });

  test("moving something absent is a no-op", () => {
    const before = tree();
    expect(moveEntry(before, ROOT, "/v/nope", "/v/other")).toBe(before);
  });
});

describe("ensureDirectory / addFile", () => {
  test("creates the folder a new file landed in", () => {
    const next = addFile(tree(), ROOT, "/v/media/pic.png");
    expect(findEntry(next, "/v/media")?.isDirectory).toBe(true);
    expect(findEntry(next, "/v/media/pic.png")?.name).toBe("pic.png");
  });

  test("creates intermediate folders too", () => {
    const next = ensureDirectory(tree(), ROOT, "/v/one/two/three");
    expect(findEntry(next, "/v/one")).not.toBeNull();
    expect(findEntry(next, "/v/one/two")).not.toBeNull();
    expect(findEntry(next, "/v/one/two/three")).not.toBeNull();
  });

  test("adding a file that is already there changes nothing", () => {
    const before = tree();
    expect(addFile(before, ROOT, "/v/b.md")).toBe(before);
  });
});

describe("sortTree", () => {
  const file = (name: string, modified?: number, created?: number) => ({
    name,
    path: `/v/${name}`,
    isDirectory: false,
    modified,
    created,
  });
  const tree = [
    {
      name: "b-dir",
      path: "/v/b-dir",
      isDirectory: true,
      modified: 1,
      children: [file("x.md", 5), file("y.md", 9)],
    },
    { name: "a-dir", path: "/v/a-dir", isDirectory: true, modified: 2, children: [] },
    file("old.md", 10, 100),
    file("new.md", 30, 50),
    file("mid.md", 20),
  ];
  const names = (entries: { name: string }[]) => entries.map((entry) => entry.name);

  test("name order is the tree itself", () => {
    expect(sortTree(tree, "name")).toBe(tree);
  });

  test("by date modified: folders first, newest first, all the way down", () => {
    const sorted = sortTree(tree, "modified");
    expect(names(sorted)).toEqual(["a-dir", "b-dir", "new.md", "mid.md", "old.md"]);
    expect(names(sorted[1].children!)).toEqual(["y.md", "x.md"]);
  });

  test("by date created, falling back to modified where there is none", () => {
    expect(names(sortTree(tree, "created").slice(2))).toEqual(["old.md", "new.md", "mid.md"]);
  });

  test("a file with no time yet is the newest, and two of them go by name", () => {
    const withNew = [...tree, file("zz-made.md"), file("aa-made.md")];
    expect(names(sortTree(withNew, "modified")).slice(2, 4)).toEqual(["aa-made.md", "zz-made.md"]);
  });
});

describe("touchEntry", () => {
  test("marks a nested file as written now, leaving the rest alone", () => {
    const tree = [
      {
        name: "d",
        path: "/v/d",
        isDirectory: true,
        children: [{ name: "n.md", path: "/v/d/n.md", isDirectory: false, modified: 1 }],
      },
    ];
    const touched = touchEntry(tree, "/v", "/v/d/n.md", 42);
    expect(touched[0].children![0].modified).toBe(42);
    expect(tree[0].children[0].modified).toBe(1);
  });

  test("gives the same tree back for a note it does not list", () => {
    const tree = [{ name: "a.md", path: "/v/a.md", isDirectory: false }];
    expect(touchEntry(tree, "/v", "untitled.md")).toBe(tree);
  });
});
