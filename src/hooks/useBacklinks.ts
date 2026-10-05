import { useMemo } from "react";
import { WikiLinkRef, backlinksTo } from "@/lib/markdown/wikiLinks";
import { useVaultScan } from "./useVaultScan";

/**
 * The wiki-links elsewhere in the vault that lead to `path`, from the links
 * the vault's notes hold (see `useVaultScan` for when they are read again).
 */
export function useBacklinks(path: string, root: string | null, notePaths: string[], enabled: boolean) {
  const { found: links, notes } = useVaultScan<WikiLinkRef>(
    "list_wiki_links",
    path,
    root,
    notePaths,
    enabled
  );

  return useMemo(
    () => (root ? backlinksTo(path, links, notes ? notes.split("\n") : [], root) : []),
    [path, links, notes, root]
  );
}
