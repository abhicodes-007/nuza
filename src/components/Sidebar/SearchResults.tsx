import { useEffect, useRef } from "react";
import { cn } from "cn";
import { FileMatch } from "@/lib/fileSearch";
import { ContentHit, folderWithin, previewHighlight } from "@/lib/contentSearch";
import { fileNameOf } from "@/lib/media";
import { FileIcon } from "@/lib/utils";
import MatchedText from "../MatchedText";

interface SearchResultsProps {
  matches: FileMatch[];
  /** Lines in the notes' text that hold the query, listed after the file names. */
  contentHits: ContentHit[];
  rootPath: string;
  /** Counts through the file matches first, then the content hits. */
  activeIndex: number;
  currentFile: string;
  onHover: (index: number) => void;
  onSelect: (path: string) => void;
  onSelectHit: (hit: ContentHit) => void;
}

export default function SearchResults({
  matches,
  contentHits,
  rootPath,
  activeIndex,
  currentFile,
  onHover,
  onSelect,
  onSelectHit,
}: SearchResultsProps) {
  const listRef = useRef<HTMLDivElement>(null);

  // Keep the keyboard-selected row visible without yanking the list around.
  useEffect(() => {
    listRef.current?.querySelectorAll("[data-result]")[activeIndex]?.scrollIntoView({ block: "nearest" });
  }, [activeIndex]);

  if (matches.length === 0 && contentHits.length === 0) {
    return <p className="animate-fade-in mt-6 text-center text-xs text-zinc-600">No files match.</p>;
  }

  const rowClass = (index: number, path: string) =>
    cn(
      "flex w-full cursor-pointer rounded-md px-2 py-1.5 text-left text-sm transition-colors compact:py-0.5",
      index === activeIndex ? "bg-zinc-800 text-white" : currentFile === path ? "text-white" : "text-zinc-400"
    );

  return (
    <div ref={listRef} className="animate-fade-in">
      <ul className="space-y-0.5">
        {matches.map((match, index) => (
          <li key={match.entry.path}>
            <button
              data-result
              onMouseEnter={() => onHover(index)}
              onClick={() => onSelect(match.entry.path)}
              title={match.directory ? `${match.directory}/${match.entry.name}` : match.entry.name}
              className={cn(rowClass(index, match.entry.path), "items-center gap-1.5")}
            >
              <FileIcon name={match.entry.name} />
              <span className="truncate">
                <MatchedText name={match.entry.name} highlight={match.highlight} />
              </span>
              {match.directory && (
                <span className="ml-auto min-w-0 shrink truncate pl-2 text-right text-[11px] text-zinc-600">
                  {match.directory}
                </span>
              )}
            </button>
          </li>
        ))}
      </ul>

      {contentHits.length > 0 && (
        <>
          <p className="mt-3 mb-1 px-2 text-[11px] font-medium tracking-wide text-zinc-600 uppercase">
            In notes
          </p>
          <ul className="space-y-0.5">
            {contentHits.map((hit, offset) => {
              const index = matches.length + offset;
              const name = fileNameOf(hit.path);
              const folder = folderWithin(rootPath, hit.path);
              return (
                <li key={`${hit.path}:${hit.line}`}>
                  <button
                    data-result
                    onMouseEnter={() => onHover(index)}
                    onClick={() => onSelectHit(hit)}
                    title={`${folder ? `${folder}/` : ""}${name}:${hit.line}`}
                    className={cn(rowClass(index, hit.path), "flex-col gap-0.5")}
                  >
                    <span className="flex w-full min-w-0 items-center gap-1.5">
                      <FileIcon name={name} />
                      <span className="truncate">{name}</span>
                      <span className="ml-auto shrink-0 pl-2 text-[11px] text-zinc-600">{hit.line}</span>
                    </span>
                    <span className="w-full truncate pl-5 text-xs text-zinc-500">
                      <MatchedText name={hit.preview} highlight={previewHighlight(hit)} />
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </div>
  );
}
