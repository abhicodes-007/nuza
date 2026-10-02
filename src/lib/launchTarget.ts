import { directoryOf } from "@/lib/markdown/sources";
import { isWithin } from "@/lib/path";

/**
 * What `nuza <path>` asked for, as the backend resolved it: a folder to open
 * as the vault, or a note to open in one.
 */
export interface OpenTarget {
  kind: "folder" | "file";
  path: string;
}

export type OpenPlan =
  /** Switch to this folder, with this note in front where there is one. */
  | { folder: string; focus?: string }
  /** The note is in the vault that is open: just bring it up. */
  | { select: string };

/**
 * What to do about `target`, given the vault that is open (or none).
 *
 * A folder is the vault. A note is opened in the vault it is already in, and
 * where that is not the one open - or none is - in its own folder: the app
 * only reads what is inside the vault, so a note has to bring its folder with
 * it. Asking for the folder that is already open does nothing, rather than
 * putting away the tabs that are.
 */
export function planOpen(target: OpenTarget, rootPath: string | null): OpenPlan | null {
  if (target.kind === "folder") return target.path === rootPath ? null : { folder: target.path };

  if (rootPath && isWithin(target.path, rootPath)) return { select: target.path };
  return { folder: directoryOf(target.path), focus: target.path };
}
