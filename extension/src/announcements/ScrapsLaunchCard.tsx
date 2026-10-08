// ABOUTME: New-tab card showing a small pile of the reader's newest internet scraps.
// ABOUTME: Announces the feature until dismissed, then stays as a compact window onto the pile.

import { useCallback, useEffect, useMemo, useState } from "react";
import browser from "webextension-polyfill";
import { ScrapCollage, type ScrapItem } from "@movement/components/ScrapCollage";
import { groupPhotoEncounters } from "@movement/utils/scrapPhotoGroups";
import { getState, setState } from "./announcement-storage";
import { scrapsAvailable } from "../scraps-availability";
import {
  toScrapItem,
  type ScrapRecord,
} from "../entrypoints/scraps/scrapItems";
import "./ScrapsLaunchCard.scss";

export const SCRAPS_LAUNCH_CARD_ID = "scraps-2026-08-newtab";

/** How many of the newest scraps the pile draws from. */
export const PILE_CAPACITY = 50;

/** How many scraps sit ashore in the card at once while the rest drift in. */
const PILE_ASHORE_COUNT = 30;

interface ScrapsResponse {
  scraps?: ScrapRecord[];
  error?: string;
}

interface ScrapCountResponse {
  total?: number;
  error?: string;
}

function exampleImage(
  key: string,
  src: string,
  alt: string,
  domain: string,
  size: [number, number],
): ScrapItem {
  return {
    id: key,
    key,
    kind: "image",
    src,
    alt,
    naturalWidth: size[0],
    naturalHeight: size[1],
    domain,
    pageUrl: `https://${domain}/`,
    pageTitle: domain,
    ts: 0,
  };
}

function exampleButton(
  key: string,
  text: string,
  background: string,
): ScrapItem {
  return {
    id: key,
    key,
    kind: "button",
    text,
    styles: {
      backgroundColor: background,
      color: "#ffffff",
      borderRadius: "5px",
      paddingTop: "6px",
      paddingRight: "12px",
      paddingBottom: "6px",
      paddingLeft: "12px",
      fontWeight: "700",
    },
    domain: "playhtml.fun",
    pageUrl: "https://playhtml.fun/",
    pageTitle: "playhtml.fun",
    ts: 0,
  };
}

// Hosted examples from our own sites, shown before the reader has any scraps.
// A failed image load drops that piece from the pile.
const EXAMPLE_ITEMS: ScrapItem[] = [
  exampleImage(
    "example-candle",
    "https://playhtml.fun/candle-off.png",
    "a candle",
    "playhtml.fun",
    [200, 300],
  ),
  exampleImage(
    "example-sign",
    "https://playhtml.fun/playhtml-sign.png",
    "a hand-lettered sign",
    "playhtml.fun",
    [400, 200],
  ),
  exampleButton("example-play", "play", "#4a9a8a"),
  exampleImage(
    "example-bench",
    "https://wewere.online/red-park-bench-face-right.png",
    "a red park bench",
    "wewere.online",
    [400, 260],
  ),
  exampleImage(
    "example-construction",
    "https://playhtml.fun/under-construction-website.gif",
    "an under-construction banner",
    "playhtml.fun",
    [400, 120],
  ),
  exampleButton("example-rsvp", "rsvp", "#5b8db8"),
  exampleImage(
    "example-candle-lit",
    "https://playhtml.fun/candle-gif.gif",
    "a lit candle",
    "playhtml.fun",
    [200, 300],
  ),
  exampleImage(
    "example-favicon",
    "https://wewere.online/favicon.png",
    "the wewere.online favicon",
    "wewere.online",
    [64, 64],
  ),
];

export function ScrapsLaunchCard() {
  const [available, setAvailable] = useState(false);
  const [textDismissed, setTextDismissed] = useState(false);
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
      setAvailable(featureOn);
      setTextDismissed(seenState === "dismissed");
      if (!featureOn) return;

      try {
        const [response, countResponse] = (await Promise.all([
          browser.runtime.sendMessage({
            type: "GET_SCRAPS",
            options: { limit: PILE_CAPACITY },
          }),
          browser.runtime.sendMessage({ type: "GET_SCRAP_COUNT" }),
        ])) as [ScrapsResponse, ScrapCountResponse];
        if (cancelled) return;
        if (response?.error) throw new Error(response.error);
        if (typeof countResponse?.total !== "number") {
          throw new Error(
            `GET_SCRAP_COUNT returned no total: ${countResponse?.error ?? "unknown"}`,
          );
        }
        const loaded = Array.isArray(response?.scraps)
          ? groupPhotoEncounters(response.scraps).sort((a, b) => b.ts - a.ts)
          : [];
        setScraps(loaded);
        setTotal(countResponse.total);
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
    setTextDismissed(true);
    void setState(SCRAPS_LAUNCH_CARD_ID, "dismissed");
  }, []);

  if (!available || scraps === null) return null;
  // Once the announcement is dismissed, the card only stays for a real pile.
  if (textDismissed && scraps.length === 0) return null;

  return (
    <ScrapsLaunchCardView
      scraps={scraps}
      total={total}
      textDismissed={textDismissed}
      scrapsHref={browser.runtime.getURL("scraps.html")}
      onDismiss={onDismiss}
    />
  );
}

/** A site the pile's scraps came from, as the bar lists it. */
export interface ScrapSite {
  domain: string;
  count: number;
  faviconUrl?: string;
}

/** How many sites the bar names before folding the rest into "+N". */
const BAR_SITE_LIMIT = 6;

/** The sites behind `scraps`, most scraps first, then most recently seen. */
export function scrapSites(scraps: ScrapRecord[]): ScrapSite[] {
  const sites = new Map<string, ScrapSite & { latest: number }>();
  for (const scrap of scraps) {
    const site = sites.get(scrap.domain);
    if (site) {
      site.count += 1;
      site.latest = Math.max(site.latest, scrap.ts);
      site.faviconUrl ??= scrap.faviconUrl;
    } else {
      sites.set(scrap.domain, {
        domain: scrap.domain,
        count: 1,
        faviconUrl: scrap.faviconUrl,
        latest: scrap.ts,
      });
    }
  }
  return [...sites.values()]
    .sort((a, b) => b.count - a.count || b.latest - a.latest)
    .map(({ latest: _latest, ...site }) => site);
}

/** A site's favicon, or the empty ring the postcard back draws without one. */
function SiteMark({ faviconUrl }: { faviconUrl?: string }) {
  const [failed, setFailed] = useState(false);
  if (!faviconUrl || failed) {
    return <span className="scraps-launch__site-favicon scraps-launch__site-favicon--none" />;
  }
  return (
    <img
      className="scraps-launch__site-favicon"
      src={faviconUrl}
      alt=""
      onError={() => setFailed(true)}
    />
  );
}

/** The sites strip, set like the "also from" line on a collage's back. */
function ScrapSitesStrip({ sites }: { sites: ScrapSite[] }) {
  const shown = sites.slice(0, BAR_SITE_LIMIT);
  const hidden = sites.length - shown.length;
  return (
    <div className="scraps-launch__sites">
      <span className="scraps-launch__sites-label">
        from {sites.length} {sites.length === 1 ? "site" : "sites"}
      </span>
      {shown.map((site) => (
        <span className="scraps-launch__site" key={site.domain} title={site.domain}>
          <SiteMark faviconUrl={site.faviconUrl} />
          <span className="scraps-launch__site-name">{site.domain}</span>
          <span className="scraps-launch__site-count">{site.count}</span>
        </span>
      ))}
      {hidden > 0 ? (
        <span className="scraps-launch__sites-more">+{hidden} more</span>
      ) : null}
    </div>
  );
}

/** The card itself, given the reader's scraps; the dev page renders it too. */
export function ScrapsLaunchCardView({
  scraps,
  total,
  textDismissed,
  scrapsHref,
  onDismiss,
}: {
  scraps: ScrapRecord[];
  total: number;
  textDismissed: boolean;
  scrapsHref: string;
  onDismiss: () => void;
}) {
  const hasScraps = scraps.length > 0;
  const items = useMemo(
    () => (hasScraps ? scraps.map(toScrapItem) : EXAMPLE_ITEMS),
    [hasScraps, scraps],
  );
  const sites = useMemo(() => scrapSites(scraps), [scraps]);
  // One arrangement per day, like the scraps page.
  const seed = useMemo(() => Math.floor(Date.now() / 86_400_000), []);

  const pile = (
    <div className="scraps-launch__pile">
      <ScrapCollage
        items={items}
        seed={seed}
        targetCount={Math.min(items.length, PILE_ASHORE_COUNT)}
      />
      {hasScraps ? null : (
        <span className="scraps-launch__strip-chip">examples</span>
      )}
    </div>
  );

  const heading = (
    <div className="walking-record__section-heading">
      <h2 id="scraps-launch-title">internet scraps</h2>
    </div>
  );

  if (textDismissed) {
    return (
      <section
        className="walking-record__section scraps-section"
        aria-labelledby="scraps-launch-title"
      >
        {heading}
        <div className="scraps-launch scraps-launch--compact">
          {pile}
          <div className="scraps-launch__footer">
            <ScrapSitesStrip sites={sites} />
            <a className="scraps-launch__footer-link" href={scrapsHref}>
              view all {total} →
            </a>
          </div>
        </div>
      </section>
    );
  }

  const collected = hasScraps
    ? ` (${total} ${total === 1 ? "scrap" : "scraps"} so far)`
    : "";
  const body = `WWO now collects images, buttons, headings, and other element debris from your browsing${collected}. Visit the scraps page to get snapshots of your browsing.`;
  const finePrint = hasScraps
    ? "collected locally only"
    : "examples from playhtml.fun + wewere.online · collected locally only";

  return (
    <section
      className="walking-record__section scraps-section"
      aria-labelledby="scraps-launch-title"
    >
      {heading}
      <div className="scraps-launch">
        {pile}
        {hasScraps ? (
          <div className="scraps-launch__footer scraps-launch__footer--ruled">
            <ScrapSitesStrip sites={sites} />
          </div>
        ) : null}

        <div className="scraps-launch__body">
          <div className="scraps-launch__copy">
            <span className="scraps-launch__tag">new</span>
            <p className="scraps-launch__text">{body}</p>
            <p className="scraps-launch__fine-print">{finePrint}</p>
          </div>

          <div className="scraps-launch__actions">
            <a className="scraps-launch__cta" href={scrapsHref}>
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
      </div>
    </section>
  );
}
