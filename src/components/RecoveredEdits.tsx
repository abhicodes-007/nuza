import { fileNameOf } from "@/lib/media";

interface RecoveredEditsProps {
  /** The note being asked about, or null when there is nothing to ask. */
  path: string | null;
  /** Put the kept edits back in the tab. */
  onRestore: () => void;
  /** Throw them away and keep what was read from disk. */
  onDiscard: () => void;
}

/**
 * Edits that outlived the window they were typed in.
 *
 * This note changed on disk while it had unsaved edits, the bar asking which
 * copy to keep was never answered, and the app was closed. The edits were kept
 * outside the vault rather than lost with the window - nothing was written
 * over anything - and this is the question finally being put again, at the
 * first moment there is somewhere to put it.
 *
 * Deliberately not the same colour as the conflict bar. That one is a warning
 * about something that happened a moment ago; this one is an offer about
 * something that happened a session ago, and reading as an alarm would be
 * wrong for work that is not in any danger.
 */
export default function RecoveredEdits({ path, onRestore, onDiscard }: RecoveredEditsProps) {
  if (!path) return null;

  return (
    <div className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-2 border-b border-sky-500/30 bg-sky-500/10 px-4 py-2">
      <p className="min-w-0 flex-1 text-sm text-sky-100/90">
        Unsaved edits to <span className="text-sky-100">"{fileNameOf(path)}"</span> were kept when the app
        last closed. This is what is on disk now.
      </p>
      <div className="flex shrink-0 gap-2">
        <button
          onClick={onDiscard}
          className="cursor-pointer rounded-md px-3 py-1 text-sm text-sky-100/90 transition-colors hover:bg-sky-500/20"
        >
          Discard them
        </button>
        <button
          onClick={onRestore}
          className="cursor-pointer rounded-md bg-sky-500/80 px-3 py-1 text-sm text-black transition-colors hover:bg-sky-400"
        >
          Restore them
        </button>
      </div>
    </div>
  );
}
