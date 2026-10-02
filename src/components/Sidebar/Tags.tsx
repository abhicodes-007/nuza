import { useState } from "react";
import { ChevronRight } from "lucide-react";
import { cn } from "cn";
import { TagIndex, firstUseInEachNote } from "@/lib/tagIndex";
import { fileNameOf } from "@/lib/media";
import { FileIcon } from "@/lib/utils";

interface TagsProps {
  index: TagIndex;
  isOpen: boolean;
  onToggle: () => void;
  onOpen: (path: string, line: number) => void;
}

/**
 * Every `#tag` in the vault, under the tree. Folded to its heading when it is
 * not wanted; open, each tag is a row with the number of notes it is in, and
 * choosing one lists those notes - each opening at the line the tag is on.
 *
 * Not read at all while it is folded: it means reading every note in the
 * vault, which is not worth doing for a count nobody can see.
 */
export default function Tags({ index, isOpen, onToggle, onOpen }: TagsProps) {
  // The tag whose notes are showing, by name - one at a time keeps the list short.
  const [chosen, setChosen] = useState<string | null>(null);

  return (
    <section className="border-t border-zinc-800 px-2 py-1.5">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={isOpen}
        className="flex w-full cursor-pointer items-center gap-1 rounded px-1 py-1 text-[11px] font-medium tracking-wide text-zinc-500 uppercase transition-colors hover:text-zinc-300"
      >
        <ChevronRight className={cn("h-3 w-3 transition-transform", isOpen && "rotate-90")} />
        Tags
        {isOpen && <span className="ml-auto tabular-nums normal-case">{index.tags.length}</span>}
      </button>

      {isOpen && (
        <div className="animate-fade-in max-h-44 overflow-y-auto">
          {index.tags.length === 0 ? (
            <p className="px-2 py-1.5 text-xs text-zinc-600">No tags yet. Write #something in a note.</p>
          ) : (
            <ul className="space-y-0.5 pt-0.5">
              {index.tags.map((tag) => {
                const open = chosen === tag.name;
                return (
                  <li key={tag.name}>
                    <button
                      type="button"
                      onClick={() => setChosen(open ? null : tag.name)}
                      aria-expanded={open}
                      className="flex w-full cursor-pointer items-center gap-1.5 rounded-md px-2 py-1.5 text-left text-sm compact:py-0.5 text-zinc-400 transition-colors hover:bg-zinc-800/50 hover:text-zinc-100"
                    >
                      <span className="truncate text-[var(--nuza-accent)]">#{tag.name}</span>
                      <span className="ml-auto shrink-0 pl-2 text-[11px] tabular-nums text-zinc-600">
                        {tag.notes}
                      </span>
                    </button>

                    {open && (
                      <ul className="space-y-0.5 pb-1 pl-3">
                        {firstUseInEachNote(tag).map((use) => (
                          <li key={use.from}>
                            <button
                              type="button"
                              onClick={() => onOpen(use.from, use.line)}
                              title={`${use.from}:${use.line}`}
                              className="flex w-full cursor-pointer items-center gap-1.5 rounded-md px-2 py-1 text-left text-xs text-zinc-500 transition-colors hover:bg-zinc-800/50 hover:text-zinc-100"
                            >
                              <FileIcon name={fileNameOf(use.from)} />
                              <span className="truncate">{fileNameOf(use.from)}</span>
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}
