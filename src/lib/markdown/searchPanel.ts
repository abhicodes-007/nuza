import {
  SearchQuery,
  closeSearchPanel,
  findNext,
  findPrevious,
  getSearchQuery,
  replaceAll,
  replaceNext,
  search,
  setSearchQuery,
} from "@codemirror/search";
import { EditorState, Extension } from "@codemirror/state";
import { EditorView, Panel, ViewUpdate } from "@codemirror/view";

/**
 * Find, and replace, in the open note.
 *
 * CodeMirror's own panel is a strip across the bottom of the editor with every
 * option out at once - two text boxes, five buttons, three native checkboxes -
 * most of it for things done a handful of times a year. This one is a single
 * bar floating at the top right of the note: the field, the three ways a match
 * can be narrowed as small toggles inside it, how many matches there are and
 * which one you are on, and the way to the next and previous. Replace is one
 * chevron away, folded until it is wanted.
 */

/** Past this many matches the count stops counting - "1000+" says enough. */
const COUNT_LIMIT = 1000;

const ICONS = {
  chevronRight:
    '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m9 18 6-6-6-6"/></svg>',
  up: '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m18 15-6-6-6 6"/></svg>',
  down: '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>',
  close:
    '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>',
};

/**
 * How many matches `query` has, and which of them - counting from 1 - the
 * selection is exactly on, or 0 when it is on none: the caret before "next"
 * has been pressed, or somewhere else after an edit.
 */
export function matchPosition(state: EditorState, query: SearchQuery) {
  if (!query.search || !query.valid) return { total: 0, current: 0, capped: false };

  const { from, to } = state.selection.main;
  const cursor = query.getCursor(state);
  let total = 0;
  let current = 0;

  for (let next = cursor.next(); !next.done; next = cursor.next()) {
    total++;
    const match = next.value;
    if (!current && match.from === from && match.to === to) current = total;
    if (total >= COUNT_LIMIT) return { total, current, capped: true };
  }
  return { total, current, capped: false };
}

function iconButton(icon: string, label: string, onClick: () => void) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "nz-search-icon";
  button.innerHTML = icon;
  button.title = label;
  button.setAttribute("aria-label", label);
  // Pressed rather than clicked, and kept from taking focus: the field keeps
  // the keyboard, so a click on "next" can be followed by more typing.
  button.addEventListener("mousedown", (event) => event.preventDefault());
  button.addEventListener("click", onClick);
  return button;
}

function toggleButton(text: string, label: string, onToggle: () => void) {
  const button = iconButton("", label, onToggle);
  button.className = "nz-search-toggle";
  button.textContent = text;
  button.setAttribute("aria-pressed", "false");
  return button;
}

function textButton(text: string, label: string, onClick: () => void) {
  const button = iconButton("", label, onClick);
  button.className = "nz-search-text-button";
  button.textContent = text;
  return button;
}

function field(placeholder: string, label: string) {
  const input = document.createElement("input");
  input.className = "nz-search-input";
  input.placeholder = placeholder;
  input.setAttribute("aria-label", label);
  input.spellcheck = false;
  input.autocomplete = "off";
  // Marks it as the field CodeMirror focuses when the panel is asked for again.
  input.setAttribute("main-field", "true");
  return input;
}

function createSearchPanel(view: EditorView): Panel {
  let query = getSearchQuery(view.state);
  let replaceOpen = !!query.replace;

  const dom = document.createElement("div");
  dom.className = "nz-search";
  dom.setAttribute("role", "search");

  const findRow = document.createElement("div");
  findRow.className = "nz-search-row";
  const replaceRow = document.createElement("div");
  replaceRow.className = "nz-search-row nz-search-replace";

  const findField = field("Find in note", "Find");
  const replaceField = field("Replace with", "Replace");
  replaceField.removeAttribute("main-field");

  const count = document.createElement("span");
  count.className = "nz-search-count";
  count.setAttribute("aria-live", "polite");

  function commit(change: Partial<ConstructorParameters<typeof SearchQuery>[0]>) {
    const next = new SearchQuery({
      search: query.search,
      caseSensitive: query.caseSensitive,
      regexp: query.regexp,
      wholeWord: query.wholeWord,
      replace: query.replace,
      ...change,
    });
    if (next.eq(query)) return;
    query = next;
    view.dispatch({ effects: setSearchQuery.of(next) });
  }

  const caseToggle = toggleButton("Aa", "Match case", () => commit({ caseSensitive: !query.caseSensitive }));
  const regexToggle = toggleButton(".*", "Regular expression", () => commit({ regexp: !query.regexp }));
  const wordToggle = toggleButton("W", "Whole word", () => commit({ wholeWord: !query.wholeWord }));

  const expand = iconButton(ICONS.chevronRight, "Show replace", () => {
    replaceOpen = !replaceOpen;
    render();
    (replaceOpen ? replaceField : findField).focus();
  });
  expand.classList.add("nz-search-expand");

  const previous = iconButton(ICONS.up, "Previous match (Shift+Enter)", () => findPrevious(view));
  const next = iconButton(ICONS.down, "Next match (Enter)", () => findNext(view));
  const close = iconButton(ICONS.close, "Close (Esc)", () => closeSearchPanel(view));

  const replaceOne = textButton("Replace", "Replace this match (Enter)", () => replaceNext(view));
  const replaceEvery = textButton("All", "Replace every match (⌘/Ctrl+Enter)", () => replaceAll(view));

  const fieldBox = document.createElement("div");
  fieldBox.className = "nz-search-field";
  const toggles = document.createElement("div");
  toggles.className = "nz-search-toggles";
  toggles.append(caseToggle, regexToggle, wordToggle);
  fieldBox.append(findField, toggles);

  const replaceBox = document.createElement("div");
  replaceBox.className = "nz-search-field";
  replaceBox.append(replaceField);

  findRow.append(expand, fieldBox, count, previous, next, close);
  // A spacer the width of the chevron, so the two fields line up.
  const spacer = document.createElement("span");
  spacer.className = "nz-search-spacer";
  replaceRow.append(spacer, replaceBox, replaceOne, replaceEvery);
  dom.append(findRow, replaceRow);

  findField.addEventListener("input", () => commit({ search: findField.value }));
  replaceField.addEventListener("input", () => commit({ replace: replaceField.value }));

  findField.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      (event.shiftKey ? findPrevious : findNext)(view);
    } else if (event.key === "Escape") {
      event.preventDefault();
      closeSearchPanel(view);
    }
  });
  replaceField.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      (event.metaKey || event.ctrlKey ? replaceAll : replaceNext)(view);
    } else if (event.key === "Escape") {
      event.preventDefault();
      closeSearchPanel(view);
    }
  });

  function render(state: EditorState = view.state) {
    if (findField.value !== query.search) findField.value = query.search;
    if (replaceField.value !== query.replace) replaceField.value = query.replace;

    for (const [button, on] of [
      [caseToggle, query.caseSensitive],
      [regexToggle, query.regexp],
      [wordToggle, query.wholeWord],
    ] as const) {
      button.setAttribute("aria-pressed", String(on));
    }

    replaceRow.hidden = !replaceOpen;
    expand.setAttribute("aria-expanded", String(replaceOpen));
    expand.title = replaceOpen ? "Hide replace" : "Show replace";

    const invalid = !!query.search && !query.valid;
    fieldBox.classList.toggle("nz-search-invalid", invalid);

    const { total, current, capped } = matchPosition(state, query);
    const empty = !query.search;
    count.textContent = empty
      ? ""
      : invalid
        ? "Invalid"
        : total === 0
          ? "No results"
          : `${current || "–"} of ${total}${capped ? "+" : ""}`;
    count.classList.toggle("nz-search-none", !empty && total === 0);

    for (const button of [previous, next, replaceOne, replaceEvery]) button.disabled = total === 0;
  }

  render();

  return {
    dom,
    top: true,
    mount() {
      findField.focus();
      findField.select();
    },
    update(update: ViewUpdate) {
      const latest = getSearchQuery(update.state);
      const queryChanged = !latest.eq(query);
      if (queryChanged) {
        query = latest;
        if (query.replace) replaceOpen = true;
      }
      if (queryChanged || update.docChanged || update.selectionSet) render(update.state);
    },
  };
}

/** The panel's look: a floating bar, drawn from the app's own colours so it follows the theme. */
const searchTheme = EditorView.theme({
  /* The panel strip itself steps out of the way, so the bar floats over the
     note rather than pushing it down. */
  ".cm-panels.cm-panels-top": {
    position: "absolute",
    top: "10px",
    right: "18px",
    left: "auto",
    zIndex: "30",
    background: "none",
    border: "none",
  },
  ".nz-search": {
    width: "min(420px, calc(100vw - 48px))",
    padding: "6px",
    borderRadius: "12px",
    border: "1px solid var(--nuza-hairline)",
    background: "var(--nuza-bg)",
    boxShadow: "0 12px 32px rgba(0, 0, 0, 0.28), 0 2px 6px rgba(0, 0, 0, 0.18)",
    fontFamily: "Inter, system-ui, sans-serif",
    fontSize: "13px",
    color: "var(--nuza-fg)",
    display: "flex",
    flexDirection: "column",
    gap: "6px",
    animation: "nz-search-in 140ms ease-out",
  },
  "@keyframes nz-search-in": {
    from: { opacity: "0", transform: "translateY(-4px)" },
    to: { opacity: "1", transform: "none" },
  },
  ".nz-search-row": { display: "flex", alignItems: "center", gap: "4px" },
  ".nz-search-row[hidden]": { display: "none" },
  ".nz-search-field": {
    flex: "1",
    minWidth: "0",
    display: "flex",
    alignItems: "center",
    height: "32px",
    padding: "0 4px 0 10px",
    borderRadius: "8px",
    border: "1px solid var(--nuza-hairline)",
    background: "var(--nuza-surface)",
    transition: "border-color 120ms ease",
  },
  ".nz-search-field:focus-within": { borderColor: "var(--nuza-accent-line)" },
  ".nz-search-field.nz-search-invalid": { borderColor: "rgba(248, 113, 113, 0.6)" },
  ".nz-search-input": {
    flex: "1",
    minWidth: "0",
    border: "none",
    outline: "none",
    background: "transparent",
    color: "var(--nuza-heading)",
    font: "inherit",
    fontSize: "13.5px",
  },
  ".nz-search-input::placeholder": { color: "var(--nuza-muted)" },
  ".nz-search-toggles": { display: "flex", gap: "2px", marginLeft: "4px" },
  ".nz-search-toggle": {
    minWidth: "24px",
    height: "22px",
    padding: "0 5px",
    border: "none",
    borderRadius: "5px",
    background: "transparent",
    color: "var(--nuza-muted)",
    font: "600 11.5px ui-monospace, SFMono-Regular, Menlo, monospace",
    cursor: "pointer",
    transition: "background-color 120ms ease, color 120ms ease",
  },
  ".nz-search-toggle:hover": { color: "var(--nuza-fg)", background: "var(--nuza-surface-strong)" },
  ".nz-search-toggle[aria-pressed=true]": {
    color: "var(--nuza-accent)",
    background: "var(--nuza-accent-wash)",
  },
  ".nz-search-count": {
    minWidth: "62px",
    padding: "0 6px",
    textAlign: "center",
    fontSize: "12px",
    color: "var(--nuza-muted)",
    fontVariantNumeric: "tabular-nums",
    whiteSpace: "nowrap",
  },
  ".nz-search-count.nz-search-none": { color: "rgba(248, 113, 113, 0.9)" },
  ".nz-search-icon": {
    width: "28px",
    height: "28px",
    flexShrink: "0",
    display: "grid",
    placeItems: "center",
    border: "none",
    borderRadius: "7px",
    background: "transparent",
    color: "var(--nuza-muted)",
    cursor: "pointer",
    transition: "background-color 120ms ease, color 120ms ease",
  },
  ".nz-search-icon:hover:not(:disabled)": {
    color: "var(--nuza-heading)",
    background: "var(--nuza-surface-strong)",
  },
  ".nz-search-icon:disabled, .nz-search-text-button:disabled": { opacity: "0.35", cursor: "default" },
  ".nz-search-expand svg": { transition: "transform 140ms ease" },
  ".nz-search-expand[aria-expanded=true] svg": { transform: "rotate(90deg)" },
  ".nz-search-spacer": { width: "28px", flexShrink: "0" },
  ".nz-search-text-button": {
    height: "32px",
    padding: "0 12px",
    flexShrink: "0",
    border: "1px solid var(--nuza-hairline)",
    borderRadius: "8px",
    background: "var(--nuza-surface)",
    color: "var(--nuza-fg)",
    font: "inherit",
    fontSize: "12.5px",
    cursor: "pointer",
    transition: "background-color 120ms ease, border-color 120ms ease",
  },
  ".nz-search-text-button:hover:not(:disabled)": {
    borderColor: "var(--nuza-accent-line)",
    background: "var(--nuza-surface-strong)",
  },
});

/** Find and replace: the panel, opened by the usual mod+f. */
export const findInNote: Extension = [search({ top: true, createPanel: createSearchPanel }), searchTheme];
