import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { markdown } from "@codemirror/lang-markdown";
import { ensureSyntaxTree } from "@codemirror/language";
import { EditorSelection, EditorState } from "@codemirror/state";
import { GFM } from "@lezer/markdown";
import { liveMarkdownPreview } from "../src/lib/markdown/livePreview";
import { isLocalImageTarget, noteDirectory } from "../src/lib/markdown/sources";
import { LinkThumbnailWidget } from "../src/lib/markdown/widgets";

describe("isLocalImageTarget", () => {
  test("is a path to an image file", () => {
    for (const url of [
      "a.png",
      "./pics/a.JPG",
      "../a.jpeg",
      "x y/a.webp",
      "a.gif",
      "a.svg",
      "a.avif",
      "a.bmp",
    ]) {
      expect(isLocalImageTarget(url)).toBe(true);
    }
  });

  test("reads past a query or a fragment", () => {
    expect(isLocalImageTarget("a.png?raw=1")).toBe(true);
    expect(isLocalImageTarget("a.png#frag")).toBe(true);
    expect(isLocalImageTarget("a#frag.png")).toBe(false);
  });

  test("is not a web address, or anything with a scheme", () => {
    for (const url of [
      "https://x.y/a.png",
      "http://x.y/a.png",
      "data:image/png;base64,AAAA",
      "file:///a.png",
    ]) {
      expect(isLocalImageTarget(url)).toBe(false);
    }
  });

  test("is not a note, a document, or nothing", () => {
    for (const url of ["a.md", "a.pdf", "a", "", "  ", ".png.txt", "#heading"]) {
      expect(isLocalImageTarget(url)).toBe(false);
    }
  });
});

describe("a link to an image", () => {
  const saved = (globalThis as { window?: unknown }).window;
  beforeAll(() => {
    // What `convertFileSrc` reads, standing in for the Tauri window.
    Object.assign(globalThis, {
      window: { __TAURI_INTERNALS__: { convertFileSrc: (path: string) => `media://${path}` } },
    });
  });
  afterAll(() => {
    Object.assign(globalThis, { window: saved });
  });

  /** The thumbnails the preview draws for `doc`, as the sources they show. */
  function thumbnails(doc: string, cursor = doc.length) {
    const built = EditorState.create({
      doc,
      extensions: [markdown({ extensions: GFM }), noteDirectory.of("/vault/notes"), liveMarkdownPreview],
      selection: EditorSelection.cursor(cursor),
    });
    ensureSyntaxTree(built, built.doc.length, 5000);
    const found: { src: string; alt: string; at: number }[] = [];
    const cursorIter = built.field(liveMarkdownPreview).iter();
    while (cursorIter.value) {
      const widget = (cursorIter.value.spec as { widget?: unknown }).widget;
      if (widget instanceof LinkThumbnailWidget)
        found.push({ src: widget.src, alt: widget.alt, at: cursorIter.from });
      cursorIter.next();
    }
    return found;
  }

  test("gets a thumbnail after it, labelled with its text", () => {
    const doc = "a [the chart](./chart.png) b\n\nand more text here";
    const [found] = thumbnails(doc, doc.length);
    expect(found.src).toBe("media:///vault/notes/chart.png");
    expect(found.alt).toBe("the chart");
    expect(found.at).toBe(doc.indexOf(")") + 1);
  });

  test("gets one for each such link", () => {
    expect(thumbnails("[a](a.png) and [b](b.jpg)\n\nend")).toHaveLength(2);
  });

  test("does not get one while the caret is in it", () => {
    const doc = "[a](a.png)\n\nend";
    expect(thumbnails(doc, 3)).toHaveLength(0);
  });

  test("does not get one if it is to a web address, a note or a document", () => {
    expect(thumbnails("[a](https://x.y/a.png) [b](b.md) [c](c.pdf)\n\nend")).toHaveLength(0);
  });
});
