import { getCurrentWindow } from "@tauri-apps/api/window";

/**
 * Whether this is the window the app started with. The ones opened later start
 * on the welcome screen and keep to themselves what the first one keeps for
 * the app as a whole.
 */
export function isMainWindow() {
  try {
    return getCurrentWindow().label === "main";
  } catch {
    // Not running inside a window at all, as in a test.
    return true;
  }
}
