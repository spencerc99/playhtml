// ABOUTME: Defines the Internet Commute platform advertising campaign.
// ABOUTME: Selects a shared poster deterministically from each stop domain.

import aliveArtwork from "../../assets/commute-ads/ad-alive.jpg";
import benchesArtwork from "../../assets/commute-ads/ad-benches.jpg";
import classArtwork from "../../assets/commute-ads/ad-class.jpg";
import playhtmlArtwork from "../../assets/commute-ads/ad-playhtml.jpg";

interface CommuteAdPalette {
  background: string;
  text: string;
  accent: string;
  ctaBackground: string;
  ctaText: string;
}

interface CommuteAdCopy {
  label: string;
  headline: string;
  short: string;
  cta: string;
}

interface CommuteArtworkAd {
  id: "playhtml" | "class" | "benches" | "alive";
  artwork: string;
  palette: CommuteAdPalette;
  copy: CommuteAdCopy;
  href: string;
}

interface CommuteTransitPassAd {
  id: "transit-pass";
  palette: CommuteAdPalette;
  copy: CommuteAdCopy;
  href: string;
}

export type CommuteAd = CommuteArtworkAd | CommuteTransitPassAd;

export const COMMUTE_ADS = [
  {
    id: "playhtml",
    artwork: playhtmlArtwork,
    palette: {
      background: "#e7ece2",
      text: "#3d3833",
      accent: "#f2d271",
      ctaBackground: "#3d3833",
      ctaText: "#faf7f2",
    },
    copy: {
      label: "playhtml",
      headline: "this train was built with it — make a site like this one",
      short: "make a site like this one",
      cta: "playhtml.fun →",
    },
    href: "https://playhtml.fun",
  },
  {
    id: "class",
    artwork: classArtwork,
    palette: {
      background: "#3cb5e6",
      text: "#ffffff",
      accent: "#ffffff",
      ctaBackground: "#ffffff",
      ctaText: "#1b7fae",
    },
    copy: {
      label: "school for poetic computation · summer 2026",
      headline:
        "come learn to build seats for strangers — example sites included",
      short: "building benches for the web",
      cta: "class.playhtml.fun →",
    },
    href: "https://class.playhtml.fun",
  },
  {
    id: "benches",
    artwork: benchesArtwork,
    palette: {
      background: "#f5f2ea",
      text: "#3d3833",
      accent: "#c4724e",
      ctaBackground: "#3d3833",
      ctaText: "#faf7f2",
    },
    copy: {
      label: "reading in motion · no. 1",
      headline: "the internet has no benches",
      short: "the internet has no benches",
      cta: "read on the ride →",
    },
    href: "https://news.spencer.place/p/the-internet-has-no-benches",
  },
  {
    id: "alive",
    artwork: aliveArtwork,
    palette: {
      background: "#2b2724",
      text: "#faf7f2",
      accent: "#d4b85c",
      ctaBackground: "#d4b85c",
      ctaText: "#2b2724",
    },
    copy: {
      label: "they say the internet is dead",
      headline: "the internet is alive",
      short: "the internet is alive",
      cta: "read alive internet theory →",
    },
    href: "https://news.spencer.place/p/alive-internet-theory",
  },
] satisfies readonly CommuteArtworkAd[];

export const COMMUTE_TRANSIT_PASS_AD = {
  id: "transit-pass",
  palette: {
    background: "#faf7f2",
    text: "#3d3833",
    accent: "#d4b85c",
    ctaBackground: "#3d3833",
    ctaText: "#faf7f2",
  },
  copy: {
    label: "internet transit pass",
    headline: "join the ride",
    short: "join the ride",
    cta: "get the extension →",
  },
  href: "https://wewere.online/",
} satisfies CommuteTransitPassAd;

function hashDomain(domain: string): number {
  let value = 2166136261;
  for (let index = 0; index < domain.length; index += 1) {
    value ^= domain.charCodeAt(index);
    value = Math.imul(value, 16777619);
  }
  return value >>> 0;
}

export function getEligibleCommuteAds(
  extensionMissing: boolean,
): readonly CommuteAd[] {
  return extensionMissing
    ? [...COMMUTE_ADS, COMMUTE_TRANSIT_PASS_AD]
    : COMMUTE_ADS;
}

export type CommuteAdSlot = "left" | "right";

export function getCommuteAd(
  domain: string,
  extensionMissing: boolean,
  slot: CommuteAdSlot = "left",
): CommuteAd {
  const eligibleAds = getEligibleCommuteAds(extensionMissing);
  const leftAd = eligibleAds[hashDomain(domain) % eligibleAds.length];
  if (slot === "left") return leftAd;

  const remainingAds = eligibleAds.filter((ad) => ad !== leftAd);
  return remainingAds[hashDomain(`${domain}::right`) % remainingAds.length];
}
