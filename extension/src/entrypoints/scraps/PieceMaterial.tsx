// ABOUTME: Draws a placed piece's material, cut out when the piece asks for it.
// ABOUTME: The studio and the crop session share it so both show the same thing.

import React, { useEffect, useState } from "react";
import { ScrapContent } from "@movement/components/ScrapCollage";
import { cutoutObjectUrl } from "./cutoutImages";
import type { CollagePiece } from "./collageRecord";

interface PieceMaterialProps {
  piece: CollagePiece;
  /** Told when the cut could not be computed, so the studio can say so. */
  onCutoutFailed?: (pieceId: string, reason: string) => void;
}

/**
 * The piece's own imagery. An image with a cutout waits for its cut version
 * rather than showing the uncut image, so what is on screen is never a
 * stand-in for a cut that did not happen.
 */
export function PieceMaterial({ piece, onCutoutFailed }: PieceMaterialProps) {
  const { scrap, cutout } = piece;
  const wantsCutout = scrap.kind === "image" && cutout !== undefined;
  const src = scrap.kind === "image" ? scrap.src : "";
  const [cutUrl, setCutUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!wantsCutout || !cutout) {
      setCutUrl(null);
      setFailed(false);
      return;
    }
    let cancelled = false;
    let created: string | null = null;
    setFailed(false);
    cutoutObjectUrl(src, cutout)
      .then((url) => {
        if (cancelled) {
          URL.revokeObjectURL(url);
          return;
        }
        created = url;
        setCutUrl(url);
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setFailed(true);
        setCutUrl(null);
        onCutoutFailed?.(
          piece.id,
          error instanceof Error ? error.message : String(error),
        );
      });
    return () => {
      cancelled = true;
      if (created) URL.revokeObjectURL(created);
    };
  }, [cutout, onCutoutFailed, piece.id, src, wantsCutout]);

  if (wantsCutout) {
    if (failed) {
      return <span className="collage-piece__missing" aria-hidden="true" />;
    }
    if (!cutUrl) {
      return <span className="collage-piece__pending" aria-hidden="true" />;
    }
    return (
      <img
        className="collage-piece__cut"
        src={cutUrl}
        alt={scrap.kind === "image" ? (scrap.alt ?? "") : ""}
        draggable={false}
      />
    );
  }

  return (
    <ScrapContent
      item={scrap}
      loaded={true}
      onLoad={() => {}}
      onError={() => {}}
    />
  );
}
