import { useEffect, useState } from "react";

export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(
    () => typeof window !== "undefined" && window.matchMedia(query).matches,
  );

  useEffect(() => {
    const mq = window.matchMedia(query);
    setMatches(mq.matches);
    const handler = (e: MediaQueryListEvent) => setMatches(e.matches);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, [query]);

  return matches;
}

// Treat a landscape phone (wide but very short) as "mobile" too — dockview crashes
// on viewports with extreme aspect ratios. The Workspace canvas needs vertical room.
export const useIsMobile = () =>
  useMediaQuery("(max-width: 767px), (max-height: 500px) and (orientation: landscape)");
