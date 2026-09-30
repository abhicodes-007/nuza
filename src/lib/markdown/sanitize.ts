import { resolveImageSource, safeExternalHref } from "./sources";

/**
 * A note is a file on disk that anything could have written, and the editor
 * runs inside a WebView with Tauri's API on `window`. So HTML from a note is
 * never handed to `innerHTML`: it is parsed into an inert document, then a
 * fresh copy is built from the tags and attributes on these lists. Anything
 * not named here - `<script>`, `<iframe>`, every `on*` handler - is dropped
 * rather than escaped, so a tag that is not understood simply does not appear.
 */
const ALLOWED_TAGS = new Set([
  // Allowed, but never as an anchor - see sanitizeElement.
  "a",
  "abbr",
  "audio",
  "b",
  "big",
  "blockquote",
  "br",
  "caption",
  "cite",
  "code",
  "col",
  "colgroup",
  "dd",
  "del",
  "details",
  "dfn",
  "div",
  "dl",
  "dt",
  "em",
  "figcaption",
  "figure",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "hr",
  "i",
  "img",
  "ins",
  "kbd",
  "li",
  "mark",
  "ol",
  "p",
  "picture",
  "pre",
  "q",
  "s",
  "samp",
  "section",
  "small",
  "source",
  "span",
  "strong",
  "sub",
  "summary",
  "sup",
  "table",
  "tbody",
  "td",
  "tfoot",
  "th",
  "thead",
  "time",
  "tr",
  "u",
  "ul",
  "video",
  "wbr",
]);

const ALLOWED_ATTRIBUTES = new Set([
  "align",
  "alt",
  "class",
  "cite",
  "colspan",
  "controls",
  "datetime",
  "dir",
  "height",
  "href",
  "lang",
  "loop",
  "muted",
  "open",
  "poster",
  "reversed",
  "rowspan",
  "span",
  "src",
  "start",
  "style",
  "title",
  "type",
  "width",
]);

/** Attributes holding a URL, which have to clear the scheme check as well. */
const URL_ATTRIBUTES = new Set(["href", "src", "poster"]);

/**
 * Properties a note may set on its own HTML.
 *
 * Inline CSS cannot run script, but it can lift an element out of the flow and
 * cover the window - `position:fixed;inset:0` over the editor, with the note's
 * own content on top of it. This used to be a pattern match for the properties
 * worth worrying about, which is the wrong way round twice over. It missed
 * `transform`, `inset`, `z-index` and a negative `margin`, all of which move an
 * element just as well as `position` does; and the match itself could be walked
 * past, because a style attribute may carry CSS comments, and a declaration
 * opening with an empty one does not begin where the pattern expected it to.
 *
 * So the names are listed instead. Anything not here does not survive, whatever
 * it is spelled like, and a property that ought to be allowed is one line to
 * add. Nothing that sizes, places or layers an element is on the list.
 */
const SAFE_PROPERTIES = new Set([
  "background-color",
  "border",
  "border-bottom",
  "border-collapse",
  "border-color",
  "border-left",
  "border-radius",
  "border-right",
  "border-spacing",
  "border-style",
  "border-top",
  "border-width",
  "color",
  "font-family",
  "font-size",
  "font-style",
  "font-variant",
  "font-weight",
  "letter-spacing",
  "line-height",
  "list-style-type",
  "padding",
  "padding-bottom",
  "padding-left",
  "padding-right",
  "padding-top",
  "text-align",
  "text-decoration",
  "text-transform",
  "vertical-align",
  "white-space",
  "word-break",
]);

/**
 * A value that reaches outside the note even on a property that is allowed:
 * `url()` and `@import` fetch, and a backslash or a comment is how a value gets
 * written as something other than what it reads as.
 */
const UNSAFE_VALUE = /url\s*\(|expression\s*\(|@import|javascript:|\\|\/\*/i;

/**
 * The declarations of `value` that are allowed, or `null` if none are - in
 * which case the attribute is left off entirely rather than set to "".
 *
 * Split by hand rather than by handing the string to the browser: a parser that
 * understands CSS comments and escapes is a parser that can be talked into
 * disagreeing with the one that reads the result. Splitting on `;` and the
 * first `:` can only ever produce a property name that is not on the list,
 * which is dropped.
 */
function sanitizeStyle(value: string) {
  const kept: string[] = [];

  for (const declaration of value.split(";")) {
    const colon = declaration.indexOf(":");
    if (colon === -1) continue;

    const property = declaration.slice(0, colon).trim().toLowerCase();
    const setting = declaration.slice(colon + 1).trim();

    if (!SAFE_PROPERTIES.has(property)) continue;
    if (!setting || UNSAFE_VALUE.test(setting)) continue;

    kept.push(`${property}: ${setting}`);
  }

  return kept.length ? kept.join("; ") : null;
}

function sanitizeUrl(name: string, value: string, directory: string) {
  if (name === "href") return safeExternalHref(value);
  return resolveImageSource(value, directory);
}

/**
 * The class a link wears, and the attribute the editor's link handler reads.
 * Both are the markdown path's, deliberately: a link from raw HTML should be
 * the same thing as a link written the ordinary way.
 */
const LINK_CLASS = "cm-md-link";
const LINK_HREF = "data-href";

function sanitizeElement(element: Element, directory: string) {
  const tag = element.tagName.toLowerCase();
  if (!ALLOWED_TAGS.has(tag)) return null;

  /**
   * An anchor is rebuilt as a span.
   *
   * The webview has nowhere to navigate back from: a plain click on a real
   * anchor replaces the running app with the remote page, taking the editor,
   * every unsaved buffer and the undo history with it. Markdown links never
   * had this problem - they are rendered as `span[data-href]` and opened in
   * the browser on mod-click - so a link arriving as HTML is given that same
   * shape and picked up by the same handler.
   */
  const isLink = tag === "a";
  const clean = document.createElement(isLink ? "span" : tag);

  for (const attribute of Array.from(element.attributes)) {
    const name = attribute.name.toLowerCase();
    if (!ALLOWED_ATTRIBUTES.has(name)) continue;
    // The class is the app's to set on a link, not the note's.
    if (isLink && name === "class") continue;

    let value: string | null = attribute.value;
    if (name === "style") value = sanitizeStyle(value);
    else if (URL_ATTRIBUTES.has(name)) value = sanitizeUrl(name, value, directory);
    if (value === null) continue;

    clean.setAttribute(isLink && name === "href" ? LINK_HREF : name, value);
  }

  // Only ever a link if it has somewhere to go: an href the scheme check threw
  // out leaves the text behind as text, rather than as something that looks
  // clickable and is not.
  if (isLink && clean.hasAttribute(LINK_HREF)) clean.className = LINK_CLASS;

  return clean;
}

function sanitizeNode(node: Node, directory: string): Node | null {
  if (node.nodeType === Node.TEXT_NODE) return document.createTextNode(node.nodeValue ?? "");
  if (node.nodeType !== Node.ELEMENT_NODE) return null;

  const clean = sanitizeElement(node as Element, directory);
  if (!clean) return null;

  for (const child of Array.from(node.childNodes)) {
    const cleanChild = sanitizeNode(child, directory);
    if (cleanChild) clean.appendChild(cleanChild);
  }

  return clean;
}

/**
 * Turns a run of HTML from a note into DOM that is safe to insert. Parsing
 * happens in a document that never runs anything, and only the rebuilt copy
 * reaches the page. `src` paths are resolved against the note's own directory,
 * so `<img src="diagram.png">` works the same as the markdown spelling.
 */
export function sanitizeHtml(html: string, directory: string) {
  const parsed = new DOMParser().parseFromString(html, "text/html");
  const fragment = document.createDocumentFragment();

  for (const child of Array.from(parsed.body.childNodes)) {
    const clean = sanitizeNode(child, directory);
    if (clean) fragment.appendChild(clean);
  }

  return fragment;
}

/** Whether any of this HTML survives sanitising - if not, leave the source alone. */
export function rendersAnything(fragment: DocumentFragment) {
  return (
    fragment.childNodes.length > 0 && (fragment.textContent?.trim() !== "" || !!fragment.querySelector("*"))
  );
}

/**
 * Sanitised runs, by directory and source, most recently used last. A
 * template is never inserted itself - `renderHtml` hands out copies - and
 * null records a run with nothing left in it once sanitised.
 */
const templates = new Map<string, DocumentFragment | null>();
const TEMPLATE_LIMIT = 128;

function templateFor(html: string, directory: string) {
  const key = `${directory}\u0000${html}`;
  let template = templates.get(key);

  if (template === undefined) {
    const fragment = sanitizeHtml(html, directory);
    template = rendersAnything(fragment) ? fragment : null;
    if (templates.size >= TEMPLATE_LIMIT) templates.delete(templates.keys().next().value as string);
  } else {
    templates.delete(key);
  }

  templates.set(key, template);
  return template;
}

/**
 * Whether a run of HTML renders to anything, answered from the same parse
 * `renderHtml` will draw from - the decoration build asks this for every run
 * it passes, and the widget it then creates needs the fragment straight after.
 */
export function rendersHtml(html: string, directory: string) {
  return templateFor(html, directory) !== null;
}

/** A fresh copy of the sanitised DOM for a run of HTML, ready to insert. */
export function renderHtml(html: string, directory: string) {
  const template = templateFor(html, directory);
  return template ? (template.cloneNode(true) as DocumentFragment) : document.createDocumentFragment();
}
