import { useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { FileEntry } from "@/lib/types";

/** How long the open note has to settle before the vault is read. */
const REFRESH_DELAY = 300;

function markdownNotes(entries: FileEntry[], out: string[] = []) {
  for (const entry of entries) {
    if (entry.children) markdownNotes(entry.children, out);
    else if (/\.md$/i.test(entry.name)) out.push(entry.path);
  }
  return out;
}

/**
 * What a backend command finds when it reads every note in the vault - the
 * wiki-links in them, the tags - kept up to date.
 *
 * It is read again whenever the open note changes - which is also when the
 * notes written in since last time are likely to have been saved - and when a
 * note is added, moved or taken away. Not when a note is only saved: the tree
 * changes then too, but only in its dates, and reading every note in the vault
 * on every autosave is no way to keep a panel fresh.
 *
 * `notes` is the vault's notes as one string, which is the same value when
 * only dates moved, and is there for whoever needs the list as well.
 */
export function useVaultScan<T>(
  command: string,
  path: string,
  root: string | null,
  tree: FileEntry[],
  enabled: boolean
) {
  const list = useMemo(() => markdownNotes(tree), [tree]);
  const notes = list.join("\n");
  const [found, setFound] = useState<T[]>([]);

  useEffect(() => {
    if (!enabled || !root) {
      setFound([]);
      return;
    }

    let current = true;
    const timer = setTimeout(() => {
      invoke<T[]>(command)
        .then((result) => {
          if (current) setFound(result);
        })
        .catch((error) => console.error(`Couldn't read the vault (${command}):`, error));
    }, REFRESH_DELAY);

    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [command, path, root, notes, enabled]);

  return { found, notes };
}
