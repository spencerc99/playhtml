// ABOUTME: Shows the newest sites from the public Are.na playhtml channel on the homepage.
// ABOUTME: Falls back to a link to the full gallery if the channel can't be reached.

import { type CSSProperties, useEffect } from "react";
import { useGallerySites } from "../gallery/gallerySites";

const SitesShown = 6;
const PlaceholderColors = [
  "#c9d4f5",
  "#ffd9e4",
  "#d6e8cf",
  "#ffe7b8",
  "#e2dcf5",
  "#cfe8ec",
];

export function MadeWithGallery() {
  const state = useGallerySites();
  const sites =
    state.status === "ready"
      ? state.items
          .filter((item) => !item.fromStudio && item.imageUrl)
          .slice(0, SitesShown)
      : [];
  const moreCount =
    state.status === "ready" ? state.items.length - sites.length : 0;

  // The "see more" link sits below the grid in the static page, so it works
  // before React loads; once the gallery loads, it says how many more there are.
  useEffect(() => {
    const more = document.getElementById("home-gallery-more");
    if (more && moreCount > 0) {
      more.textContent = `see ${moreCount} more in the gallery →`;
    }
  }, [moreCount]);

  if (
    state.status === "failed" ||
    (state.status === "ready" && !sites.length)
  ) {
    return (
      <p className="ph-made__fallback">
        Couldn't load the gallery right now.{" "}
        <a href="/gallery/">See everything people have made</a>.
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
      {sites.map((site) => (
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
            {site.by ? <span>by {site.by}</span> : null}
          </span>
        </a>
      ))}
    </>
  );
}
