import { useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { FileEntry } from "@/lib/types";
import { WikiLinkRef, backlinksTo } from "@/lib/markdown/wikiLinks";

/** How long the open note has to settle before the vault is read for links to it. */
const REFRESH_DELAY = 300;

function markdownNotes(entries: FileEntry[], out: string[] = []) {
  for (const entry of entries) {
    if (entry.children) markdownNotes(entry.children, out);
    else if (/\.md$/i.test(entry.name)) out.push(entry.path);
  }
  return out;
}

/**
 * The wiki-links elsewhere in the vault that lead to `path`.
 *
 * The vault's links are read again whenever the open note changes - which is
 * also when the notes written in since last time are likely to have been
 * saved - and when a note is added, moved or taken away. Not when a note is
 * only saved: the tree changes then too, but only in its dates, and reading
 * every note in the vault on every autosave is no way to keep a panel fresh.
 */
export function useBacklinks(path: string, root: string | null, tree: FileEntry[], enabled: boolean) {
  const notes = useMemo(() => markdownNotes(tree), [tree]);
  // A string, so the effect below sees the same value when only dates moved.
  const signature = notes.join("\n");
  const [links, setLinks] = useState<WikiLinkRef[]>([]);

  useEffect(() => {
    if (!enabled || !root) {
      setLinks([]);
      return;
    }

    let current = true;
    const timer = setTimeout(() => {
      invoke<WikiLinkRef[]>("list_wiki_links")
        .then((found) => {
          if (current) setLinks(found);
        })
        .catch((error) => console.error("Couldn't read the vault's links:", error));
    }, REFRESH_DELAY);

    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [path, root, signature, enabled]);

  return useMemo(
    () => (root ? backlinksTo(path, links, signature ? signature.split("\n") : [], root) : []),
    [path, links, signature, root]
  );
}
