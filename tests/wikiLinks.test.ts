import { describe, expect, test } from "bun:test";
import { GFM, parser } from "@lezer/markdown";
import { WikiLink, readWikiLink, resolveWikiLink } from "../src/lib/markdown/wikiLinks";

const markdown = parser.configure([GFM, WikiLink]);

/** The source of every wiki-link the parser finds in `text`. */
function links(text: string) {
  const found: string[] = [];
  markdown.parse(text).iterate({
    enter: (node) => {
      if (node.name === "WikiLink") found.push(text.slice(node.from, node.to));
    },
  });
  return found;
}

describe("the WikiLink parser", () => {
  test("finds a link by name, by path, and with a label", () => {
    expect(links("see [[Ideas]], [[notes/todo]] and [[Ideas|my ideas]].")).toEqual([
      "[[Ideas]]",
      "[[notes/todo]]",
      "[[Ideas|my ideas]]",
    ]);
  });

  test("leaves ordinary links alone", () => {
    expect(links("a [link](https://x.y) and [ref]")).toEqual([]);
  });

  test("needs something between the brackets, and both closing brackets", () => {
    expect(links("[[]] and [[open] and [[a\nb]]")).toEqual([]);
  });

  test("does not look inside code", () => {
    expect(links("`[[not a link]]`")).toEqual([]);
  });
});

describe("readWikiLink", () => {
  test("splits the target, heading and label", () => {
    expect(readWikiLink("Ideas#Later|some ideas")).toEqual({
      target: "Ideas",
      heading: "Later",
      label: "some ideas",
    });
    expect(readWikiLink(" Ideas ")).toEqual({ target: "Ideas", heading: null, label: null });
  });
});

describe("resolveWikiLink", () => {
  const root = "/vault";
  const notes = ["/vault/Ideas.md", "/vault/work/ideas.md", "/vault/work/deep/todo.md", "/vault/todo.md"];

  test("matches a name regardless of case and .md", () => {
    expect(resolveWikiLink("TODO.md", ["/vault/work/deep/todo.md"], root, "/vault")).toBe(
      "/vault/work/deep/todo.md"
    );
  });

  test("prefers the note beside the linking one, then the one nearest the root", () => {
    expect(resolveWikiLink("ideas", notes, root, "/vault/work")).toBe("/vault/work/ideas.md");
    expect(resolveWikiLink("ideas", notes, root, "/vault/elsewhere")).toBe("/vault/Ideas.md");
    expect(resolveWikiLink("todo", notes, root, "/vault/work")).toBe("/vault/todo.md");
  });

  test("matches a path from the vault's root exactly", () => {
    expect(resolveWikiLink("work/deep/todo", notes, root, "/vault")).toBe("/vault/work/deep/todo.md");
    expect(resolveWikiLink("deep/todo", notes, root, "/vault")).toBeNull();
  });

  test("works with Windows paths", () => {
    expect(resolveWikiLink("work/ideas", ["C:\\vault\\work\\ideas.md"], "C:\\vault", "C:\\vault")).toBe(
      "C:\\vault\\work\\ideas.md"
    );
  });

  test("finds nothing for a note that is not there", () => {
    expect(resolveWikiLink("missing", notes, root, "/vault")).toBeNull();
    expect(resolveWikiLink("  ", notes, root, "/vault")).toBeNull();
  });
});
