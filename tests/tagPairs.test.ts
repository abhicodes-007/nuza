import { describe, expect, test } from "bun:test";
import { Text } from "@codemirror/state";
import type { SyntaxNode } from "@lezer/common";
import { parser } from "@lezer/markdown";
import { pairTags } from "../src/lib/markdown/livePreview";

/** The paragraph holding the inline HTML in `source`, and the doc it came from. */
function paragraph(source: string) {
  const doc = Text.of(source.split("\n"));
  let found: SyntaxNode | null = null;
  parser.parse(source).iterate({
    enter: (node) => {
      if (node.name === "Paragraph" && !found) found = node.node;
    },
  });
  if (!found) throw new Error("no paragraph");
  return { doc, node: found as SyntaxNode };
}

/** Each pair as the source text it spans. */
function spans(source: string) {
  const { doc, node } = paragraph(source);
  return Array.from(pairTags(doc, node), ([from, to]) => doc.sliceString(from, to)).sort();
}

describe("pairTags", () => {
  test("pairs an opener with its closer", () => {
    expect(spans("a <b>bold</b> c")).toEqual(["<b>bold</b>"]);
  });

  test("counts nesting of the same tag", () => {
    expect(spans("<span>a <span>b</span> c</span>")).toEqual([
      "<span>a <span>b</span> c</span>",
      "<span>b</span>",
    ]);
  });

  test("pairs each tag name on its own", () => {
    expect(spans("<b>x <i>y</i></b>")).toEqual(["<b>x <i>y</i></b>", "<i>y</i>"]);
  });

  test("matches tag names regardless of case", () => {
    expect(spans("<B>x</b>")).toEqual(["<B>x</b>"]);
  });

  test("leaves an unclosed opener out", () => {
    expect(spans("<b>never closed and <i>this</i>")).toEqual(["<i>this</i>"]);
  });

  test("skips void and self-closing tags", () => {
    expect(spans("<br> <img src=x/> <b>y</b>")).toEqual(["<b>y</b>"]);
  });

  test("ignores a closer with nothing open", () => {
    expect(spans("</b> <b>y</b>")).toEqual(["<b>y</b>"]);
  });

  test("handles a long run in one pass", () => {
    const run = Array.from({ length: 2000 }, (_, i) => `<b>${i}</b>`).join(" ");
    expect(spans(run)).toHaveLength(2000);
  });
});
