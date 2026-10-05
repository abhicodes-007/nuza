import { describe, expect, test } from "bun:test";
import { valueFromChange } from "../src/lib/storageSync";

const change = (key: string | null, newValue: string | null, local = true) => ({ key, newValue, local });

describe("valueFromChange", () => {
  test("takes the value another window stored under the key", () => {
    expect(valueFromChange(change("vimEnabled", "true"), "vimEnabled", false)).toEqual({ value: true });
  });

  test("reads objects and lists as well as flags", () => {
    expect(valueFromChange(change("vaults", '[{"path":"/a"}]'), "vaults", [])).toEqual({
      value: [{ path: "/a" }],
    });
  });

  test("a value that is already what this window holds does nothing", () => {
    expect(valueFromChange(change("editorFontSize", "18"), "editorFontSize", 18)).toBeUndefined();
    expect(valueFromChange(change("v", '["a"]'), "v", ["a"])).toBeUndefined();
  });

  test("another setting's change is not this one's", () => {
    expect(valueFromChange(change("compactMode", "true"), "vimEnabled", false)).toBeUndefined();
  });

  test("a change to session storage is not a setting", () => {
    expect(valueFromChange(change("vimEnabled", "true", false), "vimEnabled", false)).toBeUndefined();
  });

  test("a setting being cleared is left for the window to carry on with", () => {
    expect(valueFromChange(change("vimEnabled", null), "vimEnabled", true)).toBeUndefined();
    // Storage being cleared altogether reports no key at all.
    expect(valueFromChange(change(null, null), "vimEnabled", true)).toBeUndefined();
  });

  test("a value that is not JSON does nothing", () => {
    expect(valueFromChange(change("vimEnabled", "{nope"), "vimEnabled", false)).toBeUndefined();
  });

  test("a stored null is a value, and is told apart from nothing", () => {
    expect(valueFromChange<string | null>(change("last", "null"), "last", "x")).toEqual({ value: null });
  });
});
