// ABOUTME: Reports whether any image placed in a collage animates, so the studio can offer a video.
// ABOUTME: Reads each distinct image's header once per session through the kept local copy.

import { useEffect, useMemo, useState } from "react";
import type { CollagePiece } from "./collageRecord";
import { scrapImageAnimates } from "./imageAnimation";

/**
 * Whether any piece's image animates. An image whose bytes cannot be read is
 * reported and counted as still; the still export names it when it fails too.
 */
export function useCollageAnimates(pieces: readonly CollagePiece[]): boolean {
  const key = useMemo(() => {
    const srcs = new Set<string>();
    for (const piece of pieces) {
      if (piece.scrap.kind === "image") srcs.add(piece.scrap.src);
    }
    return [...srcs].sort().join("\n");
  }, [pieces]);
  const [answer, setAnswer] = useState<{ key: string; animates: boolean }>({
    key: "",
    animates: false,
  });

  useEffect(() => {
    if (!key) return;
    let cancelled = false;
    const srcs = key.split("\n");
    void Promise.all(
      srcs.map((src) =>
        scrapImageAnimates(src).catch((error: unknown) => {
          console.warn(
            `[collage] could not tell whether ${src} animates:`,
            error,
          );
          return false;
        }),
      ),
    ).then((each) => {
      if (!cancelled) setAnswer({ key, animates: each.some(Boolean) });
    });
    return () => {
      cancelled = true;
    };
  }, [key]);

  return key !== "" && answer.key === key && answer.animates;
}
