import { describe, expect, test } from "bun:test";
import { markdown } from "@codemirror/lang-markdown";
import { EditorState } from "@codemirror/state";
import { GFM } from "@lezer/markdown";
import { findHeading, headingSlug, readHeadings } from "../src/lib/markdown/headings";

function headings(doc: string) {
  return readHeadings(EditorState.create({ doc, extensions: [markdown({ extensions: GFM })] }));
}

describe("readHeadings", () => {
  test("reads each level, in order, with where its line starts", () => {
    const doc = "# One\n\ntext\n\n## Two\n### Three ###\n";
    expect(headings(doc)).toEqual([
      { level: 1, text: "One", from: 0 },
      { level: 2, text: "Two", from: doc.indexOf("## Two") },
      { level: 3, text: "Three", from: doc.indexOf("### Three") },
    ]);
  });

  test("reads underlined headings", () => {
    expect(headings("Title\n=====\n\nSub\n---\n").map((h) => [h.level, h.text])).toEqual([
      [1, "Title"],
      [2, "Sub"],
    ]);
  });

  test("reads a heading as it is shown, without its markup", () => {
    expect(headings("## A **bold** [link](https://x.y) and [[note|alias]] `code`\n")[0].text).toBe(
      "A bold link and alias code"
    );
  });

  test("leaves out what only looks like a heading", () => {
    expect(headings("```\n# not a heading\n```\n\n#nospace\n")).toEqual([]);
  });
});

describe("headingSlug", () => {
  test("lower-cases, drops punctuation and hyphenates", () => {
    expect(headingSlug("My Heading, Part 2!")).toBe("my-heading-part-2");
  });

  test("keeps letters of any script", () => {
    expect(headingSlug("Überblick  über")).toBe("überblick-über");
  });
});

describe("findHeading", () => {
  const found = headings("# Intro\n\n## Setup Steps\n\n## Setup Steps\n");

  test("finds a heading by its text, ignoring case and spacing", () => {
    expect(findHeading(found, "  setup   STEPS ")?.level).toBe(2);
  });

  test("finds a heading by its anchor", () => {
    expect(findHeading(found, "setup-steps")?.text).toBe("Setup Steps");
  });

  test("takes the first where several match", () => {
    expect(findHeading(found, "Setup Steps")).toBe(found[1]);
  });

  test("finds nothing for a heading that is not there, or an empty one", () => {
    expect(findHeading(found, "Missing")).toBeNull();
    expect(findHeading(found, "  ")).toBeNull();
  });
});
