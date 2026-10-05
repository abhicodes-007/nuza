export type FileEntry = {
  name: string;
  path: string;
  isDirectory: boolean;
  children?: FileEntry[];
  /** Milliseconds since the epoch, when the filesystem says. */
  modified?: number;
  created?: number;
  /** The filesystem did not answer for it in time: offline, or on a share gone quiet. */
  unavailable?: boolean;
};
