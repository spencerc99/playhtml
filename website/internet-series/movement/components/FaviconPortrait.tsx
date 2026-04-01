// ABOUTME: Renders a grid of favicons for all pages visited in a time range.
// ABOUTME: Forms a visual portrait of browsing activity through site icons.

import React, { useMemo, useCallback, useState } from "react";
import type { CollectionEvent } from "../types";
import { extractDomain } from "../utils/eventUtils";

/** Deterministic hash of a string to a number in [0, 1) */
function hashString(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = (hash << 5) - hash + str.charCodeAt(i);
    hash = hash & hash;
  }
  return (Math.abs(hash) % 1000) / 1000;
}

/** Generate a muted placeholder color from a domain name */
function placeholderColor(domain: string): string {
  const h = Math.round(hashString(domain) * 360);
  return `hsl(${h}, 30%, 72%)`;
}

interface DomainVisit {
  domain: string;
  count: number;
  firstSeen: number;
  faviconUrl: string | null;
}

interface FaviconPortraitProps {
  events: CollectionEvent[];
  domainFilter: string;
}

const ICON_SIZE = 28;
const GAP = 2;
const PADDING = 12;

export const FaviconPortrait: React.FC<FaviconPortraitProps> = ({
  events,
  domainFilter,
}) => {
  const [failedDomains, setFailedDomains] = useState<Set<string>>(
    () => new Set(),
  );

  const domainVisits = useMemo(() => {
    const counts = new Map<
      string,
      { count: number; firstSeen: number; faviconUrl: string | null }
    >();

    for (const event of events) {
      if (event.type !== "navigation") continue;

      const url = event.meta?.url;
      if (!url) continue;

      const domain = extractDomain(url);
      if (!domain) continue;
      if (domainFilter && domain !== domainFilter) continue;

      const data = event.data as Record<string, unknown>;
      const faviconUrl = (data?.favicon_url as string) || null;

      const existing = counts.get(domain);
      if (existing) {
        existing.count++;
        // Prefer a stored favicon over the fallback
        if (faviconUrl && !existing.faviconUrl) {
          existing.faviconUrl = faviconUrl;
        }
      } else {
        counts.set(domain, { count: 1, firstSeen: event.ts, faviconUrl });
      }
    }

    return [...counts.entries()]
      .sort((a, b) => b[1].count - a[1].count)
      .map(
        ([domain, stats]): DomainVisit => ({
          domain,
          ...stats,
        }),
      );
  }, [events, domainFilter]);

  const handleImgError = useCallback(
    (domain: string) => {
      setFailedDomains((prev) => {
        if (prev.has(domain)) return prev;
        const next = new Set(prev);
        next.add(domain);
        return next;
      });
    },
    [],
  );

  if (domainVisits.length === 0) {
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
        {domainVisits.map(({ domain, faviconUrl }) => {
          const src =
            faviconUrl ||
            `https://www.google.com/s2/favicons?domain=${domain}&sz=32`;
          const failed = failedDomains.has(domain);

          return failed ? (
            <div
              key={domain}
              title={domain}
              style={{
                width: ICON_SIZE,
                height: ICON_SIZE,
                borderRadius: 4,
                backgroundColor: placeholderColor(domain),
              }}
            />
          ) : (
            <img
              key={domain}
              src={src}
              alt=""
              title={domain}
              loading="lazy"
              width={ICON_SIZE}
              height={ICON_SIZE}
              style={{ borderRadius: 4, display: "block" }}
              onError={() => handleImgError(domain)}
            />
          );
        })}
      </div>
    </div>
  );
};
