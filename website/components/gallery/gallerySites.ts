// ABOUTME: Loads the gallery's sites from the Are.na channel and mixes in Spencer's experiments.
// ABOUTME: Also knows which sites came from the Building Benches for the Web class.

import { useEffect, useState } from "react";
import {
  ARENA_CONTENTS_URL,
  mapArenaSites,
} from "../../../apps/docs/src/components/examples/catalogue";
import { experiments } from "../../utils/experimentsCatalog";

export interface GalleryItem {
  id: string;
  title: string;
  by?: string;
  // One line about the site, from its Are.na block description (or the
  // experiment catalog for Spencer's experiments).
  description?: string;
  href: string;
  hostname: string;
  imageUrl?: string;
  imageAlt?: string;
  fromStudio: boolean;
}

export type GallerySitesState =
  | { status: "loading" }
  | { status: "ready"; items: GalleryItem[]; classSites: GalleryItem[] }
  | { status: "failed" };

// Sites made in "Building Benches for the Web" (SFPC, summer 2026).
const ClassHostnames = new Set([
  "telepathy.andrew-boylan.com",
  "crowbitty.neocities.org",
  "liiibrary.space",
  "rarvizu5.github.io",
  "blossoms.jeraldlim.com",
  "trash.jordanmess.com",
  "jennybkowalski.github.io",
  "uyyam.github.io",
  "aliaelkattan.com",
  "dayglo.codeberg.page",
  "haesookim.info",
  "clara-nolan.github.io",
  "ad2x.github.io",
  "mwhite98.github.io",
  "ksyro98.github.io",
  "max.zlotskiy.com",
  "jonathangray.org",
  "teletext-workshop.vercel.app",
  "writecards.github.io",
  "notescards.us",
  "liamhoulihan.github.io",
  "sarahalyahya.github.io",
  "seanzshow1.github.io",
]);

// One studio experiment after every few community sites, so Spencer's work
// sits among everyone else's instead of in a block.
const CommunitySitesPerExperiment = 3;

export function mixInExperiments(
  community: GalleryItem[],
  studio: GalleryItem[],
): GalleryItem[] {
  const remaining = [...studio];
  const mixed: GalleryItem[] = [];
  community.forEach((item, index) => {
    mixed.push(item);
    if ((index + 1) % CommunitySitesPerExperiment === 0 && remaining.length) {
      mixed.push(remaining.shift()!);
    }
  });
  return [...mixed, ...remaining];
}

export function studioItems(): GalleryItem[] {
  return experiments
    .filter((experiment) => experiment.href)
    .map((experiment) => ({
      id: experiment.number,
      title: experiment.name,
      by: "Spencer",
      description: experiment.description,
      href: experiment.href!,
      hostname: `playhtml.fun${experiment.href!.replace(/\/$/, "")}`,
      imageUrl: experiment.image,
      imageAlt: `Screenshot of ${experiment.name}`,
      fromStudio: true,
    }));
}

// Are.na fills empty descriptions from the page's own meta tags, so skip the
// ones that say nothing about the site: playhtml's own tagline, and scraps
// with no words in them (an emoji, a "?").
const PlayhtmlTagline =
  "interactive, collaborative html elements with a single attribute";

export function galleryDescription(description: string): string | undefined {
  const text = description.replace(/\s+/g, " ").trim();
  if (!text) return undefined;
  if (text.toLowerCase() === PlayhtmlTagline) return undefined;
  if ((text.match(/\p{L}/gu) ?? []).length < 3) return undefined;
  return text;
}

let sitesRequest: Promise<GalleryItem[]> | null = null;

function loadCommunitySites(): Promise<GalleryItem[]> {
  sitesRequest ??= fetch(ARENA_CONTENTS_URL)
    .then((response) => {
      if (!response.ok) throw new Error(`Are.na ${response.status}`);
      return response.json();
    })
    .then((body) =>
      mapArenaSites(body)
        .filter((site) => !site.hostname.endsWith("playhtml.fun"))
        .map((site) => ({
          id: site.id,
          title: site.title,
          by: site.author,
          description: galleryDescription(site.description),
          href: site.href,
          hostname: site.hostname,
          imageUrl: site.imageUrl,
          imageAlt: site.imageAlt,
          fromStudio: false,
        })),
    )
    .catch((error) => {
      sitesRequest = null;
      throw error;
    });
  return sitesRequest;
}

export function useGallerySites(): GallerySitesState {
  const [state, setState] = useState<GallerySitesState>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;
    loadCommunitySites()
      .then((community) => {
        if (cancelled) return;
        if (community.length === 0) {
          setState({ status: "failed" });
          return;
        }
        setState({
          status: "ready",
          items: mixInExperiments(community, studioItems()),
          classSites: community.filter((site) =>
            ClassHostnames.has(site.hostname),
          ),
        });
      })
      .catch(() => {
        if (!cancelled) setState({ status: "failed" });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return state;
}
