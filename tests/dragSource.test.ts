import { beforeEach, describe, expect, test } from "bun:test";
import {
  draggedEntry,
  draggedPath,
  endDrag,
  setDragOver,
  setDraggedEntry,
  subscribe,
} from "../src/lib/dragSource";

// The hooks over this store need React; the store itself is plain module
// state, and how often it announces is what decides how much of the tree a
// drag frame re-renders.

beforeEach(() => {
  endDrag();
});

/** How many times a subscribed row would have been woken by `work`. */
function announcements(work: () => void) {
  let woken = 0;
  const unsubscribe = subscribe(() => {
    woken += 1;
  });
  work();
  unsubscribe();
  return woken;
}

describe("what is being dragged", () => {
  test("nothing, to begin with", () => {
    expect(draggedEntry()).toBeNull();
    expect(draggedPath()).toBeNull();
  });

  test("a row picked up is the row being dragged", () => {
    setDraggedEntry({ path: "/vault/note.md", isDirectory: false });

    expect(draggedPath()).toBe("/vault/note.md");
    expect(draggedEntry()?.isDirectory).toBe(false);
  });

  test("a drop clears both halves of the drag, and says so once", () => {
    setDraggedEntry({ path: "/vault/note.md", isDirectory: false });
    setDragOver("/vault/folder");

    expect(announcements(endDrag)).toBe(1);
    expect(draggedPath()).toBeNull();
  });
});

describe("how often a row is woken", () => {
  // The reason the setters compare before they announce: `dragover` fires on
  // every pointer move, and the great majority of those frames are over the
  // same row as the frame before. Without the check each of them would wake
  // every subscribed row to tell it that nothing had changed.
  test("moving onto a new row is a change", () => {
    expect(announcements(() => setDragOver("/vault/folder"))).toBe(1);
  });

  test("another frame over the same row is not", () => {
    setDragOver("/vault/folder");
    expect(announcements(() => setDragOver("/vault/folder"))).toBe(0);
  });

  test("picking up the same row twice is not either", () => {
    setDraggedEntry({ path: "/vault/note.md", isDirectory: false });
    expect(announcements(() => setDraggedEntry({ path: "/vault/note.md", isDirectory: false }))).toBe(0);
  });

  test("ending a drag that never started changes nothing", () => {
    expect(announcements(endDrag)).toBe(0);
  });

  test("a subscriber that has gone is not woken", () => {
    let woken = 0;
    const unsubscribe = subscribe(() => {
      woken += 1;
    });
    unsubscribe();

    setDragOver("/vault/folder");

    expect(woken).toBe(0);
  });
});
