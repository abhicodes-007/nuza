import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { ContentHit, MIN_CONTENT_QUERY } from "@/lib/contentSearch";

/** How long typing has to pause before the vault's notes are read through. */
const SEARCH_DELAY = 200;

/**
 * The lines of the open vault's notes that hold `query`, searched once typing
 * pauses. A search reads every note, so it waits for the pause rather than
 * running per keystroke; and one that comes back after a newer one was asked
 * for is dropped, so the list never shows hits for what was typed before.
 */
export function useContentSearch(query: string, enabled: boolean) {
  const [hits, setHits] = useState<ContentHit[]>([]);
  const latest = useRef(0);
  const needle = enabled ? query.trim() : "";

  useEffect(() => {
    const mine = ++latest.current;
    if (needle.length < MIN_CONTENT_QUERY) {
      setHits([]);
      return;
    }

    const timer = setTimeout(() => {
      invoke<ContentHit[]>("search_contents", { query: needle })
        .then((found) => {
          if (mine === latest.current) setHits(found);
        })
        .catch((error) => {
          // A failed search is an empty one; there is nothing to act on.
          console.error("Couldn't search the notes:", error);
          if (mine === latest.current) setHits([]);
        });
    }, SEARCH_DELAY);

    return () => clearTimeout(timer);
  }, [needle]);

  return hits;
}
