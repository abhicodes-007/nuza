/**
 * A full-size look at an image, over the window, without leaving the note.
 *
 * Built by hand rather than as a component: it is opened from inside the
 * editor's own DOM, and there is nothing in it to keep in step with state.
 * Anything - a click, Escape - puts it away; the styles are `.nuza-lightbox`
 * in App.css.
 */

/** How long the closing transition in App.css runs for. */
const CLOSE_MS = 160;

let current: { overlay: HTMLElement; remove: () => void } | null = null;

function reducedMotion() {
  return window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
}

export function closeLightbox() {
  current?.remove();
}

export function showLightbox(src: string, alt: string) {
  closeLightbox();

  const overlay = document.createElement("div");
  overlay.className = "nuza-lightbox";
  overlay.setAttribute("role", "dialog");
  overlay.setAttribute("aria-modal", "true");
  overlay.setAttribute("aria-label", alt || "Image preview");

  const image = document.createElement("img");
  image.src = src;
  image.alt = alt;
  overlay.appendChild(image);

  image.addEventListener("error", () => {
    overlay.classList.add("nuza-lightbox-broken");
    overlay.textContent = alt || "image not found";
  });

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key !== "Escape") return;
    // Not the editor's: Escape here means "put this away", and nothing else.
    event.preventDefault();
    event.stopPropagation();
    close();
  };

  function remove() {
    document.removeEventListener("keydown", onKeyDown, true);
    overlay.remove();
    if (current?.overlay === overlay) current = null;
  }

  function close() {
    overlay.classList.remove("nuza-lightbox-open");
    // Out of the way of clicks the moment it starts to go.
    overlay.style.pointerEvents = "none";
    if (reducedMotion()) remove();
    else setTimeout(remove, CLOSE_MS);
  }

  overlay.addEventListener("click", close);
  document.addEventListener("keydown", onKeyDown, true);
  document.body.appendChild(overlay);
  current = { overlay, remove };

  // A frame later, so the transition has a closed state to start from.
  requestAnimationFrame(() => overlay.classList.add("nuza-lightbox-open"));
}
