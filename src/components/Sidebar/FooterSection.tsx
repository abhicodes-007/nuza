import { ReactNode } from "react";
import { ChevronRight } from "lucide-react";
import { cn } from "cn";

interface FooterSectionProps {
  title: string;
  /** Shown beside the title when there is something to count; nothing for zero. */
  count?: number;
  isOpen: boolean;
  onToggle: () => void;
  children: ReactNode;
}

/**
 * One of the collapsible lists at the foot of the sidebar: a quiet one-line
 * heading, and a body that opens by growing rather than appearing.
 *
 * The body stays mounted while it is folded so that it can close the same way
 * it opened; `inert` is what keeps its rows out of the tab order and away
 * from clicks in the meantime.
 */
export default function FooterSection({ title, count, isOpen, onToggle, children }: FooterSectionProps) {
  return (
    <section>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={isOpen}
        className="group flex h-7 w-full cursor-pointer items-center gap-1.5 rounded-md px-2 text-xs text-zinc-500 transition-colors hover:bg-zinc-800/40 hover:text-zinc-300 compact:h-6"
      >
        <ChevronRight
          className={cn(
            "h-3 w-3 shrink-0 transition-transform duration-150 motion-reduce:transition-none",
            isOpen && "rotate-90"
          )}
        />
        <span className="font-medium">{title}</span>
        {!!count && (
          <span className="ml-auto rounded-full bg-zinc-800 px-1.5 text-[10px] leading-4 tabular-nums text-zinc-400">
            {count}
          </span>
        )}
      </button>

      {/* 0fr to 1fr is the one thing that animates a height without knowing it. */}
      <div
        className={cn(
          "grid transition-[grid-template-rows] duration-150 ease-out motion-reduce:transition-none",
          isOpen ? "grid-rows-[1fr]" : "grid-rows-[0fr]"
        )}
      >
        <div inert={!isOpen} className="min-h-0 overflow-hidden">
          <div className="max-h-36 overflow-y-auto pb-1">{children}</div>
        </div>
      </div>
    </section>
  );
}
