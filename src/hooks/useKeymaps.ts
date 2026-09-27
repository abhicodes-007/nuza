import { useCallback, useEffect, useMemo, useState } from "react";
import { KEYMAP_ACTIONS, KEYMAP_STORAGE_KEY, KeymapAction } from "@/lib/keymaps";
import { firesWhileTyping, matchesBinding } from "@/lib/keybinding";

type KeymapOverrides = Partial<Record<KeymapAction, string>>;

function loadOverrides(): KeymapOverrides {
  try {
    const raw = localStorage.getItem(KEYMAP_STORAGE_KEY);
    return raw ? (JSON.parse(raw) as KeymapOverrides) : {};
  } catch {
    return {};
  }
}

/** Resolves the effective binding for every action, merging user overrides onto the defaults. */
export function useKeymaps() {
  const [overrides, setOverrides] = useState<KeymapOverrides>(loadOverrides);

  useEffect(() => {
    localStorage.setItem(KEYMAP_STORAGE_KEY, JSON.stringify(overrides));
  }, [overrides]);

  const bindings = useMemo(() => {
    const map = {} as Record<KeymapAction, string>;
    for (const action of KEYMAP_ACTIONS) {
      map[action.id] = overrides[action.id] ?? action.defaultBinding;
    }
    return map;
  }, [overrides]);

  const setBinding = useCallback((action: KeymapAction, binding: string) => {
    setOverrides((prev) => ({ ...prev, [action]: binding }));
  }, []);

  const resetBinding = useCallback((action: KeymapAction) => {
    setOverrides((prev) => {
      if (!(action in prev)) return prev;
      const next = { ...prev };
      delete next[action];
      return next;
    });
  }, []);

  const resetAll = useCallback(() => setOverrides({}), []);

  return { bindings, setBinding, resetBinding, resetAll };
}

/**
 * Whether the keystroke landed in something that takes text.
 *
 * The editor counts: CodeMirror is a contenteditable, and a shortcut bound to
 * a bare letter firing in the middle of a sentence - swallowing the letter,
 * since the listener calls `preventDefault` - is the same bug as it firing in
 * the middle of a filename.
 */
function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;

  const tag = target.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
}

/**
 * Wires up a single global keydown listener that dispatches to the given
 * handlers based on the current (possibly user-customized) bindings.
 * Uses the capture phase so shortcuts still fire while CodeMirror has focus.
 */
export function useKeymapListener(
  bindings: Record<KeymapAction, string>,
  handlers: Partial<Record<KeymapAction, () => void>>
) {
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const typing = isTyping(e.target);

      for (const action of Object.keys(bindings) as KeymapAction[]) {
        if (typing && !firesWhileTyping(bindings[action])) continue;

        if (matchesBinding(e, bindings[action])) {
          const handler = handlers[action];
          if (handler) {
            e.preventDefault();
            handler();
          }
          return;
        }
      }
    }

    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [bindings, handlers]);
}
