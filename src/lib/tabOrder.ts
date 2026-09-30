/**
 * The tab strip with `path` moved so that it lands before the tab at `before`
 * in the strip as it stands now - `before` equal to the strip's length puts it
 * last. The same array comes back when nothing moves.
 */
export function moveTab(paths: string[], path: string, before: number): string[] {
  const from = paths.indexOf(path);
  if (from === -1) return paths;

  // Taking the tab out shifts everything after it one place left.
  const to = Math.max(0, Math.min(before > from ? before - 1 : before, paths.length - 1));
  if (to === from) return paths;

  const rest = paths.filter((p) => p !== path);
  return [...rest.slice(0, to), path, ...rest.slice(to)];
}
