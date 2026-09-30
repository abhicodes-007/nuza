import { EditorView } from "@codemirror/view";
import { frontmatterInsertion, frontmatterRange } from "./frontmatter";

/** Whether the note in `view` has no properties block to add one to. */
export function canAddFrontmatter(view: EditorView) {
  return frontmatterInsertion(view.state.doc) !== null;
}

/**
 * Starts a properties block at the top of the note and puts the caret in its
 * first key, the way "+ Add property" does for a block that already exists.
 */
export function addFrontmatter(view: EditorView) {
  const insert = frontmatterInsertion(view.state.doc);
  if (insert === null) return false;

  view.dispatch({
    changes: { from: 0, insert },
    effects: EditorView.scrollIntoView(0, { y: "start" }),
    userEvent: "input",
  });

  // The fields only exist once the editor has drawn the block.
  requestAnimationFrame(() => {
    const key = view.dom.querySelector<HTMLInputElement>(".cm-md-prop-key");
    key?.focus();
    key?.select();
  });
  return true;
}

/**
 * Adds a property to the block the note already has and puts the caret in its
 * key - what "+ Add property" under the block does, from the editor's menu.
 */
export function addProperty(view: EditorView) {
  const range = frontmatterRange(view.state.doc);
  if (!range) return false;

  const at = view.state.doc.line(range.closingLine).from;
  view.dispatch({
    changes: { from: at, insert: "key: \n" },
    effects: EditorView.scrollIntoView(0, { y: "start" }),
    userEvent: "input",
  });

  // The new row only exists once the editor has drawn it.
  requestAnimationFrame(() => {
    const keys = view.dom.querySelectorAll<HTMLInputElement>(".cm-md-prop-key");
    const last = keys[keys.length - 1];
    last?.focus();
    last?.select();
  });
  return true;
}
