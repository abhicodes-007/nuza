import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { ContentHit, MIN_CONTENT_QUERY } from "@/lib/contentSearch";

/** How long typing has to pause before the vault's notes are searched. */
const SEARCH_DELAY = 150;

/**
 * The lines of the open vault's notes that hold `query`, best match first,
 * searched once typing pauses. The backend answers from an index it keeps of
 * the vault's text, so a search is the cost of scanning memory and not of
 * reading every note; the pause is only there so that a word being typed is
 * searched once and not letter by letter. One that comes back after a newer
 * one was asked for is dropped, so the list never shows hits for what was
 * typed before.
 *
 * With `pattern`, `query` is a regular expression, and `error` says so when
 * it is not one.
 */
export function useContentSearch(query: string, enabled: boolean, pattern = false) {
  const [hits, setHits] = useState<ContentHit[]>([]);
  const [error, setError] = useState<string | null>(null);
  const latest = useRef(0);
  const needle = enabled ? query.trim() : "";

  useEffect(() => {
    const mine = ++latest.current;
    if (needle.length < MIN_CONTENT_QUERY) {
      setHits([]);
      setError(null);
      return;
    }

    const timer = setTimeout(() => {
      invoke<ContentHit[]>("search_contents", { query: needle, pattern })
        .then((found) => {
          if (mine !== latest.current) return;
          setHits(found);
          setError(null);
        })
        .catch((failure) => {
          if (mine !== latest.current) return;
          setHits([]);
          // A pattern that is not one is said; any other failure is an empty
          // search, with nothing for the person to act on.
          if (pattern) setError(String(failure));
          else console.error("Couldn't search the notes:", failure);
        });
    }, SEARCH_DELAY);

    return () => clearTimeout(timer);
  }, [needle, pattern]);

  return { hits, error };
}
