import { isMainWindow } from "./windowLabel";

/**
 * The scratch note, kept between runs and across vault switches.
 *
 * Every other document in the editor has a file behind it. The untitled buffer
 * has nowhere to be written, which is why autosave steps over it - and why
 * opening a vault, or closing the app, used to be enough to lose whatever was
 * in it. It is kept here instead, beside the session, rather than by turning it
 * into a file on disk nobody asked for.
 */
const STORAGE_KEY = "nuza:scratch";

/**
 * Only the first window has one. The note is a single buffer in storage, and
 * every window of the app shares that storage: two windows each keeping it
 * would write over one another and neither would be the note it left. The
 * others start empty, and what is typed in them is not kept - a note worth
 * keeping is one that has been saved to a file.
 */
const ownsScratch = isMainWindow;

/** What was in the scratch note last time, or nothing if it was never used. */
export function readScratch(): string {
  if (!ownsScratch()) return "";
  try {
    return localStorage.getItem(STORAGE_KEY) ?? "";
  } catch {
    return "";
  }
}

/** Keeps `content`. An empty note forgets the entry rather than storing "". */
export function writeScratch(content: string) {
  if (!ownsScratch()) return;
  try {
    if (content) localStorage.setItem(STORAGE_KEY, content);
    else localStorage.removeItem(STORAGE_KEY);
  } catch (error) {
    console.error("Failed to keep the scratch note:", error);
  }
}
