import { ChevronRight } from "lucide-react";
import { cn } from "cn";
import { WikiLinkRef } from "@/lib/markdown/wikiLinks";
import { fileNameOf } from "@/lib/media";
import { FileIcon } from "@/lib/utils";

interface BacklinksProps {
  links: WikiLinkRef[];
  isOpen: boolean;
  onToggle: () => void;
  onOpen: (path: string, line: number) => void;
}

/**
 * The notes that link to the open one, under the tree. Folded to its heading
 * when it is not wanted; open, each link is a row naming the note it is in and
 * showing the line it is on, and choosing it opens that note at that line.
 */
export default function Backlinks({ links, isOpen, onToggle, onOpen }: BacklinksProps) {
  return (
    <section className="border-t border-zinc-800 px-2 py-1.5">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={isOpen}
        className="flex w-full cursor-pointer items-center gap-1 rounded px-1 py-1 text-[11px] font-medium tracking-wide text-zinc-500 uppercase transition-colors hover:text-zinc-300"
      >
        <ChevronRight className={cn("h-3 w-3 transition-transform", isOpen && "rotate-90")} />
        Linked mentions
        <span className="ml-auto tabular-nums normal-case">{links.length}</span>
      </button>

      {isOpen && (
        <div className="animate-fade-in max-h-44 overflow-y-auto">
          {links.length === 0 ? (
            <p className="px-2 py-1.5 text-xs text-zinc-600">No notes link here.</p>
          ) : (
            <ul className="space-y-0.5 pt-0.5">
              {links.map((link) => (
                <li key={`${link.from}:${link.line}:${link.target}`}>
                  <button
                    type="button"
                    onClick={() => onOpen(link.from, link.line)}
                    title={`${link.from}:${link.line}`}
                    className="flex w-full cursor-pointer flex-col gap-0.5 rounded-md px-2 py-1.5 text-left text-sm text-zinc-400 transition-colors hover:bg-zinc-800/50 hover:text-zinc-100"
                  >
                    <span className="flex w-full min-w-0 items-center gap-1.5">
                      <FileIcon name={fileNameOf(link.from)} />
                      <span className="truncate">{fileNameOf(link.from)}</span>
                      <span className="ml-auto shrink-0 pl-2 text-[11px] text-zinc-600">{link.line}</span>
                    </span>
                    <span className="w-full truncate pl-5 text-xs text-zinc-500">{link.preview}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}
