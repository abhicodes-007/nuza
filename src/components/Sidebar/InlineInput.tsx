import { useEffect, useRef, useState } from "react";

/** Auto-focused text input used for inline rename/create rows in the file tree. */
export default function InlineInput({
  initialValue = "",
  onSubmit,
  onCancel,
  validate,
  className,
}: {
  initialValue?: string;
  onSubmit: (value: string) => void;
  onCancel: () => void;
  /**
   * Why the typed value cannot be used, or `null` when it can. A row that
   * names something on disk passes the filename rules here; the vault
   * switcher, where the value is only a label, passes nothing.
   */
  validate?: (value: string) => string | null;
  className?: string;
}) {
  const [value, setValue] = useState(initialValue);
  const [problem, setProblem] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const settledRef = useRef(false);

  useEffect(() => {
    const input = inputRef.current;
    if (!input) return;
    input.focus();
    // Pre-select the basename (excluding extension) so renaming a file
    // doesn't force the user to retype ".md" etc.
    const dotIndex = initialValue.lastIndexOf(".");
    if (dotIndex > 0) {
      input.setSelectionRange(0, dotIndex);
    } else {
      input.select();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function settle(action: () => void) {
    if (settledRef.current) return;
    settledRef.current = true;
    action();
  }

  /**
   * `canStayOpen` is the difference between the two ways out of this row.
   * Pressing Enter on a name that cannot be used keeps the row, with the
   * reason under it, because the name is one edit away from working. Clicking
   * away is a decision to stop, so the row closes and nothing is written.
   */
  function submit(canStayOpen: boolean) {
    const trimmed = value.trim();
    if (!trimmed || trimmed === initialValue) {
      settle(onCancel);
      return;
    }

    const complaint = validate?.(trimmed) ?? null;
    if (complaint) {
      if (!canStayOpen) {
        settle(onCancel);
        return;
      }
      setProblem(complaint);
      inputRef.current?.focus();
      return;
    }

    settle(() => onSubmit(trimmed));
  }

  return (
    // The wrapper carries the row's layout so the message can sit under the
    // input without taking a line of its own in the tree.
    <span className="relative flex w-full min-w-0 flex-1 items-center">
      <input
        ref={inputRef}
        value={value}
        aria-invalid={problem ? true : undefined}
        onChange={(e) => {
          setValue(e.target.value);
          // The reason was about what was there a keystroke ago.
          if (problem) setProblem(null);
        }}
        onBlur={() => submit(false)}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === "Enter") {
            e.preventDefault();
            submit(true);
          } else if (e.key === "Escape") {
            e.preventDefault();
            settle(onCancel);
          }
        }}
        onClick={(e) => e.stopPropagation()}
        className={className}
      />
      {problem && (
        <span
          role="alert"
          // Wrapped rather than truncated: the panel is narrow enough that a
          // reason cut off at "A name cannot con..." is no reason at all.
          className="absolute left-0 top-full z-20 mt-1 w-max max-w-full rounded border border-red-900/60 bg-zinc-900 px-1.5 py-0.5 text-xs leading-snug text-red-400 shadow-lg"
        >
          {problem}
        </span>
      )}
    </span>
  );
}
