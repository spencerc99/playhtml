// ABOUTME: Shows the newest sites from the public Are.na playhtml channel on the homepage.
// ABOUTME: Falls back to a link to the full gallery if the channel can't be reached.

import { type CSSProperties, useEffect, useState } from "react";
import {
  ARENA_CONTENTS_URL,
  mapArenaSites,
  type SiteSummary,
} from "../../../apps/docs/src/components/examples/catalogue";

const SitesShown = 6;
const PlaceholderColors = [
  "#c9d4f5",
  "#ffd9e4",
  "#d6e8cf",
  "#ffe7b8",
  "#e2dcf5",
  "#cfe8ec",
];

type GalleryState =
  | { status: "loading" }
  | { status: "ready"; sites: SiteSummary[] }
  | { status: "failed" };

export function MadeWithGallery() {
  const [state, setState] = useState<GalleryState>({ status: "loading" });

  useEffect(() => {
    const controller = new AbortController();

    fetch(ARENA_CONTENTS_URL, { signal: controller.signal })
      .then((response) => {
        if (!response.ok) throw new Error(`Are.na ${response.status}`);
        return response.json();
      })
      .then((body) => {
        const sites = mapArenaSites(body)
          .filter((site) => site.imageUrl)
          .slice(0, SitesShown);
        setState(
          sites.length > 0 ? { status: "ready", sites } : { status: "failed" },
        );
      })
      .catch(() => {
        if (!controller.signal.aborted) setState({ status: "failed" });
      });

    return () => controller.abort();
  }, []);

  if (state.status === "failed") {
    return (
      <p className="ph-made__fallback">
        Couldn't load the gallery right now.{" "}
        <a href="/docs/examples/">See everything people have made</a>.
      </p>
    );
  }

  if (state.status === "loading") {
    return (
      <>
        {PlaceholderColors.map((color) => (
          <span
            key={color}
            className="ph-site ph-site--placeholder"
            aria-hidden="true"
          >
            <span
              className="ph-site__shot"
              style={{ "--site-bg": color } as CSSProperties}
            />
            <span className="ph-site__meta">
              <b>&nbsp;</b>
            </span>
          </span>
        ))}
      </>
    );
  }

  return (
    <>
      {state.sites.map((site) => (
        <a className="ph-site" href={site.href} key={site.id}>
          <span className="ph-site__shot">
            <img
              src={site.imageUrl}
              alt={site.imageAlt ?? `Screenshot of ${site.title}`}
              loading="lazy"
            />
          </span>
          <span className="ph-site__meta">
            <b>{site.hostname}</b>
            {site.author ? <span>by {site.author}</span> : null}
          </span>
        </a>
      ))}
    </>
  );
}
