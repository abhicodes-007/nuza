import { describe, expect, test } from "bun:test";
import { Text } from "@codemirror/state";
import { countDocument, readingMinutes } from "../src/lib/documentStats";

const count = (text: string) => countDocument(Text.of(text.split("\n")));

describe("countDocument", () => {
  test("an empty document has nothing in it", () => {
    expect(count("")).toEqual({ words: 0, paragraphs: 0, characters: 0 });
  });

  test("counts words across runs of whitespace", () => {
    expect(count("one two   three\tfour").words).toBe(4);
  });

  test("a blank line starts a new paragraph", () => {
    expect(count("one two\n\nthree four").paragraphs).toBe(2);
    expect(count("one two\nstill the same one").paragraphs).toBe(1);
  });

  test("leading and trailing blank lines do not invent paragraphs", () => {
    expect(count("\n\nonly one\n\n").paragraphs).toBe(1);
  });

  test("characters is the document length, newlines included", () => {
    expect(count("ab\ncd").characters).toBe(5);
  });
});

describe("readingMinutes", () => {
  test("nothing to read takes no time", () => {
    expect(readingMinutes(0)).toBe(0);
  });

  test("anything at all rounds up to a minute", () => {
    expect(readingMinutes(1)).toBe(1);
  });

  test("scales at roughly 200 words a minute", () => {
    expect(readingMinutes(400)).toBe(2);
  });
});

describe("recount", () => {
  /** A seeded generator, so a failure replays the same way. */
  function random(seed: number) {
    return () => {
      seed = (seed * 1664525 + 1013904223) % 4294967296;
      return seed / 4294967296;
    };
  }

  test("keeps step with a full count through random edits", async () => {
    const { EditorState } = await import("@codemirror/state");
    const { recount } = await import("../src/lib/documentStats");
    const pieces = ["word ", " ", "\n", "\n\n", "two words", "\t", "x", ""];

    for (const seed of [1, 2, 3, 4]) {
      const next = random(seed);
      let state = EditorState.create({ doc: "first line\n\nsecond paragraph here\nstill it\n\nlast" });
      let tally = { words: countDocument(state.doc).words, paragraphs: countDocument(state.doc).paragraphs };

      for (let step = 0; step < 300; step++) {
        const length = state.doc.length;
        const from = Math.floor(next() * (length + 1));
        const to = Math.min(length, from + Math.floor(next() * 8));
        const insert = pieces[Math.floor(next() * pieces.length)];
        const transaction = state.update({ changes: { from, to: next() < 0.5 ? from : to, insert } });

        tally = recount(state.doc, transaction.state.doc, transaction.changes, tally);
        state = transaction.state;

        const full = countDocument(state.doc);
        expect(tally).toEqual({ words: full.words, paragraphs: full.paragraphs });
      }
    }
  });

  test("an edit that changes nothing changes nothing", async () => {
    const { ChangeSet } = await import("@codemirror/state");
    const { recount } = await import("../src/lib/documentStats");
    const doc = Text.of(["a b"]);
    const tally = { words: 2, paragraphs: 1 };
    expect(recount(doc, doc, ChangeSet.empty(doc.length), tally)).toBe(tally);
  });
});
