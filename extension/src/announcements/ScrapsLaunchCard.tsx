// ABOUTME: New-tab launch card announcing internet scraps with a strip of collected finds.
// ABOUTME: Shows the reader's newest scraps, or hosted examples when nothing has washed up yet.

import { useCallback, useEffect, useMemo, useState } from "react";
import browser from "webextension-polyfill";
import { getState, setState } from "./announcement-storage";
import { scrapsAvailable } from "../scraps-availability";
import {
  ScrapStrip,
  toStripPieces,
  type ScrapRecord,
  type StripPiece,
} from "./ScrapStrip";
import "./ScrapsLaunchCard.scss";

export const SCRAPS_LAUNCH_CARD_ID = "scraps-2026-08-newtab";

const STRIP_CAPACITY = 8;

interface ScrapsResponse {
  scraps?: ScrapRecord[];
  /** Every scrap collected, not only the ones returned under the limit. */
  total?: number;
}

// Hosted examples from our own sites, shown before the reader has any scraps.
// Each URL is verified to serve an image; a failed load hides that piece.
const EXAMPLE_PIECES: StripPiece[] = [
  {
    kind: "image",
    key: "example-candle",
    src: "https://playhtml.fun/candle-off.png",
    alt: "a candle from playhtml.fun",
    size: "photo",
  },
  {
    kind: "image",
    key: "example-sign",
    src: "https://playhtml.fun/playhtml-sign.png",
    alt: "a hand-lettered sign from playhtml.fun",
    size: "photo",
  },
  {
    kind: "text",
    key: "example-play",
    text: "play",
    color: "#ffffff",
    fill: "#4a9a8a",
    backed: false,
    font: {},
  },
  {
    kind: "image",
    key: "example-bench",
    src: "https://wewere.online/red-park-bench-face-right.png",
    alt: "a red park bench from wewere.online",
    size: "photo",
  },
  {
    kind: "image",
    key: "example-construction",
    src: "https://playhtml.fun/under-construction-website.gif",
    alt: "an under-construction banner from playhtml.fun",
    size: "photo",
  },
  {
    kind: "text",
    key: "example-rsvp",
    text: "rsvp",
    color: "#ffffff",
    fill: "#5b8db8",
    backed: false,
    font: {},
  },
  {
    kind: "image",
    key: "example-candle-lit",
    src: "https://playhtml.fun/candle-gif.gif",
    alt: "a lit candle from playhtml.fun",
    size: "photo",
  },
  {
    kind: "image",
    key: "example-favicon",
    src: "https://wewere.online/favicon.png",
    alt: "the wewere.online favicon",
    size: "photo",
  },
];

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

  if (!available || dismissed || scraps === null) return null;

  return (
    <ScrapsLaunchCardView
      scraps={scraps}
      total={total}
      capacity={STRIP_CAPACITY}
      scrapsHref={browser.runtime.getURL("scraps.html")}
      onDismiss={onDismiss}
    />
  );
}

/** The card itself, given the reader's scraps; the dev page renders it too. */
export function ScrapsLaunchCardView({
  scraps,
  total,
  capacity,
  scrapsHref,
  onDismiss,
}: {
  scraps: ScrapRecord[];
  total: number;
  capacity: number;
  scrapsHref: string;
  onDismiss: () => void;
}) {
  const pieces = useMemo(
    () =>
      scraps.length > 0 ? toStripPieces(scraps, capacity) : EXAMPLE_PIECES,
    [scraps, capacity],
  );

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
      <ScrapStrip pieces={pieces}>
        {hasScraps ? null : (
          <span className="scraps-launch__strip-chip">examples</span>
        )}
      </ScrapStrip>

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
            href={scrapsHref}
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
