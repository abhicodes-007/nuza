import { describe, expect, test } from "bun:test";
import { Text } from "@codemirror/state";
import { frontmatterInsertion, frontmatterRange, readFrontmatter } from "../src/lib/markdown/frontmatter";

const doc = (text: string) => Text.of(text.split("\n"));

describe("frontmatterInsertion", () => {
  test("starts a block above a note's text, with a blank line after it", () => {
    expect(frontmatterInsertion(doc("# Title\n\nbody"))).toBe("---\nkey: \n---\n\n");
  });

  test("adds no second blank line when the note starts with one", () => {
    expect(frontmatterInsertion(doc("\nbody"))).toBe("---\nkey: \n---\n");
  });

  test("fills an empty note with just the block", () => {
    expect(frontmatterInsertion(doc(""))).toBe("---\nkey: \n---\n");
  });

  test("is not offered when the note already has a block", () => {
    expect(frontmatterInsertion(doc("---\ntitle: x\n---\n\nbody"))).toBeNull();
  });

  test("is offered above a rule that only looks like an opening fence", () => {
    expect(frontmatterInsertion(doc("---\n\nbody"))).not.toBeNull();
  });

  test("gives a block that reads back as one property", () => {
    const note = "# Title\nbody";
    const result = doc(`${frontmatterInsertion(doc(note))}${note}`);
    const range = frontmatterRange(result);
    expect(range).not.toBeNull();
    expect(readFrontmatter(result, range!)?.map((property) => property.key)).toEqual(["key"]);
    expect(result.line(range!.closingLine + 1).text).toBe("");
  });
});
