/** True when running on macOS, used to pick "mod" key semantics and display glyphs. */
export function isMacPlatform(): boolean {
  if (typeof navigator === "undefined") return false;
  const uaData = (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData;
  const platform = uaData?.platform ?? navigator.platform ?? navigator.userAgent ?? "";
  return /mac|iphone|ipad|ipod/i.test(platform);
}

/** The platform's user-agent string, however it chooses to report it. */
function platformName(): string {
  if (typeof navigator === "undefined") return "";
  const uaData = (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData;
  return uaData?.platform ?? navigator.platform ?? navigator.userAgent ?? "";
}

/**
 * What this platform calls the place deleted files wait in.
 *
 * Worth getting right rather than saying "trash" everywhere: the dialog is
 * telling someone their note is recoverable, and it can only do that by
 * naming somewhere they will recognise when they go looking.
 */
export function trashName(): string {
  return /win/i.test(platformName()) ? "Recycle Bin" : "Trash";
}
