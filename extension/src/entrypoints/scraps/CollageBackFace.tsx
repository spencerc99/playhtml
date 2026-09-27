// ABOUTME: The back face of the collage in the studio: paper, the front showing through, the sources.
// ABOUTME: Sets the same markup the bake rasterizes, with the same inlined fonts, so it matches the export.

import React, {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { CollageFrame } from "./collageRecord";
import type { CollagePaper } from "./collageFormats";
import {
  backInk,
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
  /** Told as the title written on the back is edited. */
  onTitle: (title: string) => void;
}

/** Where the written title sits on the back, and the type it is set in. */
interface TitlePlace {
  left: number;
  top: number;
  width: number;
  height: number;
  font: string;
}

/**
 * Finds the title the back's markup wrote, measured in the back's own units.
 * Offsets are summed rather than read from the screen, because the sheet is
 * scaled and turned in 3D.
 */
function titlePlace(container: HTMLElement): TitlePlace | null {
  const title = container.querySelector<HTMLElement>(".collage-back__title");
  if (!title) return null;
  let left = 0;
  let top = 0;
  let node: HTMLElement | null = title;
  while (node && node !== container) {
    left += node.offsetLeft;
    top += node.offsetTop;
    node = node.offsetParent as HTMLElement | null;
  }
  if (node !== container) {
    throw new Error("The back's title is not laid out inside the back");
  }
  return {
    left,
    top,
    width: title.offsetWidth,
    height: title.offsetHeight,
    font: title.style.font,
  };
}

export function CollageBackFace({
  frame,
  paper,
  content,
  front,
  showing,
  onProblem,
  onTitle,
}: CollageBackFaceProps) {
  const textRef = useRef<HTMLDivElement>(null);
  const [place, setPlace] = useState<TitlePlace | null>(null);
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

  // The written title is overlaid with a field set in the same place and type,
  // so it is edited where it is read. The markup stays the one the bake draws.
  useLayoutEffect(() => {
    const container = textRef.current;
    setPlace(container && markup ? titlePlace(container) : null);
  }, [markup]);

  const ink = backInk(paper.color);
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
            ref={textRef}
            className={`collage-back__text${place ? " collage-back__text--titled" : ""}`}
            dangerouslySetInnerHTML={{ __html: markup }}
          />
          {place && (
            <textarea
              className="collage-back__title-field"
              value={content.title}
              placeholder="untitled collage"
              aria-label="Collage title"
              rows={1}
              spellCheck={false}
              onChange={(event) =>
                // A title is one line; a pasted break becomes a space.
                onTitle(event.target.value.replace(/[\r\n]+/g, " "))
              }
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === "Escape") {
                  event.preventDefault();
                  event.currentTarget.blur();
                }
              }}
              style={
                {
                  left: place.left,
                  top: place.top,
                  width: place.width,
                  height: place.height,
                  font: place.font,
                  color: ink.ink,
                  "--collage-back-muted": ink.muted,
                } as React.CSSProperties
              }
            />
          )}
        </>
      )}
      <div className="collage-frame__edge" />
    </section>
  );
}
