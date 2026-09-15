"use client";

import { useEffect, useState } from "react";

export function useMediaQuery(query: string, fallback = false): boolean {
  const [matches, setMatches] = useState(fallback);

  useEffect(() => {
    const list = window.matchMedia(query);
    setMatches(list.matches);
    const handler = (event: MediaQueryListEvent) => setMatches(event.matches);
    list.addEventListener("change", handler);
    return () => list.removeEventListener("change", handler);
  }, [query]);

  return matches;
}
