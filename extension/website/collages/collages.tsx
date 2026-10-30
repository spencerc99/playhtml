// ABOUTME: Public gallery of shared collages: a hand-picked list, each framed on its mat over a detail card.
// ABOUTME: Each frame shows the share's baked cover; its card is washed with blurred blots of the cover's own colours.

import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { createRoot } from "react-dom/client";
import { ASSETS_URL, WORKER_URL } from "@movement/config";
import { madeOn } from "@extension/entrypoints/scraps/CollageMat";
import { grainDataUrl } from "@extension/entrypoints/scraps/paperGrain";
import {
  isPublishedCollageId,
  publishedCollageViewerUrl,
  type PublishedCollage,
} from "../../shared/publishedCollage";
import { loadPublishedCollage } from "../collage/publishedCollageView";
import { CHANGELOG_URL, LIVE_PORTRAIT_URL } from "../src/navigation";
import {
  PINNED_COLLAGES,
  type CollageMaker,
  type PinnedCollage,
} from "./pinnedCollages";
import { coverColors } from "./coverPalette";
import { GALLERY_STYLES } from "./galleryStyles";

interface Pinned {
  id: string;
  by: CollageMaker;
  collage: PublishedCollage;
}

/** Small, steady tilts, so the cards look laid down by hand but read the same on every visit. */
const CARD_TILTS = [1.5, -1, 2, -1.5, 1, -2];
const SHARE_PILLS = 7;
const PAGE_GRAIN = grainDataUrl(240, 240);

/**
 * The collages to pin up. A local build can try others with `?ids=a,b`, so
 * the board can be checked against collages shared to a local Worker.
 */
function pinnedCollages(): readonly PinnedCollage[] {
  if (import.meta.env.DEV) {
    const override = new URLSearchParams(window.location.search).get("ids");
    if (override) {
      return override
        .split(",")
        .filter(isPublishedCollageId)
        .map((id) => ({ id, by: PINNED_COLLAGES[0].by }));
    }
  }
  return PINNED_COLLAGES;
}

function countOf(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

function captionMeta(collage: PublishedCollage): string {
  const sites = new Set(collage.pieces.map((piece) => piece.source.domain))
    .size;
  const when = collage.createdAt
    ? `made ${madeOn(collage.createdAt)}`
    : collage.sharedAt
      ? `shared ${madeOn(collage.sharedAt)}`
      : null;
  const what = `${countOf(collage.pieces.length, "scrap", "scraps")} from ${countOf(sites, "site", "sites")}`;
  // The date never breaks across lines.
  return when ? `${what} · ${when.replace(/ /g, "\u00a0")}` : what;
}

/** A steady pseudo-random sequence, so a collage's wash keeps its shape on every visit. */
function seeded(text: string): () => number {
  let state = 0;
  for (const char of text) state = (state * 31 + char.charCodeAt(0)) | 0;
  return () => {
    state = (state * 1103515245 + 12345) & 0x7fffffff;
    return state / 0x7fffffff;
  };
}

/** Where each blot of colour sits on the card, in percent of the card, before its own wobble. */
const BLOTS = [
  { x: -12, y: -40, w: 70, h: 150, blur: 22, opacity: 0.42 },
  { x: 48, y: 10, w: 55, h: 120, blur: 26, opacity: 0.38 },
  { x: 22, y: 55, w: 40, h: 80, blur: 20, opacity: 0.3 },
];

/** Soft, uneven blots of the collage's own colours, bleeding into its card. */
function cardWash(id: string, colors: readonly string[]): CSSProperties[] {
  const random = seeded(id);
  const corner = () => `${Math.round(34 + random() * 32)}%`;
  return colors.slice(0, BLOTS.length).map((color, i) => {
    const blot = BLOTS[i];
    return {
      left: `${blot.x}%`,
      top: `${blot.y}%`,
      width: `${blot.w}%`,
      height: `${blot.h}%`,
      background: color,
      borderRadius: `${corner()} ${corner()} ${corner()} ${corner()} / ${corner()} ${corner()} ${corner()} ${corner()}`,
      filter: `blur(${blot.blur}px)`,
      opacity: blot.opacity,
      transform: `rotate(${Math.round((random() - 0.5) * 60)}deg)`,
    };
  });
}

function PinnedCard({ pinned, at }: { pinned: Pinned; at: number }) {
  const { id, by, collage } = pinned;
  const [colors, setColors] = useState<string[]>([]);
  const title = collage.title.trim() || "untitled collage";
  // A collage with no loud colour of its own takes its maker's.
  const wash = useMemo(
    () => cardWash(id, colors.length > 0 ? colors : [by.color]),
    [id, colors, by.color],
  );
  return (
    <a
      className="collage-board__pin"
      href={publishedCollageViewerUrl(id, window.location.origin)}
    >
      {/* The same mat the studio mounts a collage on, with its caption along the bottom. */}
      <div className="collage-board__mat">
        <div
          className="collage-board__window"
          style={{
            aspectRatio: `${collage.frame.width} / ${collage.frame.height}`,
          }}
        >
          <img
            className="collage-board__cover"
            src={`${ASSETS_URL}/collages/${encodeURIComponent(id)}/cover`}
            alt={`${title}, a collage`}
            crossOrigin="anonymous"
            decoding="async"
            onLoad={(event) => setColors(coverColors(event.currentTarget))}
          />
        </div>
        <div className="collage-board__caption">
          <span className="collage-board__title">{title}</span>
        </div>
      </div>
      <div
        className="collage-board__card"
        style={{
          transform: `rotate(${CARD_TILTS[at % CARD_TILTS.length]}deg)`,
        }}
      >
        {wash.map((style, i) => (
          <span key={i} className="collage-board__blot" style={style} />
        ))}
        <span
          className="collage-board__name"
          style={{ backgroundColor: by.color }}
        >
          {by.name}
        </span>
        <span className="collage-board__meta">{captionMeta(collage)}</span>
      </div>
    </a>
  );
}

function usePinnedCollages(list: readonly PinnedCollage[]): Pinned[] | null {
  const [pinned, setPinned] = useState<Pinned[] | null>(null);
  useEffect(() => {
    let cancelled = false;
    void Promise.all(
      list.map(async ({ id, by }) => {
        const load = await loadPublishedCollage(WORKER_URL, id);
        if (load.kind === "ok") return { id, by, collage: load.collage };
        if (load.kind === "error") {
          console.warn(`[collages] ${id} could not be opened:`, load.message);
        }
        return null;
      }),
    ).then((loaded) => {
      if (cancelled) return;
      const found = loaded.filter((entry): entry is Pinned => entry !== null);
      // Newest share first; the list's own order breaks ties.
      found.sort(
        (a, b) => (b.collage.sharedAt ?? 0) - (a.collage.sharedAt ?? 0),
      );
      setPinned(found);
    });
    return () => {
      cancelled = true;
    };
  }, [list]);
  return pinned;
}

function CollagesPage() {
  const list = useMemo(pinnedCollages, []);
  const pinned = usePinnedCollages(list);

  return (
    <div
      className="collage-board"
      // The studio's own grained paper, tiled across the page.
      style={{ backgroundImage: `url("${PAGE_GRAIN}")` }}
    >
      <style>{GALLERY_STYLES}</style>
      <nav className="collage-board__nav" aria-label="Site navigation">
        <a className="collage-board__wordmark" href="/">
          we were online
        </a>
        <span className="collage-board__links">
          <a href="/collages/" aria-current="page">
            collages
          </a>
          <a href={LIVE_PORTRAIT_URL}>live portrait</a>
          <a href={CHANGELOG_URL}>changelog</a>
        </span>
      </nav>

      <header className="collage-board__header">
        <h1 className="collage-board__heading">collages</h1>
        <p className="collage-board__lede">
          things people found online, pinned up together
        </p>
        <div className="collage-board__note" aria-hidden="true">
          <img
            className="collage-board__tape"
            src="/collages/tapes/yellow.png"
            alt=""
            style={{ width: 92, left: 54, top: -14, transform: "rotate(5deg)" }}
          />
          <span>every scrap still links back to where it was found</span>
        </div>
        <div className="collage-board__cta">
          <img
            className="collage-board__tape"
            src="/collages/tapes/blue-grey.png"
            alt=""
            style={{
              width: 78,
              right: 30,
              left: "auto",
              top: -13,
              transform: "rotate(-7deg)",
            }}
          />
          <a href="/">pin up your own &#187;</a>
        </div>
      </header>

      <section className="collage-board__section" aria-labelledby="favorites">
        <div className="collage-board__band">
          <span className="collage-board__streak" aria-hidden="true" />
          <h2 id="favorites" className="collage-board__favorites">
            favorites
          </h2>
        </div>
        <div className="collage-board__shares" aria-hidden="true">
          {Array.from({ length: SHARE_PILLS }, (_, i) => (
            <span
              key={i}
              className="collage-board__share"
              style={{ opacity: 1 - i * 0.11 }}
            >
              Share
            </span>
          ))}
        </div>

        {pinned === null ? (
          <p className="collage-board__status" role="status">
            pinning up the collages...
          </p>
        ) : pinned.length === 0 ? (
          <p className="collage-board__status" role="status">
            nothing is pinned up yet.
          </p>
        ) : (
          <div className="collage-board__grid">
            {pinned.map((entry, at) => (
              <PinnedCard key={entry.id} pinned={entry} at={at} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

const container = document.getElementById("reactContent");
if (container) createRoot(container).render(<CollagesPage />);
