import { useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { FileEntry } from "@/lib/types";
import { notePaths, treeFromFiles } from "@/lib/fileIndex";

/** Said by the backend when the vault's set of files changed, or its index was finished. */
const INDEX_CHANGED_EVENT = "index-changed";

/** A burst of changes - a `git pull` - is read once, after it has settled. */
const SETTLE_DELAY = 150;

/**
 * Every file in the open vault, as the backend's index has them.
 *
 * The sidebar only holds the folders that have been opened, so what has to
 * reach into the rest of the vault - quick-open, wiki-links, backlinks - reads
 * this. It is a copy of what the backend already keeps in memory, so reading
 * it again costs a message and not a walk of the disk; and it is only read
 * again when the files themselves change, not each time a note is saved.
 */
export function useFileIndex(root: string | null) {
  const [files, setFiles] = useState<FileEntry[]>([]);

  useEffect(() => {
    if (!root) {
      setFiles([]);
      return;
    }

    let current = true;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const load = () => {
      invoke<FileEntry[]>("list_files")
        .then((found) => {
          if (current) setFiles(found);
        })
        .catch((error) => console.error("Couldn't list the vault's files:", error));
    };

    // Nothing from the vault that was open before this one.
    setFiles([]);
    load();
    const listening = listen(INDEX_CHANGED_EVENT, () => {
      clearTimeout(timer);
      timer = setTimeout(load, SETTLE_DELAY);
    });

    return () => {
      current = false;
      clearTimeout(timer);
      void listening.then((unlisten) => unlisten());
    };
  }, [root]);

  const tree = useMemo(() => (root ? treeFromFiles(files, root) : []), [files, root]);
  const notes = useMemo(() => notePaths(files), [files]);
  const paths = useMemo(() => new Set(files.map((file) => file.path)), [files]);

  return { files, tree, notes, paths };
}
