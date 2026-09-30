import { EditorView } from "@codemirror/view";
import { frontmatterInsertion } from "./frontmatter";

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
