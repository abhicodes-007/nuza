import { describe, expect, test } from "bun:test";
import { markdown } from "@codemirror/lang-markdown";
import { ensureSyntaxTree } from "@codemirror/language";
import { Compartment, EditorSelection, EditorState } from "@codemirror/state";
import { GFM } from "@lezer/markdown";
import { liveMarkdownPreview } from "../src/lib/markdown/livePreview";
import { MathWidget } from "../src/lib/markdown/widgets";
import { MathSyntax, inlineMathEnd, mathSource } from "../src/lib/markdown/math";

/** The math spans the editor's parser finds, as written, in document order. */
function spans(doc: string) {
  const state = EditorState.create({ doc, extensions: [markdown({ extensions: [GFM, MathSyntax] })] });
  const tree = ensureSyntaxTree(state, doc.length, 5000)!;
  const found: string[] = [];
  tree.iterate({
    enter(node) {
      if (node.name === "InlineMath" || node.name === "BlockMath") {
        found.push(`${node.name}:${doc.slice(node.from, node.to)}`);
      }
    },
  });
  return found;
}

describe("inline math", () => {
  test("finds a span in prose", () => {
    expect(spans("so $x^2$ and $\\frac{a}{b}$ here")).toEqual([
      "InlineMath:$x^2$",
      "InlineMath:$\\frac{a}{b}$",
    ]);
  });

  test("prices are not math", () => {
    expect(spans("it cost $5 and then $10 more")).toEqual([]);
    expect(spans("$5 and $10")).toEqual([]);
  });

  test("a closing dollar followed by a digit does not close", () => {
    expect(spans("$a$1 and $b$")).toEqual(["InlineMath:$a$1 and $b$"]);
  });

  test("needs a character beside each dollar", () => {
    expect(spans("$ x$ and $x $ and more")).toEqual([]);
  });

  test("an escaped dollar is not a delimiter", () => {
    expect(spans("\\$x\\$ and $a\\$b$")).toEqual(["InlineMath:$a\\$b$"]);
  });

  test("stays on one line", () => {
    expect(spans("$x\ny$")).toEqual([]);
  });

  test("code is left alone", () => {
    expect(spans("`$x$` and\n\n```\n$y$\n```")).toEqual([]);
  });

  test("a double-dollar span in a sentence", () => {
    expect(spans("see $$x+y$$ there")).toEqual(["InlineMath:$$x+y$$"]);
  });

  test("underscores and stars inside are not emphasis", () => {
    expect(spans("$a_1 * b_2$")).toEqual(["InlineMath:$a_1 * b_2$"]);
  });
});

describe("block math", () => {
  test("finds a multi-line block", () => {
    const doc = "before\n\n$$\n\\int_0^1 x\\,dx\n$$\n\nafter";
    expect(spans(doc)).toEqual(["BlockMath:$$\n\\int_0^1 x\\,dx\n$$"]);
  });

  test("finds a one-line block", () => {
    expect(spans("$$ E = mc^2 $$")).toEqual(["BlockMath:$$ E = mc^2 $$"]);
  });

  test("an unclosed block is not one", () => {
    expect(spans("$$\nx\n\nnot math at all")).toEqual([]);
    expect(spans("$$\nx = 1")).toEqual([]);
  });

  test("does not take the rest of the note", () => {
    expect(spans("$$\nunclosed\n\n$a$ is fine")).toEqual(["InlineMath:$a$"]);
  });

  test("a block can sit in a list", () => {
    expect(spans("- item\n\n  $$ x $$")).toEqual(["BlockMath:$$ x $$"]);
  });
});

describe("the TeX inside", () => {
  test("loses its delimiters and the space around it", () => {
    expect(mathSource("$x^2$")).toBe("x^2");
    expect(mathSource("$$ E = mc^2 $$")).toBe("E = mc^2");
    expect(mathSource("$$\n\\sum_i i\n$$")).toBe("\\sum_i i");
  });

  test("finds where a span ends", () => {
    expect(inlineMathEnd("$a$ b")).toBe(3);
    expect(inlineMathEnd("$a b")).toBe(-1);
  });
});

describe("math in the live preview", () => {
  const preview = new Compartment();

  /** The math widgets drawn for `doc` with the caret at `cursor`: their TeX and whether they are blocks. */
  function drawn(doc: string, cursor: number) {
    let state = EditorState.create({
      doc,
      extensions: [markdown({ extensions: [GFM, MathSyntax] }), preview.of([])],
      selection: EditorSelection.cursor(cursor),
    });
    ensureSyntaxTree(state, doc.length, 5000);
    state = state.update({ effects: preview.reconfigure(liveMarkdownPreview) }).state;

    const widgets: [string, boolean][] = [];
    state.field(liveMarkdownPreview).between(0, doc.length, (_from, _to, value) => {
      const widget = value.spec.widget;
      if (widget instanceof MathWidget) widgets.push([widget.tex, widget.block]);
    });
    return widgets;
  }

  test("an inline span is drawn when the caret is elsewhere", () => {
    expect(drawn("plain\n\nso $x^2$ here", 0)).toEqual([["x^2", false]]);
  });

  test("it opens up to its source when the caret is on its line", () => {
    expect(drawn("so $x^2$ here", 5)).toEqual([]);
  });

  test("a block is drawn when the caret is elsewhere", () => {
    const doc = "intro\n\n$$\n\\int x\n$$\n\nafter";
    expect(drawn(doc, 0)).toEqual([["\\int x", true]]);
    expect(drawn(doc, doc.indexOf("\\int") + 2)).toEqual([]);
  });
});
