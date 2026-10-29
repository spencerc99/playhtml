// ABOUTME: Public gallery of shared collages: a hand-picked list, each pinned up with tape over a catalog slip.
// ABOUTME: Each card shows the share's baked cover, the one picture of its whole front.

import { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { ASSETS_URL, WORKER_URL } from "@movement/config";
import { madeOn } from "@extension/entrypoints/scraps/CollageMat";
import {
  isPublishedCollageId,
  publishedCollageViewerUrl,
  type PublishedCollage,
} from "../../shared/publishedCollage";
import { loadPublishedCollage } from "../collage/publishedCollageView";
import { PINNED_COLLAGES } from "./pinnedCollages";
import { GALLERY_STYLES } from "./galleryStyles";

interface Pinned {
  id: string;
  collage: PublishedCollage;
}

const TAPES = ["pink", "yellow", "blue-grey"] as const;
/** Small, steady tilts, so the board looks pinned by hand but reads the same on every visit. */
const CARD_TILTS = [-1, 0.8, -0.5, 1.2, -1.4, 0.6];
const SLIP_TILTS = [1.5, -1, 2, -1.5, 1, -2];
const TAPE_TILTS = [-4, 6, -2, 3, 7, -5];
const TAPE_WIDTHS = [110, 96, 120, 104, 90, 116];

/**
 * The ids to pin up. A local build can try others with `?ids=a,b`, so the
 * board can be checked against collages shared to a local Worker.
 */
function pinnedIds(): readonly string[] {
  if (import.meta.env.DEV) {
    const override = new URLSearchParams(window.location.search).get("ids");
    if (override) return override.split(",").filter(isPublishedCollageId);
  }
  return PINNED_COLLAGES;
}

function countOf(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

function slipMeta(collage: PublishedCollage): string {
  const sites = new Set(collage.pieces.map((piece) => piece.source.domain))
    .size;
  const when = collage.createdAt
    ? `made ${madeOn(collage.createdAt)}`
    : collage.sharedAt
      ? `shared ${madeOn(collage.sharedAt)}`
      : null;
  const what = `${countOf(collage.pieces.length, "scrap", "scraps")} from ${countOf(sites, "site", "sites")}`;
  return when ? `${when} · ${what}` : what;
}

/** Every shared collage carries a cover: one baked picture of its whole front. */
function CollageFace({ id, collage }: Pinned) {
  const title = collage.title.trim() || "untitled collage";
  return (
    <div
      className="collage-board__face"
      style={{
        aspectRatio: `${collage.frame.width} / ${collage.frame.height}`,
      }}
    >
      <img
        className="collage-board__cover"
        src={`${ASSETS_URL}/collages/${encodeURIComponent(id)}/cover`}
        alt={`${title}, a collage`}
        decoding="async"
      />
    </div>
  );
}

function PinnedCard({ pinned, at }: { pinned: Pinned; at: number }) {
  const { id, collage } = pinned;
  const k = at % CARD_TILTS.length;
  const tapeWidth = TAPE_WIDTHS[k];
  const title = collage.title.trim() || "untitled collage";
  return (
    <a
      className="collage-board__pin"
      href={publishedCollageViewerUrl(id, window.location.origin)}
      style={{ transform: `rotate(${CARD_TILTS[k]}deg)` }}
    >
      <img
        className="collage-board__tape"
        src={`/collages/tapes/${TAPES[at % TAPES.length]}.png`}
        alt=""
        style={{
          width: tapeWidth,
          marginLeft: -tapeWidth / 2,
          transform: `rotate(${TAPE_TILTS[k]}deg)`,
        }}
      />
      <CollageFace id={id} collage={collage} />
      <div
        className="collage-board__slip"
        style={{ transform: `rotate(${SLIP_TILTS[k]}deg)` }}
      >
        <span className="collage-board__title">{title}</span>
        <span className="collage-board__meta">{slipMeta(collage)}</span>
        <span className="collage-board__sign">
          <span className="collage-board__who">spencer</span>
          <span className="collage-board__mark">we were online &#8599;</span>
        </span>
      </div>
    </a>
  );
}

function usePinnedCollages(ids: readonly string[]): Pinned[] | null {
  const [pinned, setPinned] = useState<Pinned[] | null>(null);
  useEffect(() => {
    let cancelled = false;
    void Promise.all(
      ids.map(async (id) => {
        const load = await loadPublishedCollage(WORKER_URL, id);
        if (load.kind === "ok") return { id, collage: load.collage };
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
  }, [ids]);
  return pinned;
}

function CollagesPage() {
  const ids = useMemo(pinnedIds, []);
  const pinned = usePinnedCollages(ids);

  return (
    <div className="collage-board">
      <style>{GALLERY_STYLES}</style>
      <nav className="collage-board__nav" aria-label="Site navigation">
        <a href="/">home</a>
        <a href="/collages/" aria-current="page">
          collages
        </a>
        <a href="/portrait/">portrait</a>
        <a href="/changelog/">changelog</a>
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
          <span className="collage-board__picker">picked by spencer</span>
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
