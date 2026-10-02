import { useCallback, useMemo } from "react";
import { readRecent, recordRecent } from "@/lib/recentFiles";
import { usePersistedState } from "./usePersistedState";

/** The notes opened most recently, newest first, and the way to add one. */
export function useRecentFiles() {
  const [stored, setStored] = usePersistedState<string[]>("recentFiles", []);

  // Memoised, since the list is a prop of a memoised palette.
  const recent = useMemo(() => readRecent(stored), [stored]);

  const record = useCallback(
    (path: string) =>
      setStored((list) => {
        const current = readRecent(list);
        // Already in front: nothing to write, and nothing to re-render.
        return current[0] === path ? list : recordRecent(current, path);
      }),
    [setStored]
  );

  return { recent, record };
}
