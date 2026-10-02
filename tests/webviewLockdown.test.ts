import { describe, expect, test } from "bun:test";
import { installWebviewLockdown, isReloadOrInspectShortcut } from "../src/lib/webviewLockdown";

function press(
  key: string,
  modifiers: Partial<Record<"ctrlKey" | "metaKey" | "shiftKey" | "altKey", boolean>> = {},
  code = ""
) {
  return { key, code, ctrlKey: false, metaKey: false, shiftKey: false, altKey: false, ...modifiers };
}

describe("isReloadOrInspectShortcut", () => {
  test("is F5 and F12", () => {
    expect(isReloadOrInspectShortcut(press("F5"))).toBe(true);
    expect(isReloadOrInspectShortcut(press("F12"))).toBe(true);
  });

  test("is Ctrl or Cmd with R, shifted or not", () => {
    expect(isReloadOrInspectShortcut(press("r", { ctrlKey: true }, "KeyR"))).toBe(true);
    expect(isReloadOrInspectShortcut(press("r", { metaKey: true }, "KeyR"))).toBe(true);
    expect(isReloadOrInspectShortcut(press("R", { ctrlKey: true, shiftKey: true }, "KeyR"))).toBe(true);
    expect(isReloadOrInspectShortcut(press("r"))).toBe(false);
  });

  test("is the inspector's shortcuts, with their modifiers", () => {
    for (const letter of ["i", "j", "c"]) {
      const code = `Key${letter.toUpperCase()}`;
      expect(isReloadOrInspectShortcut(press(letter, { ctrlKey: true, shiftKey: true }, code))).toBe(true);
      expect(isReloadOrInspectShortcut(press(letter, { metaKey: true, altKey: true }, code))).toBe(true);
    }
  });

  test("reads the letter from the key's place, as Option changes what it types", () => {
    expect(isReloadOrInspectShortcut(press("ˆ", { metaKey: true, altKey: true }, "KeyI"))).toBe(true);
  });

  test("leaves the editor's own shortcuts alone", () => {
    expect(isReloadOrInspectShortcut(press("i", { metaKey: true }, "KeyI"))).toBe(false); // italic
    expect(isReloadOrInspectShortcut(press("c", { metaKey: true }, "KeyC"))).toBe(false); // copy
    expect(isReloadOrInspectShortcut(press("c", { ctrlKey: true }, "KeyC"))).toBe(false);
    expect(isReloadOrInspectShortcut(press("s", { ctrlKey: true }, "KeyS"))).toBe(false);
    expect(isReloadOrInspectShortcut(press("F6"))).toBe(false);
  });
});

describe("installWebviewLockdown", () => {
  function fire(target: EventTarget, type: string, init: object = {}) {
    const event = Object.assign(new Event(type, { cancelable: true }), init);
    target.dispatchEvent(event);
    return event;
  }

  test("cancels the native right-click menu", () => {
    const target = new EventTarget();
    installWebviewLockdown(target, false);
    expect(fire(target, "contextmenu").defaultPrevented).toBe(true);
  });

  test("leaves a menu the app drew itself as it is, and does not stop the event", () => {
    const target = new EventTarget();
    installWebviewLockdown(target, false);
    let heard = 0;
    target.addEventListener("contextmenu", () => heard++);
    fire(target, "contextmenu");
    expect(heard).toBe(1);
  });

  test("blocks reload and inspect shortcuts in a shipped build only", () => {
    const shipped = new EventTarget();
    installWebviewLockdown(shipped, true);
    expect(fire(shipped, "keydown", press("F5")).defaultPrevented).toBe(true);
    expect(fire(shipped, "keydown", press("r", { ctrlKey: true }, "KeyR")).defaultPrevented).toBe(true);
    expect(fire(shipped, "keydown", press("s", { ctrlKey: true }, "KeyS")).defaultPrevented).toBe(false);

    const development = new EventTarget();
    installWebviewLockdown(development, false);
    expect(fire(development, "keydown", press("F12")).defaultPrevented).toBe(false);
  });

  test("lets the app's own handlers see the shortcut it cancels", () => {
    const target = new EventTarget();
    // Registered first, as the app's capture-phase handlers are in effect.
    let seen = "";
    target.addEventListener("keydown", (event) => (seen = (event as unknown as { key: string }).key));
    installWebviewLockdown(target, true);
    fire(target, "keydown", press("r", { ctrlKey: true }, "KeyR"));
    expect(seen).toBe("r");
  });

  test("can be taken off again", () => {
    const target = new EventTarget();
    const remove = installWebviewLockdown(target, true);
    remove();
    expect(fire(target, "contextmenu").defaultPrevented).toBe(false);
    expect(fire(target, "keydown", press("F5")).defaultPrevented).toBe(false);
  });
});
