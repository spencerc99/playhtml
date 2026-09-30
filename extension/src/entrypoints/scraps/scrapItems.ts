// ABOUTME: The scrap records the background hands out, and how each becomes a collage item.
// ABOUTME: Shared by the scraps page and the new-tab launch card that previews the pile.

import type { ScrapSource } from "@movement/utils/scrapPhotoGroups";
import type { ScrapItem, ScrapPosition } from "@movement/components/ScrapCollage";

interface ScrapRecordBase {
  sources?: ScrapSource[];
  encounterCount?: number;
  encounterDay?: string;
  id: string;
  key: string;
  pageTitle: string;
  faviconUrl?: string;
  domain: string;
  pageUrl: string;
  ts: number;
  position?: ScrapPosition;
}

export type ScrapRecord = ScrapRecordBase &
  (
    | {
        kind: "image";
        src: string;
        contentHash?: string;
        alt?: string;
        naturalWidth: number;
        naturalHeight: number;
      }
    | {
        kind: "button";
        text: string;
        styles: Record<string, string>;
        innerSvg?: string;
        backdropColor?: string;
      }
    | {
        kind: "svg-icon";
        markup: string;
        width: number;
        height: number;
      }
    | {
        kind: "heading";
        text: string;
        level: 1 | 2 | 3;
        styles: Record<string, string>;
        backdropColor?: never;
      }
    | {
        kind: "cursor";
        url: string;
        hotspotX?: number;
        hotspotY?: number;
      }
  );


/** The collage item a stored scrap record draws as. */
export function toScrapItem(record: ScrapRecord): ScrapItem {
  const base = {
    id: record.id,
    encounterCount: record.encounterCount,
    encounterDay: record.encounterDay,
    ...(record.sources ? { sources: record.sources } : {}),
    key: record.key,
    pageTitle: record.pageTitle,
    ...(record.faviconUrl !== undefined
      ? { faviconUrl: record.faviconUrl }
      : {}),
    domain: record.domain,
    pageUrl: record.pageUrl,
    ts: record.ts,
    ...(record.position ? { position: record.position } : {}),
  };

  switch (record.kind) {
    case "image":
      return {
        ...base,
        kind: record.kind,
        src: record.src,
        ...(record.contentHash ? { contentHash: record.contentHash } : {}),
        ...(record.alt !== undefined ? { alt: record.alt } : {}),
        naturalWidth: record.naturalWidth,
        naturalHeight: record.naturalHeight,
      };
    case "button":
      return {
        ...base,
        kind: record.kind,
        text: record.text,
        styles: record.styles,
        ...(record.innerSvg !== undefined ? { innerSvg: record.innerSvg } : {}),
        ...(record.backdropColor !== undefined
          ? { backdropColor: record.backdropColor }
          : {}),
      };
    case "svg-icon":
      return {
        ...base,
        kind: record.kind,
        markup: record.markup,
        width: record.width,
        height: record.height,
      };
    case "heading":
      return {
        ...base,
        kind: record.kind,
        text: record.text,
        level: record.level,
        styles: record.styles,
      };
    case "cursor":
      return {
        ...base,
        kind: record.kind,
        url: record.url,
        ...(record.hotspotX !== undefined ? { hotspotX: record.hotspotX } : {}),
        ...(record.hotspotY !== undefined ? { hotspotY: record.hotspotY } : {}),
      };
  }
}
