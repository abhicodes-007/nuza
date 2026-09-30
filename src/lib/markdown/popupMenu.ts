/** One choice in a popup menu. */
export interface PopupItem {
  label: string;
  onSelect: () => void;
  danger?: boolean;
}

/**
 * A small menu at `x`, `y`, for widgets inside the editor that cannot render
 * the sidebar's React one. It looks the same - the same classes - and goes
 * away the same ways: a choice, a click elsewhere, Escape, or the window
 * losing focus.
 */
export function showPopupMenu(x: number, y: number, items: PopupItem[]) {
  const menu = document.createElement("div");
  menu.className =
    "animate-menu-in fixed z-50 min-w-[160px] rounded-md border border-zinc-700 bg-[var(--nuza-bg)] py-1 shadow-xl";
  menu.setAttribute("role", "menu");

  function close() {
    menu.remove();
    window.removeEventListener("mousedown", onPointerDown, true);
    window.removeEventListener("keydown", onKeyDown, true);
    window.removeEventListener("blur", close);
  }
  function onPointerDown(event: MouseEvent) {
    if (!menu.contains(event.target as Node)) close();
  }
  function onKeyDown(event: KeyboardEvent) {
    if (event.key !== "Escape") return;
    event.preventDefault();
    event.stopPropagation();
    close();
  }

  for (const item of items) {
    const button = document.createElement("button");
    button.type = "button";
    button.setAttribute("role", "menuitem");
    button.textContent = item.label;
    button.className = `block w-full cursor-pointer px-3 py-1.5 text-left text-sm transition-colors hover:bg-zinc-700/60 ${
      item.danger ? "text-red-400 hover:text-red-300" : "text-zinc-200"
    }`;
    // On mousedown, and kept from the editor: a click would first move focus
    // and the caret, and the editor would read it as a click into the note.
    button.addEventListener("mousedown", (event) => {
      event.preventDefault();
      event.stopPropagation();
      close();
      item.onSelect();
    });
    menu.appendChild(button);
  }

  document.body.appendChild(menu);
  // Kept on screen, the way the sidebar's menu is.
  const { width, height } = menu.getBoundingClientRect();
  menu.style.left = `${Math.max(8, Math.min(x, window.innerWidth - width - 8))}px`;
  menu.style.top = `${Math.max(8, Math.min(y, window.innerHeight - height - 8))}px`;

  window.addEventListener("mousedown", onPointerDown, true);
  window.addEventListener("keydown", onKeyDown, true);
  window.addEventListener("blur", close);
  return close;
}
