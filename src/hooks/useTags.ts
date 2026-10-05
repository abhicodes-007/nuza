import { useMemo } from "react";
import { TagRef, buildTagIndex } from "@/lib/tagIndex";
import { useVaultScan } from "./useVaultScan";

/** The vault's tags and where they are written (see `useVaultScan` for when it is read again). */
export function useTags(path: string, root: string | null, notePaths: string[], enabled: boolean) {
  const { found } = useVaultScan<TagRef>("list_tags", path, root, notePaths, enabled);
  return useMemo(() => buildTagIndex(found), [found]);
}
