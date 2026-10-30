// ABOUTME: Public gallery of shared collages: a hand-picked list, each framed on its mat over a detail card.
// ABOUTME: Each frame shows the share's baked cover; its card is tinted with the cover's own colours.

import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { createRoot } from "react-dom/client";
import { ASSETS_URL, WORKER_URL } from "@movement/config";
import { madeOn } from "@extension/entrypoints/scraps/CollageMat";
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
  return when ? `${what} · ${when}` : what;
}

/** The cursor a maker browses with, as their name tag on the card. */
function MakerTag({ by }: { by: CollageMaker }) {
  return (
    <span className="collage-board__maker">
      <svg
        className="collage-board__cursor"
        viewBox="0 0 12 16"
        aria-hidden="true"
      >
        <path
          d="M1 1 L1 13 L4.2 10 L6.6 15 L8.6 14 L6.3 9.2 L10.6 9.2 Z"
          fill={by.color}
          stroke="#2d2a27"
          strokeWidth="1"
          strokeLinejoin="round"
        />
      </svg>
      <span
        className="collage-board__name"
        style={{ backgroundColor: by.color }}
      >
        {by.name}
      </span>
    </span>
  );
}

function PinnedCard({ pinned, at }: { pinned: Pinned; at: number }) {
  const { id, by, collage } = pinned;
  const [colors, setColors] = useState<string[]>([]);
  const title = collage.title.trim() || "untitled collage";
  const tint = colors[0] ?? by.color;
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
        style={
          {
            "--card-tint": tint,
            transform: `rotate(${CARD_TILTS[at % CARD_TILTS.length]}deg)`,
          } as CSSProperties
        }
      >
        <span className="collage-board__swatches" aria-hidden="true">
          {colors.map((color) => (
            <span
              key={color}
              className="collage-board__swatch"
              style={{ backgroundColor: color }}
            />
          ))}
        </span>
        <MakerTag by={by} />
        <span className="collage-board__meta">{captionMeta(collage)}</span>
        <span className="collage-board__open">
          see where every scrap came from &#8599;
        </span>
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
    <div className="collage-board">
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
