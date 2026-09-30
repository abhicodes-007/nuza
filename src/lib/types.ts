export type FileEntry = {
  name: string;
  path: string;
  isDirectory: boolean;
  children?: FileEntry[];
  /** Milliseconds since the epoch, when the filesystem says. */
  modified?: number;
  created?: number;
};
