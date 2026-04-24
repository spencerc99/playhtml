// ABOUTME: Renders a dense grid of favicons for every page visit in a time range.
// ABOUTME: Each navigation event produces one favicon, repeated visits show repeated icons.

import React, { useMemo, useCallback, useState, useEffect } from "react";
import type { CollectionEvent } from "../types";
import { extractDomain } from "../utils/eventUtils";

function hashString(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = (hash << 5) - hash + str.charCodeAt(i);
    hash = hash & hash;
  }
  return (Math.abs(hash) % 1000) / 1000;
}

function placeholderColor(domain: string): string {
  const h = Math.round(hashString(domain) * 360);
  return `hsl(${h}, 30%, 72%)`;
}

interface FaviconVisit {
  id: string;
  domain: string;
  faviconUrl: string | null;
  ts: number;
}

interface FaviconPortraitProps {
  events: CollectionEvent[];
  domainFilter: string;
}

// Tiny icons packed tight like Chrome's compressed tabs
const ICON_SIZE = 18;
const GAP = 1;
const PADDING = 4;

export const FaviconPortrait: React.FC<FaviconPortraitProps> = ({
  events,
  domainFilter,
}) => {
  const [failedDomains, setFailedDomains] = useState<Set<string>>(
    () => new Set(),
  );

  useEffect(() => {
    setFailedDomains(new Set());
  }, [events]);

  // One entry per navigation event (not deduplicated)
  const visits = useMemo(() => {
    const result: FaviconVisit[] = [];
    // Track best known favicon per domain
    const domainFavicons = new Map<string, string>();

    for (const event of events) {
      if (event.type !== "navigation") continue;
      const url = event.meta?.url;
      if (!url) continue;
      const domain = extractDomain(url);
      if (!domain) continue;
      if (domainFilter && domain !== domainFilter) continue;

      const data = event.data as Record<string, unknown>;
      const dataEvent = data?.event as string;
      // Only count focus events (actual page visits, not blur/unload)
      if (dataEvent !== "focus") continue;

      const faviconUrl = (data?.favicon_url as string) || null;
      if (faviconUrl) domainFavicons.set(domain, faviconUrl);

      result.push({
        id: event.id,
        domain,
        faviconUrl: faviconUrl || domainFavicons.get(domain) || null,
        ts: event.ts,
      });
    }

    // Sort chronologically
    result.sort((a, b) => a.ts - b.ts);
    return result;
  }, [events, domainFilter]);

  const handleImgError = useCallback((domain: string) => {
    setFailedDomains((prev) => {
      if (prev.has(domain)) return prev;
      const next = new Set(prev);
      next.add(domain);
      return next;
    });
  }, []);

  if (visits.length === 0) {
    return (
      <div
        style={{
          position: "absolute",
          inset: 0,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontFamily: '"Atkinson Hyperlegible", sans-serif',
          fontSize: "14px",
          color: "#8a8279",
          pointerEvents: "none",
        }}
      >
        No navigation events found
      </div>
    );
  }

  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        overflow: "auto",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: `${GAP}px`,
          padding: `${PADDING}px`,
          maxWidth: "100%",
          alignContent: "center",
        }}
      >
        {visits.map(({ id, domain, faviconUrl }) => {
          const src =
            faviconUrl ||
            `https://www.google.com/s2/favicons?domain=${domain}&sz=32`;
          const failed = failedDomains.has(domain);

          return failed ? (
            <div
              key={id}
              title={domain}
              style={{
                width: ICON_SIZE,
                height: ICON_SIZE,
                borderRadius: 3,
                backgroundColor: placeholderColor(domain),
                flexShrink: 0,
              }}
            />
          ) : (
            <img
              key={id}
              src={src}
              alt=""
              title={domain}
              loading="lazy"
              width={ICON_SIZE}
              height={ICON_SIZE}
              style={{
                borderRadius: 3,
                display: "block",
                flexShrink: 0,
              }}
              onError={() => handleImgError(domain)}
            />
          );
        })}
      </div>
    </div>
  );
};
