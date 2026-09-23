// ABOUTME: Draws a placed piece's material, cut out when the piece asks for it.
// ABOUTME: A cut image keeps its original `<img>` under a CSS mask, so animation plays on.

import React, { useEffect, useState } from "react";
import { ScrapContent } from "@movement/components/ScrapCollage";
import { maskPositionPercent } from "./backgroundCutout";
import { cutoutMaskImage, type CutoutMaskImage } from "./cutoutImages";
import type { CollagePiece } from "./collageRecord";
import { sourceBoxForCrop } from "./collageGeometry";
import { isLettered, letteringLayout } from "./pieceLettering";

interface PieceMaterialProps {
  piece: CollagePiece;
  /** Told when the cut could not be computed, so the studio can say so. */
  onCutoutFailed?: (pieceId: string, reason: string) => void;
}

/** CSS that lays a cutout mask over the cropped region of the whole source. */
function maskStyle(mask: CutoutMaskImage): React.CSSProperties {
  const { placement } = mask;
  const image = `url(${mask.url})`;
  const size = `${placement.width * 100}% ${placement.height * 100}%`;
  const position = `${maskPositionPercent(placement.x, placement.width)}% ${maskPositionPercent(
    placement.y,
    placement.height,
  )}%`;
  return {
    maskImage: image,
    maskSize: size,
    maskPosition: position,
    maskRepeat: "no-repeat",
    WebkitMaskImage: image,
    WebkitMaskSize: size,
    WebkitMaskPosition: position,
    WebkitMaskRepeat: "no-repeat",
  };
}

/**
 * The piece's own imagery. An image with a cutout waits for its mask rather
 * than showing the uncut image, so what is on screen is never a stand-in for a
 * cut that did not happen. The mask is computed over the piece's crop, so a
 * new crop brings a new cut.
 */
export function PieceMaterial({ piece, onCutoutFailed }: PieceMaterialProps) {
  const { scrap, cutout, crop } = piece;
  const wantsCutout = scrap.kind === "image" && cutout !== undefined;
  const src = scrap.kind === "image" ? scrap.src : "";
  const [mask, setMask] = useState<CutoutMaskImage | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!wantsCutout || !cutout) {
      setMask(null);
      setFailed(false);
      return;
    }
    let cancelled = false;
    setFailed(false);
    // The previous mask stays up until the new one is ready, so dragging the
    // tolerance slider does not flicker the piece away between steps.
    cutoutMaskImage(src, cutout, crop)
      .then((next) => {
        if (!cancelled) setMask(next);
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setFailed(true);
        setMask(null);
        onCutoutFailed?.(
          piece.id,
          error instanceof Error ? error.message : String(error),
        );
      });
    return () => {
      cancelled = true;
    };
  }, [
    crop.x,
    crop.y,
    crop.width,
    crop.height,
    cutout,
    onCutoutFailed,
    piece.id,
    src,
    wantsCutout,
  ]);

  if (wantsCutout) {
    if (failed) {
      return <span className="collage-piece__missing" aria-hidden="true" />;
    }
    if (!mask) {
      return <span className="collage-piece__pending" aria-hidden="true" />;
    }
    return (
      <img
        className="collage-piece__cut"
        src={src}
        alt={scrap.kind === "image" ? (scrap.alt ?? "") : ""}
        draggable={false}
        style={maskStyle(mask)}
      />
    );
  }

  const content = (
    <ScrapContent
      item={scrap}
      loaded={true}
      onLoad={() => {}}
      onError={() => {}}
    />
  );
  if (!isLettered(scrap)) return content;

  // Words are set at the scrap's own type size and scaled to the piece's box,
  // so a resized heading or button grows and shrinks its lettering with it.
  const layout = letteringLayout(scrap, sourceBoxForCrop(piece, piece.crop));
  return (
    <div
      className="collage-piece__lettering"
      style={{
        width: layout.width,
        height: layout.height,
        transform: `scale(${layout.scale})`,
      }}
    >
      {content}
    </div>
  );
}
