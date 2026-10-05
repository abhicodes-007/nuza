import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { readScratch, writeScratch } from "../src/lib/scratch";

const data = new Map<string, string>();
const storage = {
  getItem: (key: string) => data.get(key) ?? null,
  setItem: (key: string, value: string) => void data.set(key, value),
  removeItem: (key: string) => void data.delete(key),
};
(globalThis as unknown as { localStorage: typeof storage }).localStorage = storage;

/** Pretends to be running inside the window called `label`. */
function inWindow(label: string | null) {
  const scope = globalThis as unknown as { window?: unknown };
  if (label === null) delete scope.window;
  else
    scope.window = {
      __TAURI_INTERNALS__: { metadata: { currentWindow: { label }, currentWebview: { label } } },
    };
}

beforeEach(() => data.clear());
afterEach(() => inWindow(null));

describe("the scratch note", () => {
  test("is kept by the main window", () => {
    inWindow("main");
    writeScratch("a thought");
    expect(readScratch()).toBe("a thought");
  });

  test("is kept with no window to ask, as in a test", () => {
    writeScratch("a thought");
    expect(readScratch()).toBe("a thought");
  });

  test("an empty note forgets the entry", () => {
    inWindow("main");
    writeScratch("a thought");
    writeScratch("");
    expect(data.has("nuza:scratch")).toBe(false);
  });

  test("another window starts empty, and does not take the main window's", () => {
    inWindow("main");
    writeScratch("the main window's note");

    inWindow("w-1");
    expect(readScratch()).toBe("");
  });

  test("another window writing its scratch note does not overwrite the main window's", () => {
    inWindow("main");
    writeScratch("the main window's note");

    inWindow("w-1");
    writeScratch("typed in the other window");
    writeScratch("");

    inWindow("main");
    expect(readScratch()).toBe("the main window's note");
  });
});
