import { useEffect, useState } from "react";

/** Writes held back by a debounce, keyed by storage key, so leaving can finish them. */
const pending = new Map<string, () => void>();

function store(key: string, value: unknown) {
  // Guarded the same way the read is: storage can be full, or blocked
  // outright, and a throw from in here takes the whole app down with it.
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (error) {
    console.error(`Failed to store ${key}:`, error);
  }
}

/**
 * Writes every value a debounce is still holding. Called on the way out -
 * quitting ends the process without an unload for a timer to hear.
 */
export function flushPersistedState() {
  for (const write of [...pending.values()]) write();
}

interface Options {
  /**
   * Hold the write until the value has stopped changing for this long. For
   * values driven by a drag, where every frame is a new value and each one
   * would otherwise be a synchronous, disk-backed localStorage write.
   */
  debounceMs?: number;
}

/**
 * Like useState, but the value is read from and written to localStorage
 * under `key`, so it survives app restarts. Falls back to `defaultValue`
 * if nothing is stored yet or the stored value can't be parsed.
 */
export function usePersistedState<T>(key: string, defaultValue: T, { debounceMs = 0 }: Options = {}) {
  const [value, setValue] = useState<T>(() => {
    try {
      const saved = localStorage.getItem(key);
      return saved !== null ? (JSON.parse(saved) as T) : defaultValue;
    } catch {
      return defaultValue;
    }
  });

  useEffect(() => {
    if (debounceMs <= 0) {
      store(key, value);
      return;
    }

    const write = () => {
      clearTimeout(timer);
      if (pending.get(key) === write) pending.delete(key);
      store(key, value);
    };
    pending.set(key, write);
    const timer = setTimeout(write, debounceMs);

    // A newer value takes this one's place in `pending`. The write is left
    // there on the way out so the unmount below can still make it.
    return () => clearTimeout(timer);
  }, [key, value, debounceMs]);

  // Finishes a held write if the component goes before its timer does.
  useEffect(() => () => pending.get(key)?.(), [key]);

  return [value, setValue] as const;
}
