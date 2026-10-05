import { beforeEach, describe, expect, test } from "bun:test";
import { readSession, writeSession } from "../src/lib/session";

/** A `localStorage` that two "windows" can share, as two real ones do. */
function fakeStorage() {
  const data = new Map<string, string>();
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, value),
    removeItem: (key: string) => void data.delete(key),
    clear: () => data.clear(),
  };
}

const storage = fakeStorage();
(globalThis as unknown as { localStorage: typeof storage }).localStorage = storage;

const KEY = "nuza:session";

/** What a different window of the app records, straight into the shared store. */
function writtenByAnotherWindow(vault: string, open: string[]) {
  const stored = JSON.parse(storage.getItem(KEY) ?? "{}");
  stored[vault] = { open, current: open[0] };
  storage.setItem(KEY, JSON.stringify(stored));
}

beforeEach(() => storage.clear());

describe("session store", () => {
  test("remembers what was open in a vault", () => {
    writeSession("/a", { open: ["/a/1.md", "/a/2.md"], current: "/a/2.md" });
    expect(readSession("/a")).toEqual({ open: ["/a/1.md", "/a/2.md"], current: "/a/2.md" });
  });

  test("knows nothing of a vault never written", () => {
    expect(readSession("/nowhere").open).toEqual([]);
  });

  test("a write from here keeps what another window recorded for its own vault", () => {
    writeSession("/a", { open: ["/a/1.md"], current: "/a/1.md" });
    // The other window records its tabs. This window has read the store before
    // that and holds a copy of it.
    writtenByAnotherWindow("/b", ["/b/1.md"]);

    writeSession("/a", { open: ["/a/1.md", "/a/2.md"], current: "/a/2.md" });

    expect(readSession("/b").open).toEqual(["/b/1.md"]);
    expect(readSession("/a").open).toEqual(["/a/1.md", "/a/2.md"]);
  });

  test("a read sees what another window has written since", () => {
    writeSession("/a", { open: ["/a/1.md"], current: "/a/1.md" });
    expect(readSession("/b").open).toEqual([]);

    writtenByAnotherWindow("/b", ["/b/9.md"]);
    expect(readSession("/b").open).toEqual(["/b/9.md"]);
  });

  test("another window changing this vault's own entry is what is read, not a stale copy", () => {
    writeSession("/a", { open: ["/a/1.md"], current: "/a/1.md" });
    writtenByAnotherWindow("/a", ["/a/other.md"]);
    expect(readSession("/a").open).toEqual(["/a/other.md"]);
  });

  test("an empty list forgets the vault, and only that one", () => {
    writeSession("/a", { open: ["/a/1.md"], current: "/a/1.md" });
    writeSession("/b", { open: ["/b/1.md"], current: "/b/1.md" });
    writeSession("/a", { open: [], current: "" });
    expect(readSession("/a").open).toEqual([]);
    expect(readSession("/b").open).toEqual(["/b/1.md"]);
  });

  test("keeps the most recently written vaults when there are too many", () => {
    for (let n = 0; n < 15; n++) writeSession(`/v${n}`, { open: [`/v${n}/a.md`], current: `/v${n}/a.md` });
    expect(readSession("/v0").open).toEqual([]);
    expect(readSession("/v14").open).toEqual(["/v14/a.md"]);
  });

  test("a damaged store is an empty one", () => {
    storage.setItem(KEY, "{not json");
    expect(readSession("/a").open).toEqual([]);
    writeSession("/a", { open: ["/a/1.md"], current: "/a/1.md" });
    expect(readSession("/a").open).toEqual(["/a/1.md"]);
  });

  test("a note that is not a string, or a current tab that is not open, is put right", () => {
    storage.setItem(KEY, JSON.stringify({ "/a": { open: ["/a/1.md", 7, ""], current: "/gone.md" } }));
    expect(readSession("/a")).toEqual({ open: ["/a/1.md"], current: "/a/1.md" });
  });
});
