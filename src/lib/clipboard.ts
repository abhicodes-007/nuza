/**
 * Puts `text` on the system clipboard.
 *
 * The asynchronous clipboard API is the way in on every webview the app runs
 * in, but it can refuse - a webview that does not count the click as a user
 * gesture, or one without clipboard permission - so a refusal falls back to
 * the old copy command on a hidden text box, which asks for neither.
 */
export async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    return;
  } catch {
    // Falls through to the copy command.
  }

  const field = document.createElement("textarea");
  field.value = text;
  field.setAttribute("readonly", "");
  field.style.position = "fixed";
  field.style.opacity = "0";
  document.body.appendChild(field);
  field.select();
  const copied = document.execCommand("copy");
  field.remove();
  if (!copied) throw new Error("the clipboard would not take it");
}
