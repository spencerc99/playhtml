// ABOUTME: New-tab launch card announcing internet scraps with a strip of collected finds.
// ABOUTME: Shows the reader's newest scraps, or hosted examples when nothing has washed up yet.

import { useCallback, useEffect, useMemo, useState } from "react";
import browser from "webextension-polyfill";
import { getState, setState } from "./announcement-storage";
import { scrapsAvailable } from "../scraps-availability";
import "./ScrapsLaunchCard.scss";

export const SCRAPS_LAUNCH_CARD_ID = "scraps-2026-08-newtab";

const STRIP_CAPACITY = 8;

interface ScrapRecordBase {
  id: string;
  key: string;
  domain: string;
  pageUrl: string;
  ts: number;
  pageTitle: string;
  faviconUrl?: string;
}

type ScrapRecord = ScrapRecordBase &
  (
    | {
        kind: "image";
        src: string;
        alt?: string;
        naturalWidth: number;
        naturalHeight: number;
      }
    | {
        kind: "button";
        text: string;
        styles: Record<string, string>;
        innerSvg?: string;
      }
    | {
        kind: "svg-icon";
        markup: string;
        width: number;
        height: number;
      }
  );

interface ScrapsResponse {
  scraps?: ScrapRecord[];
  /** Every scrap collected, not only the ones returned under the limit. */
  total?: number;
}

type StripImage = { kind: "image"; key: string; src: string; alt: string };
type StripButton = {
  kind: "button";
  key: string;
  text: string;
  background: string;
};
type StripPiece = StripImage | StripButton;

// Hosted examples from our own sites, shown before the reader has any scraps.
// Each URL is verified to serve an image; a failed load hides that piece.
const EXAMPLE_PIECES: StripPiece[] = [
  {
    kind: "image",
    key: "example-candle",
    src: "https://playhtml.fun/candle-off.png",
    alt: "a candle from playhtml.fun",
  },
  {
    kind: "image",
    key: "example-sign",
    src: "https://playhtml.fun/playhtml-sign.png",
    alt: "a hand-lettered sign from playhtml.fun",
  },
  {
    kind: "button",
    key: "example-play",
    text: "play",
    background: "#4a9a8a",
  },
  {
    kind: "image",
    key: "example-bench",
    src: "https://wewere.online/red-park-bench-face-right.png",
    alt: "a red park bench from wewere.online",
  },
  {
    kind: "image",
    key: "example-construction",
    src: "https://playhtml.fun/under-construction-website.gif",
    alt: "an under-construction banner from playhtml.fun",
  },
  {
    kind: "button",
    key: "example-rsvp",
    text: "rsvp",
    background: "#5b8db8",
  },
  {
    kind: "image",
    key: "example-candle-lit",
    src: "https://playhtml.fun/candle-gif.gif",
    alt: "a lit candle from playhtml.fun",
  },
  {
    kind: "image",
    key: "example-favicon",
    src: "https://wewere.online/favicon.png",
    alt: "the wewere.online favicon",
  },
];

function hashString(value: string): number {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  }
  return hash;
}

// Deterministic scatter so a given scrap always lands the same way on the strip.
function rotationFor(key: string): number {
  return (hashString(key) % 27) - 13;
}

function driftFor(key: string): number {
  return ((hashString(`${key}:drift`) % 13) - 6) / 2;
}

function imageWidthFor(key: string): number {
  return 44 + (hashString(`${key}:width`) % 23);
}

function toStripPiece(scrap: ScrapRecord): StripPiece | null {
  switch (scrap.kind) {
    case "image":
      return {
        kind: "image",
        key: scrap.key,
        src: scrap.src,
        alt: scrap.alt ?? `an image from ${scrap.domain}`,
      };
    case "button":
      return {
        kind: "button",
        key: scrap.key,
        text: scrap.text,
        background: scrap.styles.backgroundColor ?? "#8a8279",
      };
    default:
      return null;
  }
}

// Images carry the strip; a couple of buttons show the variety the feature
// collects without crowding out the finds people actually recognize.
const STRIP_BUTTON_CAPACITY = 2;

function toStripPieces(scraps: ScrapRecord[]): StripPiece[] {
  const pieces = scraps
    .flatMap((scrap) => {
      const piece = toStripPiece(scrap);
      return piece ? [piece] : [];
    })
    .slice(0, STRIP_CAPACITY * 4);
  const images = pieces.filter((piece) => piece.kind === "image");
  const buttons = pieces
    .filter((piece) => piece.kind === "button")
    .slice(0, STRIP_BUTTON_CAPACITY);
  const chosenImages = images.slice(0, STRIP_CAPACITY - buttons.length);

  // Space the buttons through the images rather than clustering them at one end.
  const mixed: StripPiece[] = [...chosenImages];
  buttons.forEach((button, index) => {
    const position = Math.round(
      ((index + 1) * mixed.length) / (buttons.length + 1),
    );
    mixed.splice(position, 0, button);
  });
  return mixed.slice(0, STRIP_CAPACITY);
}

function StripPieceView({ piece }: { piece: StripPiece }) {
  const [failed, setFailed] = useState(false);
  if (failed) return null;

  const style = {
    transform: `rotate(${rotationFor(piece.key)}deg) translateY(${driftFor(
      piece.key,
    )}px)`,
  };

  if (piece.kind === "button") {
    return (
      <span
        className="scraps-launch__piece scraps-launch__piece--button"
        style={{ ...style, background: piece.background }}
      >
        {piece.text}
      </span>
    );
  }

  return (
    <img
      className="scraps-launch__piece scraps-launch__piece--image"
      style={{ ...style, width: `${imageWidthFor(piece.key)}px` }}
      src={piece.src}
      alt={piece.alt}
      onError={() => setFailed(true)}
    />
  );
}

export function ScrapsLaunchCard() {
  const [available, setAvailable] = useState(false);
  const [dismissed, setDismissed] = useState(true);
  const [scraps, setScraps] = useState<ScrapRecord[] | null>(null);
  const [total, setTotal] = useState(0);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      const [featureOn, seenState] = await Promise.all([
        scrapsAvailable(),
        getState(SCRAPS_LAUNCH_CARD_ID),
      ]);
      if (cancelled) return;
      const isDismissed = seenState === "dismissed";
      setAvailable(featureOn);
      setDismissed(isDismissed);
      // A card that can never render should not pay for a scrap query, so the
      // fetch waits until both the feature state and the dismissal are known.
      if (!featureOn || isDismissed) return;

      try {
        const response = (await browser.runtime.sendMessage({
          type: "GET_SCRAPS",
          options: { limit: 200 },
        })) as ScrapsResponse;
        if (cancelled) return;
        const loaded = Array.isArray(response?.scraps) ? response.scraps : [];
        setScraps(loaded);
        setTotal(response?.total ?? loaded.length);
      } catch (loadError: unknown) {
        console.error("[ScrapsLaunchCard] Could not load scraps:", loadError);
        if (!cancelled) setScraps([]);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const onDismiss = useCallback(() => {
    setDismissed(true);
    void setState(SCRAPS_LAUNCH_CARD_ID, "dismissed");
  }, []);

  const pieces = useMemo(
    () => (scraps && scraps.length > 0 ? toStripPieces(scraps) : EXAMPLE_PIECES),
    [scraps],
  );

  if (!available || dismissed || scraps === null) return null;

  const hasScraps = scraps.length > 0;
  const collected = hasScraps
    ? ` (${total} ${total === 1 ? "scrap" : "scraps"} so far)`
    : "";
  const body = `WWO now collects images, buttons, headings, and other element debris from your browsing${collected}. Visit the scraps page to get snapshots of your browsing.`;
  const finePrint = hasScraps
    ? "collected locally only"
    : "examples from playhtml.fun + wewere.online · collected locally only";

  return (
    <section className="scraps-launch" aria-labelledby="scraps-launch-title">
      <div className="scraps-launch__strip">
        {pieces.map((piece) => (
          <StripPieceView key={piece.key} piece={piece} />
        ))}
        {hasScraps ? null : (
          <span className="scraps-launch__strip-chip">examples</span>
        )}
      </div>

      <div className="scraps-launch__body">
        <div className="scraps-launch__copy">
          <span className="scraps-launch__tag">new</span>
          <h2 className="scraps-launch__title" id="scraps-launch-title">
            internet scraps
          </h2>
          <p className="scraps-launch__text">{body}</p>
          <p className="scraps-launch__fine-print">{finePrint}</p>
        </div>

        <div className="scraps-launch__actions">
          <a
            className="scraps-launch__cta"
            href={browser.runtime.getURL("scraps.html")}
          >
            view your scraps →
          </a>
          <button
            type="button"
            className="scraps-launch__dismiss"
            onClick={onDismiss}
          >
            dismiss ×
          </button>
        </div>
      </div>
    </section>
  );
}
