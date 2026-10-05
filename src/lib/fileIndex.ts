import { FileEntry } from "./types";

/**
 * The vault's files as the backend's index lists them: flat, every file in the
 * vault whether or not the sidebar has opened its folder.
 *
 * Quick-open, wiki-links and the backlinks panel all need to know what is in
 * the vault, and the sidebar's tree only holds what has been opened. They read
 * this instead.
 */

export const NOTE_PATTERN = /\.md$/i;

/** The paths of the markdown notes in a list of files. */
export function notePaths(files: FileEntry[]) {
  return files.filter((file) => NOTE_PATTERN.test(file.name)).map((file) => file.path);
}

/**
 * The files as a tree of folders, for the searches that report which folder a
 * file is in. Only the files are real: the folders exist because a file's path
 * runs through them.
 */
export function treeFromFiles(files: FileEntry[], root: string): FileEntry[] {
  const top: FileEntry[] = [];
  const folders = new Map<string, FileEntry[]>([[root, top]]);

  const childrenOf = (path: string): FileEntry[] => {
    const known = folders.get(path);
    if (known) return known;

    const split = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
    const children: FileEntry[] = [];
    folders.set(path, children);
    // A folder outside the root has no parent here worth drawing; its files
    // are listed at the top rather than lost.
    const parent = split > root.length ? childrenOf(path.slice(0, split)) : top;
    parent.push({ name: path.slice(split + 1), path, isDirectory: true, children });
    return children;
  };

  for (const file of files) {
    const split = Math.max(file.path.lastIndexOf("/"), file.path.lastIndexOf("\\"));
    const folder = split > root.length ? file.path.slice(0, split) : root;
    childrenOf(folder).push(file);
  }
  return top;
}
