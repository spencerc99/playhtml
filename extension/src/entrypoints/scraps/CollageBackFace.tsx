// ABOUTME: The back face of the collage in the studio: paper, the front showing through, the sources.
// ABOUTME: Sets the same markup the bake rasterizes, with the same inlined fonts, so it matches the export.

import React, { useEffect, useMemo, useState } from "react";
import type { CollageFrame } from "./collageRecord";
import type { CollagePaper } from "./collageFormats";
import {
  collageBackMarkup,
  type BackFavicon,
  type CollageBackContent,
} from "./collageBack";
import {
  backAssets,
  bleedDataUrl,
  resolveBackFavicons,
  type BackAssets,
} from "./bakeCollageBack";
import { paperBackground } from "./paperGrain";

interface CollageBackFaceProps {
  frame: CollageFrame;
  paper: CollagePaper;
  content: CollageBackContent;
  /** The baked front, shown mirrored and faint, or null while there is none. */
  front: Blob | null;
  /** Whether the collage is turned over, so this face is the one being read. */
  showing: boolean;
  /** Told when something the back needs could not be read. */
  onProblem: (text: string) => void;
}

export function CollageBackFace({
  frame,
  paper,
  content,
  front,
  showing,
  onProblem,
}: CollageBackFaceProps) {
  const [assets, setAssets] = useState<BackAssets | null>(null);
  const [favicons, setFavicons] = useState<ReadonlyMap<string, BackFavicon>>(
    () => new Map(),
  );
  const [bleed, setBleed] = useState<string | null>(null);

  // Nothing is fetched until the back is actually being read.
  useEffect(() => {
    if (!showing || assets) return;
    let cancelled = false;
    backAssets()
      .then((loaded) => {
        if (!cancelled) setAssets(loaded);
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          onProblem(
            `the back could not be written — ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      });
    return () => {
      cancelled = true;
    };
  }, [assets, onProblem, showing]);

  // The key stands for the list of pages and their favicons, so moving pieces
  // around fetches nothing.
  const sourcesKey = content.sources
    .map((source) => `${source.pageUrl}\n${source.faviconUrl ?? ""}`)
    .join("\n");
  useEffect(() => {
    if (!showing) return;
    let cancelled = false;
    void resolveBackFavicons(content.sources).then((resolved) => {
      if (!cancelled) setFavicons(resolved);
    });
    return () => {
      cancelled = true;
    };
  }, [showing, sourcesKey]);

  useEffect(() => {
    if (!front) {
      setBleed(null);
      return;
    }
    let cancelled = false;
    bleedDataUrl(front, frame)
      .then((url) => {
        if (!cancelled) setBleed(url);
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          onProblem(
            `the front could not be shown through the back — ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      });
    return () => {
      cancelled = true;
    };
  }, [frame, front, onProblem]);

  const markup = useMemo(
    () =>
      assets
        ? collageBackMarkup({
            frame,
            paper,
            content,
            favicons,
            bleed,
            markIcon: assets.markIcon,
          })
        : null,
    [assets, bleed, content, favicons, frame, paper],
  );

  const name = content.title.trim() || "untitled collage";
  return (
    <section
      className="collage-back"
      inert={!showing}
      aria-label={`The back of ${name}`}
      style={{
        width: frame.width,
        height: frame.height,
        // Bare paper while the writing's fonts are still being read.
        ...paperBackground(paper.color, paper.grain, frame.width, frame.height),
      }}
    >
      {assets && markup && (
        <>
          <style>{assets.fontFaces}</style>
          <div
            className="collage-back__text"
            dangerouslySetInnerHTML={{ __html: markup }}
          />
        </>
      )}
      <div className="collage-frame__edge" />
    </section>
  );
}
