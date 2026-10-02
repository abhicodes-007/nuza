import { useMemo } from "react";
import { FileEntry } from "@/lib/types";
import { TagRef, buildTagIndex } from "@/lib/tagIndex";
import { useVaultScan } from "./useVaultScan";

/** The vault's tags and where they are written (see `useVaultScan` for when it is read again). */
export function useTags(path: string, root: string | null, tree: FileEntry[], enabled: boolean) {
  const { found } = useVaultScan<TagRef>("list_tags", path, root, tree, enabled);
  return useMemo(() => buildTagIndex(found), [found]);
}
