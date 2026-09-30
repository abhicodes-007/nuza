import { invoke } from "@tauri-apps/api/core";

/** The folder a note's images and attachments are filed under. */
export const MEDIA_FOLDER = "media";

/** Splits a path on either separator, so Windows and POSIX paths both work. */
function segments(path: string) {
  return path.split(/[\\/]+/).filter(Boolean);
}

/** The separator the host is already using, inferred from the path itself. */
function separatorFor(path: string) {
  return path.includes("\\") && !path.includes("/") ? "\\" : "/";
}

export function joinPath(parent: string, name: string) {
  return `${parent}${separatorFor(parent)}${name}`;
}

export function fileNameOf(path: string) {
  return path.slice(Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\")) + 1);
}

/**
 * What a path hangs from: a drive (`C:`), a network share (`//server/share`),
 * the POSIX root (`/`), or nothing for a relative path. Drive letters and
 * share names are compared without regard to case, as Windows compares them.
 */
function rootOf(path: string) {
  const drive = /^([a-z]):/i.exec(path);
  if (drive) return `${drive[1].toUpperCase()}:`;

  const share = /^[\\/]{2}([^\\/]+)[\\/]+([^\\/]+)/.exec(path);
  if (share) return `//${share[1]}/${share[2]}`.toLowerCase();

  return /^[\\/]/.test(path) ? "/" : "";
}

/**
 * Segments with the root's own in one case - a drive letter, or a share's
 * server and name - so `c:` meets `C:`. Only those: below the root, a
 * folder's name is compared as it is written.
 */
function comparable(path: string) {
  const parts = segments(path);
  const root = rootOf(path);
  const fold = root.startsWith("//") ? 2 : /^[A-Z]:$/.test(root) ? 1 : 0;
  return parts.map((part, index) => (index < fold ? part.toLowerCase() : part));
}

/**
 * The way from `directory` to `target`, as a relative path. Markdown links are
 * always written with forward slashes: they are read back by splitting on
 * either separator, and a backslash in a link is an escape as often as it is a
 * path on the one platform that uses them.
 */
export function relativePath(directory: string, target: string) {
  // Paths on different drives, or different network shares, have no way from
  // one to the other: `../..` never leaves `C:`. The target is given whole.
  if (rootOf(directory) !== rootOf(target)) return target.replace(/\\/g, "/");

  const from = comparable(directory);
  const to = comparable(target);

  let shared = 0;
  while (shared < from.length && shared < to.length && from[shared] === to[shared]) shared++;

  const climb = Array.from({ length: from.length - shared }, () => "..");
  return [...climb, ...to.slice(shared)].join("/");
}

/**
 * A link's target, escaped so the markdown parser reads all of it. Spaces end a
 * link target, which every screenshot name on a Mac would otherwise walk into.
 */
export function encodeLinkTarget(path: string) {
  return encodeURI(path).replace(/[()]/g, (char) => (char === "(" ? "%28" : "%29"));
}

const IMAGE_EXTENSIONS: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
  "image/avif": "avif",
  "image/svg+xml": "svg",
  "image/bmp": "bmp",
};

export function isImage(type: string) {
  return type.startsWith("image/");
}

const IMAGE_SUFFIXES = new Set(["png", "jpg", "jpeg", "gif", "webp", "avif", "svg", "bmp", "ico"]);

/** Whether a path names an image, judged by its extension - a file on disk
 * arrives without the media type a dropped or pasted one carries. */
export function isImagePath(path: string) {
  const dot = path.lastIndexOf(".");
  return dot >= 0 && IMAGE_SUFFIXES.has(path.slice(dot + 1).toLowerCase());
}

/**
 * A name for something pasted straight from the clipboard, which arrives with
 * no name of its own. Dashes rather than spaces: it ends up in a link.
 */
export function pastedName(type: string) {
  const now = new Date();
  const pad = (value: number) => String(value).padStart(2, "0");
  const stamp = [
    now.getFullYear(),
    pad(now.getMonth() + 1),
    pad(now.getDate()),
    pad(now.getHours()),
    pad(now.getMinutes()),
    pad(now.getSeconds()),
  ].join("");

  return `Pasted-${stamp}.${IMAGE_EXTENSIONS[type] ?? "png"}`;
}

/**
 * The largest file that can be dropped or pasted into a note.
 *
 * A dropped file has no path the app can see - the webview hands over its
 * bytes, not where they came from - so all of it is read into the page before
 * it can go anywhere. Past this it is a video, not an attachment, and reading
 * it in whole is how the window hangs or runs out of memory.
 */
export const MAX_ATTACHMENT_BYTES = 50 * 1024 * 1024;

/** A size the way a person would say it: "312 MB". */
export function formatSize(bytes: number) {
  const megabytes = bytes / (1024 * 1024);
  if (megabytes >= 1) return `${megabytes >= 10 ? Math.round(megabytes) : megabytes.toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

/** Why `file` cannot be attached, or null when it can. */
export function attachmentProblem(file: Blob) {
  if (file.size <= MAX_ATTACHMENT_BYTES) return null;
  return `it is ${formatSize(file.size)}, and files over ${formatSize(MAX_ATTACHMENT_BYTES)} can't be added`;
}

/**
 * Writes a dropped or pasted file into `directory`, returning the path it
 * actually landed at - the name is taken as a suggestion, and the backend
 * renames rather than overwrite anything already sitting there.
 *
 * The bytes go across as they are, as the body of the request, rather than
 * as base64 inside JSON: no string four thirds the size of the file built on
 * the thread drawing the window, and nothing to decode on the other side.
 * The directory and name ride in headers, which only carry ASCII, so they
 * are percent-encoded there.
 */
export async function writeMedia(directory: string, name: string, file: Blob) {
  const problem = attachmentProblem(file);
  if (problem) throw new Error(problem);

  const bytes = new Uint8Array(await file.arrayBuffer());
  return invoke<string>("write_media", bytes, {
    headers: {
      "x-nuza-directory": encodeURIComponent(directory),
      "x-nuza-name": encodeURIComponent(name),
    },
  });
}

/** Broadcast after a file lands on disk, so the sidebar can show it. */
export const ATTACHMENT_EVENT = "nuza-attachment";

export function announceAttachment(path: string) {
  window.dispatchEvent(new CustomEvent(ATTACHMENT_EVENT, { detail: { path } }));
}
