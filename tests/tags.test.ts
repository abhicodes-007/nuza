import { describe, expect, test } from "bun:test";
import { markdown } from "@codemirror/lang-markdown";
import { ensureSyntaxTree } from "@codemirror/language";
import { EditorState } from "@codemirror/state";
import { GFM } from "@lezer/markdown";
import { Tag, tagAfterHash } from "../src/lib/markdown/tags";

/** The tags the editor's parser finds, as written, without their `#`. */
function tags(doc: string) {
  const state = EditorState.create({ doc, extensions: [markdown({ extensions: [GFM, Tag] })] });
  const tree = ensureSyntaxTree(state, doc.length, 5000)!;
  const found: string[] = [];
  tree.iterate({
    enter(node) {
      if (node.name === "Tag") found.push(doc.slice(node.from + 1, node.to));
    },
  });
  return found;
}

// The same cases as the tests in src-tauri/src/tags.rs: the two readers are
// meant to agree, and these are where they would be seen not to.
describe("tags in the editor", () => {
  test("finds tags in prose", () => {
    expect(tags("a #one and #two_2 and #three-3")).toEqual(["one", "two_2", "three-3"]);
  });

  test("finds a tag that starts the line or a list item", () => {
    expect(tags("#first\n\n- #second")).toEqual(["first", "second"]);
  });

  test("a heading is not a tag", () => {
    expect(tags("# Heading\n\n## Another\n\n###### Deep")).toEqual([]);
  });

  test("a number is not a tag", () => {
    expect(tags("see #123 and #2024-05 and #1a")).toEqual(["2024-05", "1a"]);
  });

  test("needs a boundary before the hash", () => {
    expect(tags("https://example.com#section and a#b and &#39; and ##x")).toEqual([]);
  });

  test("heading links are not tags", () => {
    expect(tags("[text](#heading) and [[note#heading]] and [[#heading]]")).toEqual([]);
  });

  test("a hash with nothing after it is nothing", () => {
    expect(tags("# \n\n#\n\n a # b #")).toEqual([]);
  });

  test("stops at the end of the word", () => {
    expect(tags("#tag, #tag. #tag) #tag!")).toEqual(["tag", "tag", "tag", "tag"]);
  });

  test("leaves out inline code", () => {
    expect(tags("`#no` #yes ``a ` #no`` #yes2")).toEqual(["yes", "yes2"]);
  });

  test("leaves out fenced and indented code", () => {
    expect(tags("#before\n\n```sh\n#!/bin/sh\n#include\n```\n\n#after\n\n    #no\n\n#end")).toEqual([
      "before",
      "after",
      "end",
    ]);
  });

  test("reads tags in any script", () => {
    expect(tags("日本語 #tag café #café #日本語")).toEqual(["tag", "café", "日本語"]);
  });
});

describe("tagAfterHash", () => {
  test("takes the longest run of tag characters", () => {
    expect(tagAfterHash("", "tag more")).toBe("tag");
  });

  test("wants whitespace, or nothing, before the hash", () => {
    expect(tagAfterHash(" ", "tag")).toBe("tag");
    expect(tagAfterHash("\t", "tag")).toBe("tag");
    expect(tagAfterHash("a", "tag")).toBeNull();
    expect(tagAfterHash("(", "tag")).toBeNull();
  });

  test("wants something that is not only digits", () => {
    expect(tagAfterHash("", "123")).toBeNull();
    expect(tagAfterHash("", "-")).toBe("-");
    expect(tagAfterHash("", "")).toBeNull();
  });
});
