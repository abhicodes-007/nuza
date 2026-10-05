import { useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

/** How long the open note has to settle before the vault is read. */
const REFRESH_DELAY = 300;

/**
 * What a backend command finds when it reads every note in the vault - the
 * wiki-links in them, the tags - kept up to date.
 *
 * It is read again whenever the open note changes - which is also when the
 * notes written in since last time are likely to have been saved - and when a
 * note is added, moved or taken away. Not when a note is only saved: that does
 * not change which notes there are, and the backend answers from its index, so
 * this is a message and not a read of every note in the vault - but there is
 * still no reason to ask on every autosave.
 *
 * `notePaths` is every note in the vault, from the backend's index and not the
 * sidebar's tree - the tree only holds the folders that have been opened.
 * `notes` is the same list as one string, which is the same value when
 * nothing was added or taken away, and is there for whoever needs it too.
 */
export function useVaultScan<T>(
  command: string,
  path: string,
  root: string | null,
  notePaths: string[],
  enabled: boolean
) {
  const notes = useMemo(() => notePaths.join("\n"), [notePaths]);
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
