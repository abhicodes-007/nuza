import { beforeAll, describe, expect, test } from "bun:test";
import { Window } from "happy-dom";

// The sanitiser's whole job is rebuilding DOM, so it needs one to rebuild
// into. happy-dom is the document here; in the app it is the webview's.
beforeAll(() => {
  const window = new Window();
  globalThis.document = window.document as unknown as Document;
  globalThis.DOMParser = window.DOMParser as unknown as typeof DOMParser;
  globalThis.Node = window.Node as unknown as typeof Node;
});

/** The sanitised HTML, as markup, for asserting against. */
async function sanitize(html: string, directory = "/vault/notes") {
  const { sanitizeHtml } = await import("../src/lib/markdown/sanitize");
  const wrapper = document.createElement("div");
  wrapper.appendChild(sanitizeHtml(html, directory));
  return wrapper;
}

describe("links", () => {
  // The reason this file exists: a real anchor in the webview has nowhere to
  // come back from. A click on one used to replace the whole app with the
  // remote page, unsaved buffers and all.
  test("an anchor is rebuilt as the span the editor's link handler reads", async () => {
    const clean = await sanitize('<a href="https://example.com">click me</a>');

    expect(clean.querySelector("a")).toBeNull();
    const link = clean.querySelector("span");
    expect(link?.getAttribute("data-href")).toBe("https://example.com");
    expect(link?.className).toBe("cm-md-link");
    expect(link?.textContent).toBe("click me");
  });

  test("a link with no usable href is left as plain text", async () => {
    const clean = await sanitize('<a href="javascript:alert(1)">click me</a>');

    expect(clean.querySelector("[data-href]")).toBeNull();
    expect(clean.querySelector(".cm-md-link")).toBeNull();
    expect(clean.textContent).toBe("click me");
  });

  test("the note cannot dress something else up as a link", async () => {
    const clean = await sanitize('<a class="cm-md-task" href="www.example.com">x</a>');
    const link = clean.querySelector("span");

    expect(link?.className).toBe("cm-md-link");
    // A bare domain is still a link, and still only opened deliberately.
    expect(link?.getAttribute("data-href")).toBe("https://www.example.com");
  });

  test("nested content survives the rewrite", async () => {
    const clean = await sanitize('<a href="https://example.com"><strong>bold</strong> link</a>');

    expect(clean.querySelector("span strong")?.textContent).toBe("bold");
    expect(clean.querySelector("span")?.getAttribute("data-href")).toBe("https://example.com");
  });
});

describe("tags", () => {
  test("a tag that is not on the list does not appear", async () => {
    const clean = await sanitize("<script>alert(1)</script><p>after</p>");

    expect(clean.querySelector("script")).toBeNull();
    expect(clean.querySelector("p")?.textContent).toBe("after");
  });

  test("an iframe is dropped, contents and all", async () => {
    const clean = await sanitize('<iframe src="https://example.com"></iframe>');

    expect(clean.querySelector("iframe")).toBeNull();
    expect(clean.childNodes.length).toBe(0);
  });
});

describe("attributes", () => {
  test("event handlers are not attributes anything keeps", async () => {
    const clean = await sanitize('<p onclick="alert(1)" title="kept">text</p>');
    const paragraph = clean.querySelector("p");

    expect(paragraph?.getAttribute("onclick")).toBeNull();
    expect(paragraph?.getAttribute("title")).toBe("kept");
  });

  test("a style that lifts an element out of the flow is dropped", async () => {
    const clean = await sanitize('<div style="position: fixed; top: 0">x</div>');

    expect(clean.querySelector("div")?.getAttribute("style")).toBeNull();
  });

  test("ordinary styling is left alone", async () => {
    const clean = await sanitize('<div style="color: red">x</div>');

    expect(clean.querySelector("div")?.getAttribute("style")).toBe("color: red");
  });
});

describe("inline styles", () => {
  /** The style attribute the sanitiser left on the only element. */
  async function styleOf(html: string) {
    const clean = await sanitize(html);
    const element = clean.firstElementChild;
    // Otherwise a test that lost its element to the parser reads as a pass.
    if (!element) throw new Error(`nothing survived: ${html}`);
    return element.getAttribute("style");
  }

  // A style attribute may carry CSS comments, so the character before a
  // property is not necessarily a space or a semicolon. Matching on where
  // `position` appeared in the string let this through, and the note then
  // covered the whole window with itself.
  test("a comment does not smuggle a property past the list", async () => {
    expect(await styleOf('<span style="/**/position:fixed;inset:0;z-index:9999">x</span>')).toBeNull();
    expect(await styleOf('<span style="color:red;/**/position:fixed">x</span>')).toBe("color: red");
  });

  // None of these were caught by the pattern that only knew about `position`,
  // and every one of them moves an element off where it belongs.
  test("the other ways out of the flow are not on the list either", async () => {
    expect(await styleOf('<div style="transform: translate(-9999px, 0)">x</div>')).toBeNull();
    expect(await styleOf('<div style="margin: -9999px">x</div>')).toBeNull();
    expect(await styleOf('<div style="inset: 0; z-index: 99">x</div>')).toBeNull();
    expect(await styleOf('<div style="width: 100vw; height: 100vh">x</div>')).toBeNull();
    expect(await styleOf('<div style="pointer-events: none">x</div>')).toBeNull();
    expect(await styleOf('<div style="behavior: url(#x)">x</div>')).toBeNull();
  });

  test("a value that fetches is dropped even on a property that is allowed", async () => {
    expect(await styleOf('<div style="background-color: url(http://example.com/x)">x</div>')).toBeNull();
    expect(await styleOf('<div style="color: \\0070osition">x</div>')).toBeNull();
    expect(await styleOf('<div style="font-family: @import url(x)">x</div>')).toBeNull();
  });

  test("what is allowed survives, and only that", async () => {
    expect(await styleOf('<div style="COLOR: Red; Position: fixed">x</div>')).toBe("color: Red");
    expect(await styleOf('<span style="text-align: center">x</span>')).toBe("text-align: center");
    expect(await styleOf('<div style="padding: 4px 8px; border: 1px solid #333">x</div>')).toBe(
      "padding: 4px 8px; border: 1px solid #333"
    );
  });

  test("a style with nothing left in it is not left behind as an empty one", async () => {
    expect(await styleOf('<div style="position: fixed">x</div>')).toBeNull();
    expect(await styleOf('<div style="color:">x</div>')).toBeNull();
    expect(await styleOf('<div style="">x</div>')).toBeNull();
  });
});
