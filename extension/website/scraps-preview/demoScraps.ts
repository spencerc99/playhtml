// ABOUTME: Synthetic scrap demo data (images, buttons, svg icons, cursors) for preview pages.
// ABOUTME: Network-free ScrapItem fixtures shared by the collage and inventory prototypes.

import type { ScrapItem } from "@movement/components/ScrapCollage";

export const DAY_MS = 86_400_000;
export const NOW = 1_784_000_000_000;

export function svgDataUri(markup: string): string {
  return `data:image/svg+xml;utf8,${encodeURIComponent(markup)}`;
}

interface FakeImage {
  name: string;
  domain: string;
  pageTitle: string;
  markup: string;
  naturalWidth: number;
  naturalHeight: number;
}

const FAKE_IMAGES: FakeImage[] = [
  {
    name: "pear",
    domain: "orchard.example",
    pageTitle: "Heirloom pears, ranked",
    naturalWidth: 480,
    naturalHeight: 640,
    markup:
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 64"><path d="M24 8c2 8 12 12 12 28a12 12 0 0 1-24 0C12 20 22 16 24 8z" fill="#a8c66c"/><path d="M24 8c1-3 3-5 6-6" stroke="#6b4f2a" stroke-width="2" fill="none"/></svg>',
  },
  {
    name: "bottle",
    domain: "orchard.example",
    pageTitle: "Cellar notes",
    naturalWidth: 300,
    naturalHeight: 900,
    markup:
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 30 90"><path d="M12 4h6v18c6 4 8 10 8 18v42a6 6 0 0 1-6 6H10a6 6 0 0 1-6-6V40c0-8 2-14 8-18z" fill="#3d5a48"/><rect x="6" y="48" width="18" height="20" fill="#e8e0cf"/></svg>',
  },
  {
    name: "boot",
    domain: "fleamarket.example",
    pageTitle: "Saturday finds",
    naturalWidth: 640,
    naturalHeight: 520,
    markup:
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 52"><path d="M14 4h18v22c8 2 22 6 26 16v6H8V8a4 4 0 0 1 6-4z" fill="#7a4a2b"/><path d="M8 42h50v6H8z" fill="#3d3833"/><path d="M18 8h10M18 14h10M18 20h10" stroke="#c9a227" stroke-width="2"/></svg>',
  },
  {
    name: "fish",
    domain: "fleamarket.example",
    pageTitle: "Tin toys",
    naturalWidth: 800,
    naturalHeight: 420,
    markup:
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 80 42"><path d="M8 21C20 6 44 4 60 14l12-8-4 15 4 15-12-8C44 38 20 36 8 21z" fill="#5b8db8"/><circle cx="54" cy="18" r="3" fill="#22333b"/><path d="M30 12c4 6 4 12 0 18" stroke="#3d6a8f" stroke-width="2" fill="none"/></svg>',
  },
  {
    name: "teapot",
    domain: "kitchenalia.example",
    pageTitle: "Grandmother's teapot pattern",
    naturalWidth: 700,
    naturalHeight: 560,
    markup:
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 70 56"><path d="M18 20h30a14 14 0 0 1 0 28H24a14 14 0 0 1-6-28z" fill="#c4724e"/><path d="M48 26c8 0 14 4 14 10-4 2-8 2-12 0" fill="#c4724e"/><path d="M22 20c0-8 6-12 12-12s12 4 12 12" stroke="#8a4a2e" stroke-width="3" fill="none"/><circle cx="34" cy="8" r="3" fill="#8a4a2e"/></svg>',
  },
  {
    name: "moth",
    domain: "nightgarden.example",
    pageTitle: "Moths of the porch light",
    naturalWidth: 620,
    naturalHeight: 460,
    markup:
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 62 46"><path d="M31 20C24 8 10 4 4 10c-2 10 10 18 24 18z" fill="#d4b85c"/><path d="M31 20c7-12 21-16 27-10 2 10-10 18-24 18z" fill="#d4b85c"/><path d="M31 20c-5 6-12 14-8 22 4 2 8-2 8-8 0 6 4 10 8 8 4-8-3-16-8-22z" fill="#b89a3e"/><ellipse cx="31" cy="20" rx="3" ry="8" fill="#5c4a1e"/></svg>',
  },
  {
    name: "chair",
    domain: "auctionhouse.example",
    pageTitle: "Lot 44: bentwood chair",
    naturalWidth: 420,
    naturalHeight: 760,
    markup:
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 42 76"><path d="M8 4c10-4 16-4 26 0l-4 28H12z" fill="none" stroke="#6b4f2a" stroke-width="4"/><rect x="8" y="32" width="26" height="6" fill="#8a6a3a"/><path d="M10 38v34M32 38v34M12 54h18" stroke="#6b4f2a" stroke-width="4"/></svg>',
  },
  {
    name: "radio",
    domain: "auctionhouse.example",
    pageTitle: "Lot 12: valve radio",
    naturalWidth: 760,
    naturalHeight: 500,
    markup:
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 76 50"><rect x="4" y="10" width="68" height="36" rx="8" fill="#7a4a2b"/><circle cx="24" cy="28" r="10" fill="#e8e0cf"/><rect x="42" y="20" width="22" height="16" rx="3" fill="#c9a227"/><path d="M8 10L40 2" stroke="#3d3833" stroke-width="2"/></svg>',
  },
  {
    name: "shell",
    domain: "tidepool.example",
    pageTitle: "Low tide inventory",
    naturalWidth: 500,
    naturalHeight: 440,
    markup:
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 50 44"><path d="M25 42C10 42 4 30 6 18c8-16 30-16 38 0 2 12-4 24-19 24z" fill="#e0b8a0"/><path d="M25 42V6M15 40L20 8M35 40L30 8M9 32l8-20M41 32l-8-20" stroke="#a97c5e" stroke-width="2" fill="none"/></svg>',
  },
  {
    name: "clock",
    domain: "tidepool.example",
    pageTitle: "Harbor master's office",
    naturalWidth: 520,
    naturalHeight: 520,
    markup:
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 52 52"><circle cx="26" cy="26" r="22" fill="#e8e0cf" stroke="#3d3833" stroke-width="4"/><path d="M26 12v14l10 6" stroke="#3d3833" stroke-width="3" fill="none"/><circle cx="26" cy="26" r="2" fill="#c4724e"/></svg>',
  },
  {
    name: "mushroom",
    domain: "nightgarden.example",
    pageTitle: "After the rain",
    naturalWidth: 460,
    naturalHeight: 500,
    markup:
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 46 50"><path d="M23 4C10 4 2 14 4 24h38c2-10-6-20-19-20z" fill="#c0392b"/><circle cx="14" cy="14" r="3" fill="#f2e8dc"/><circle cx="28" cy="10" r="2.5" fill="#f2e8dc"/><circle cx="34" cy="18" r="2" fill="#f2e8dc"/><path d="M17 24h12l-2 20a8 8 0 0 1-8 0z" fill="#efe3d0"/></svg>',
  },
  {
    name: "kettle-stamp",
    domain: "kitchenalia.example",
    pageTitle: "Enamelware catalog scan",
    naturalWidth: 900,
    naturalHeight: 620,
    markup:
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 90 62"><rect x="2" y="2" width="86" height="58" fill="#f2ead8" stroke="#b0a488" stroke-dasharray="4 3" stroke-width="2"/><path d="M30 22h30a12 12 0 0 1 0 24H32a12 12 0 0 1-2-24z" fill="#4a9a8a"/><path d="M60 28c6 0 10 3 10 7-3 2-6 1-9 0" fill="#4a9a8a"/><path d="M34 22c0-6 5-9 11-9s11 3 11 9" stroke="#2f6b5f" stroke-width="3" fill="none"/><text x="45" y="56" font-family="monospace" font-size="6" fill="#8a8279" text-anchor="middle">NO. 7 ENAMEL KETTLE</text></svg>',
  },
];

const BUTTONS: Array<{
  text: string;
  domain: string;
  pageTitle: string;
  styles: Record<string, string>;
}> = [
  {
    text: "Subscribe",
    domain: "videotube.example",
    pageTitle: "moss time-lapse, 3 hours",
    styles: {
      backgroundColor: "rgb(204, 0, 0)",
      color: "rgb(255, 255, 255)",
      border: "0px none rgb(255, 255, 255)",
      borderRadius: "18px",
      padding: "8px 16px",
      fontFamily: "Roboto, Arial, sans-serif",
      fontSize: "14px",
      fontWeight: "500",
    },
  },
  {
    text: "Follow",
    domain: "birdsite.example",
    pageTitle: "@tidepoolwatcher",
    styles: {
      backgroundColor: "rgb(15, 20, 25)",
      color: "rgb(255, 255, 255)",
      border: "0px none",
      borderRadius: "9999px",
      padding: "6px 16px",
      fontFamily: "system-ui, sans-serif",
      fontSize: "14px",
      fontWeight: "700",
    },
  },
  {
    text: "Download Now",
    domain: "sharewarehill.example",
    pageTitle: "WinAmp skins archive",
    styles: {
      backgroundColor: "rgb(212, 208, 200)",
      color: "rgb(0, 0, 0)",
      border: "2px outset rgb(255, 255, 255)",
      borderRadius: "0px",
      padding: "4px 12px",
      fontFamily: "Tahoma, sans-serif",
      fontSize: "12px",
      fontWeight: "400",
    },
  },
  {
    text: "Sign up free",
    domain: "saasland.example",
    pageTitle: "The last productivity app",
    styles: {
      backgroundImage: "linear-gradient(135deg, rgb(99, 102, 241), rgb(168, 85, 247))",
      backgroundColor: "rgb(99, 102, 241)",
      color: "rgb(255, 255, 255)",
      border: "0px none",
      borderRadius: "10px",
      padding: "12px 24px",
      fontFamily: "Inter, sans-serif",
      fontSize: "15px",
      fontWeight: "600",
      boxShadow: "rgba(99, 102, 241, 0.4) 0px 8px 20px 0px",
    },
  },
  {
    text: "Add to cart",
    domain: "megastore.example",
    pageTitle: "Cast iron kettle, 2qt",
    styles: {
      backgroundColor: "rgb(255, 216, 20)",
      color: "rgb(15, 17, 17)",
      border: "1px solid rgb(252, 210, 0)",
      borderRadius: "20px",
      padding: "8px 20px",
      fontFamily: "Arial, sans-serif",
      fontSize: "13px",
      fontWeight: "400",
    },
  },
  {
    text: "Learn more",
    domain: "saasland.example",
    pageTitle: "Pricing",
    styles: {
      backgroundColor: "rgba(0, 0, 0, 0)",
      color: "rgb(91, 141, 184)",
      border: "1.5px solid rgb(91, 141, 184)",
      borderRadius: "6px",
      padding: "9px 18px",
      fontFamily: "Georgia, serif",
      fontSize: "14px",
      fontWeight: "400",
      fontStyle: "italic",
    },
  },
  {
    text: "JOIN SERVER",
    domain: "chathaven.example",
    pageTitle: "the moss appreciation zone",
    styles: {
      backgroundColor: "rgb(88, 101, 242)",
      color: "rgb(255, 255, 255)",
      border: "0px none",
      borderRadius: "3px",
      padding: "10px 22px",
      fontFamily: "'gg sans', sans-serif",
      fontSize: "13px",
      fontWeight: "600",
      textTransform: "uppercase",
      letterSpacing: "0.5px",
    },
  },
  {
    text: "I'm Feeling Lucky",
    domain: "searchbox.example",
    pageTitle: "Search",
    styles: {
      backgroundColor: "rgb(248, 249, 250)",
      color: "rgb(60, 64, 67)",
      border: "1px solid rgb(248, 249, 250)",
      borderRadius: "4px",
      padding: "8px 16px",
      fontFamily: "Arial, sans-serif",
      fontSize: "13px",
      fontWeight: "400",
    },
  },
];

const SVG_ICONS: Array<{
  name: string;
  domain: string;
  pageTitle: string;
  width: number;
  height: number;
  markup: string;
}> = [
  {
    name: "heart",
    domain: "birdsite.example",
    pageTitle: "@tidepoolwatcher",
    width: 24,
    height: 24,
    markup:
      '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"><path d="M12 21C5 14 2 10 2 7a5 5 0 0 1 10-1 5 5 0 0 1 10 1c0 3-3 7-10 14z" fill="#e0245e"/></svg>',
  },
  {
    name: "star",
    domain: "codeforge.example",
    pageTitle: "tiny-collage-engine",
    width: 20,
    height: 20,
    markup:
      '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 20 20"><path d="M10 1l2.6 5.6 6.4.8-4.7 4.3 1.2 6.3L10 15l-5.5 3 1.2-6.3L1 7.4l6.4-.8z" fill="#d4b85c" stroke="#b89a3e" stroke-width="1"/></svg>',
  },
  {
    name: "rss",
    domain: "webring.example",
    pageTitle: "sites of the old web",
    width: 28,
    height: 28,
    markup:
      '<svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 28 28"><rect width="28" height="28" rx="5" fill="#f26522"/><circle cx="7" cy="21" r="3" fill="#fff"/><path d="M4 12a12 12 0 0 1 12 12h-4a8 8 0 0 0-8-8zM4 4a20 20 0 0 1 20 20h-4A16 16 0 0 0 4 8z" fill="#fff"/></svg>',
  },
  {
    name: "paper-plane",
    domain: "chathaven.example",
    pageTitle: "the moss appreciation zone",
    width: 24,
    height: 24,
    markup:
      '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"><path d="M2 12L22 2l-6 20-5-7z" fill="#5b8db8"/><path d="M11 15l11-13-14 11z" fill="#3d6a8f"/></svg>',
  },
  {
    name: "gear",
    domain: "saasland.example",
    pageTitle: "Settings",
    width: 22,
    height: 22,
    markup:
      '<svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 22 22"><path d="M11 1l1.5 3.2 3.5-.6 1 3.4 3.4 1-.6 3.5L23 13l-2.2 2.5.6 3.5-3.4 1-1 3.4-3.5-.6L11 25z" fill="none"/><circle cx="11" cy="11" r="9" fill="#8a8279"/><circle cx="11" cy="11" r="4" fill="#f5f0e8"/><path d="M11 0v4M11 18v4M0 11h4M18 11h4M3 3l3 3M16 16l3 3M19 3l-3 3M6 16l-3 3" stroke="#8a8279" stroke-width="2.5"/></svg>',
  },
  {
    name: "flame",
    domain: "forumpit.example",
    pageTitle: "hottest takes of 2004",
    width: 20,
    height: 26,
    markup:
      '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="26" viewBox="0 0 20 26"><path d="M10 0c2 5 8 8 8 15a8 8 0 0 1-16 0C2 10 8 6 10 0z" fill="#c4724e"/><path d="M10 10c1 3 4 4 4 8a4 4 0 0 1-8 0c0-4 3-5 4-8z" fill="#d4b85c"/></svg>',
  },
];

const CURSORS: Array<{
  name: string;
  domain: string;
  pageTitle: string;
  markup: string;
}> = [
  {
    name: "sword",
    domain: "guildhall.example",
    pageTitle: "browser MMO of your dreams",
    markup:
      '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32"><path d="M4 4l16 14 3-3L9 1z" fill="#b0b8c0" stroke="#5a6470" stroke-width="1"/><path d="M20 18l4 4-2 2-4-4z" fill="#7a4a2b"/><path d="M25 21l4 4-4 4-4-4z" fill="#c9a227"/></svg>',
  },
  {
    name: "wand",
    domain: "sparkleshop.example",
    pageTitle: "cursors for your homepage",
    markup:
      '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32"><path d="M3 29L20 12l-1-1L2 28z" fill="#8a6a3a"/><path d="M24 2l1.5 4.5L30 8l-4.5 1.5L24 14l-1.5-4.5L18 8l4.5-1.5z" fill="#d4b85c"/><circle cx="14" cy="18" r="1.5" fill="#e8d48a"/><circle cx="27" cy="16" r="1" fill="#e8d48a"/></svg>',
  },
  {
    name: "crab",
    domain: "tidepool.example",
    pageTitle: "Low tide inventory",
    markup:
      '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32"><ellipse cx="16" cy="20" rx="9" ry="7" fill="#c0392b"/><circle cx="12" cy="16" r="1.5" fill="#22333b"/><circle cx="20" cy="16" r="1.5" fill="#22333b"/><path d="M7 18C3 16 2 12 4 9c3 1 5 4 5 7zM25 18c4-2 5-6 3-9-3 1-5 4-5 7z" fill="#c0392b"/><path d="M6 24l-4 3M9 27l-3 4M26 24l4 3M23 27l3 4" stroke="#8a2a1e" stroke-width="2"/></svg>',
  },
];

export function buildItems(): ScrapItem[] {
  const items: ScrapItem[] = [];

  FAKE_IMAGES.forEach((image, index) => {
    const src = svgDataUri(image.markup);
    items.push({
      id: `img-${image.name}`,
      key: src,
      kind: "image",
      src,
      alt: image.name,
      naturalWidth: image.naturalWidth,
      naturalHeight: image.naturalHeight,
      pageTitle: image.pageTitle,
      domain: image.domain,
      pageUrl: `https://${image.domain}/`,
      ts: NOW - index * 6 * 60 * 60 * 1000,
    });
  });

  BUTTONS.forEach((button, index) => {
    items.push({
      id: `btn-${index}`,
      key: `btn-${button.domain}-${button.text}`,
      kind: "button",
      text: button.text,
      styles: button.styles,
      pageTitle: button.pageTitle,
      domain: button.domain,
      pageUrl: `https://${button.domain}/`,
      ts: NOW - (index + 2) * 5 * 60 * 60 * 1000,
    });
  });

  SVG_ICONS.forEach((icon, index) => {
    items.push({
      id: `svg-${icon.name}`,
      key: `svg-${icon.name}`,
      kind: "svg-icon",
      markup: icon.markup,
      width: icon.width,
      height: icon.height,
      pageTitle: icon.pageTitle,
      domain: icon.domain,
      pageUrl: `https://${icon.domain}/`,
      ts: NOW - (index + 1) * 7 * 60 * 60 * 1000,
    });
  });

  CURSORS.forEach((cursor, index) => {
    items.push({
      id: `cur-${cursor.name}`,
      key: svgDataUri(cursor.markup),
      kind: "cursor",
      url: svgDataUri(cursor.markup),
      hotspotX: 2,
      hotspotY: 2,
      pageTitle: cursor.pageTitle,
      domain: cursor.domain,
      pageUrl: `https://${cursor.domain}/`,
      ts: NOW - (index + 3) * 9 * 60 * 60 * 1000,
    });
  });

  return items;
}
