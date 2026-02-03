// ABOUTME: Hook for radial (expand from center) navigation visualization
// ABOUTME: Builds domain-level nodes and session step sequences from navigation events

import { useMemo } from "react";
import {
  CollectionEvent,
  RadialNode,
  RadialSession,
  RadialState,
} from "../types";
import { RADIAL_ORGANIC_COLORS, extractDomain } from "../utils/eventUtils";

export interface NavigationRadialSettings {
  domainFilter: string;
  maxSessions: number;
  minSessionEvents: number;
  canvasWidth: number;
  canvasHeight: number;
}

export interface UseNavigationRadialResult {
  radialState: RadialState | null;
}

function normalizeUrl(url: string): string {
  try {
    const urlObj = new URL(url.startsWith("http") ? url : `https://${url}`);
    return urlObj.hostname.replace("www.", "") + urlObj.pathname;
  } catch {
    return url;
  }
}

function seededRandom(seed: number, offset: number = 0): number {
  const x = Math.sin(seed + offset * 12.9898) * 43758.5453;
  return x - Math.floor(x);
}

function hashString(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = (hash << 5) - hash + str.charCodeAt(i);
    hash = hash & hash;
  }
  return Math.abs(hash);
}

export function useNavigationRadial(
  events: CollectionEvent[],
  settings: NavigationRadialSettings
): UseNavigationRadialResult {
  const navigationEvents = useMemo(() => {
    return events.filter((e) => e.type === "navigation");
  }, [events]);

  const radialState = useMemo((): RadialState | null => {
    if (navigationEvents.length === 0 || settings.canvasWidth === 0) {
      return null;
    }

    const filteredEvents = settings.domainFilter
      ? navigationEvents.filter((event) => {
          const eventDomain = extractDomain(event.meta.url || "");
          return eventDomain === settings.domainFilter;
        })
      : navigationEvents;

    if (filteredEvents.length === 0) return null;

    const sortedEvents = [...filteredEvents].sort((a, b) => a.ts - b.ts);
    const eventsBySession = new Map<string, CollectionEvent[]>();
    sortedEvents.forEach((event) => {
      const sessionKey = `${event.meta.pid}|${event.meta.sid}`;
      if (!eventsBySession.has(sessionKey)) {
        eventsBySession.set(sessionKey, []);
      }
      eventsBySession.get(sessionKey)!.push(event);
    });

    const validSessions = Array.from(eventsBySession.entries())
      .filter(([_, sessionEvents]) => sessionEvents.length >= settings.minSessionEvents)
      .sort((a, b) => b[1].length - a[1].length)
      .slice(0, settings.maxSessions);

    if (validSessions.length === 0) {
      console.log("[Radial] No valid sessions after filtering");
      return null;
    }

    // Domain aggregates: visitCount, distinctUrlCount, and URLs per domain for counting
    const domainVisitCount = new Map<string, number>();
    const domainUrlSet = new Map<string, Set<string>>();

    validSessions.forEach(([_, sessionEvents]) => {
      const sortedSession = [...sessionEvents].sort((a, b) => a.ts - b.ts);
      sortedSession.forEach((event) => {
        const url = event.meta.url || (event.data as any).url || "";
        if (!url) return;
        const domain = extractDomain(url);
        const nodeId = normalizeUrl(url);

        domainVisitCount.set(domain, (domainVisitCount.get(domain) ?? 0) + 1);
        if (!domainUrlSet.has(domain)) {
          domainUrlSet.set(domain, new Set());
        }
        domainUrlSet.get(domain)!.add(nodeId);
      });
    });

    const domains = Array.from(domainVisitCount.keys()).sort();
    const domainColors = new Map<string, string>();
    domains.forEach((domain, idx) => {
      domainColors.set(domain, RADIAL_ORGANIC_COLORS[idx % RADIAL_ORGANIC_COLORS.length]);
    });

    // Layout: one node at center (first to appear), rest spread anywhere on the page
    const centerX = settings.canvasWidth / 2;
    const centerY = settings.canvasHeight / 2;
    const margin = 70;
    const usableW = settings.canvasWidth - margin * 2;
    const usableH = settings.canvasHeight - margin * 2;

    const visitCounts = new Map(domains.map((d) => [d, domainVisitCount.get(d) ?? 0]));
    const centerDomain = domains.reduce((a, b) =>
      (visitCounts.get(a) ?? 0) >= (visitCounts.get(b) ?? 0) ? a : b
    );

    const nodes = new Map<string, RadialNode>();
    const otherDomains = domains.filter((d) => d !== centerDomain);

    nodes.set(centerDomain, {
      id: centerDomain,
      x: centerX,
      y: centerY,
      visitCount: domainVisitCount.get(centerDomain) ?? 0,
      distinctUrlCount: domainUrlSet.get(centerDomain)?.size ?? 1,
      color: domainColors.get(centerDomain) ?? RISO_COLORS[0],
    });

    otherDomains.forEach((domain, idx) => {
      const seed = hashString(domain);
      const x = margin + seededRandom(seed, 0) * usableW;
      const y = margin + seededRandom(seed, 1) * usableH;
      nodes.set(domain, {
        id: domain,
        x,
        y,
        visitCount: domainVisitCount.get(domain) ?? 0,
        distinctUrlCount: domainUrlSet.get(domain)?.size ?? 1,
        color: domainColors.get(domain) ?? RISO_COLORS[0],
      });
    });

    const nodeList = Array.from(nodes.values());
    const minDist = 58;

    for (let iter = 0; iter < 15; iter++) {
      for (let i = 0; i < nodeList.length; i++) {
        for (let j = i + 1; j < nodeList.length; j++) {
          const a = nodeList[i];
          const b = nodeList[j];
          const dx = b.x - a.x;
          const dy = b.y - a.y;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist < minDist && dist > 0) {
            const overlap = (minDist - dist) / 2;
            const nx = dx / dist;
            const ny = dy / dist;
            a.x -= nx * overlap;
            a.y -= ny * overlap;
            b.x += nx * overlap;
            b.y += ny * overlap;
          }
        }
      }
      nodeList.forEach((node) => {
        if (node.id === centerDomain) {
          node.x = centerX;
          node.y = centerY;
        } else {
          node.x = Math.max(margin, Math.min(settings.canvasWidth - margin, node.x));
          node.y = Math.max(margin, Math.min(settings.canvasHeight - margin, node.y));
        }
      });
    }

    // Build sessions as domain-step sequences (collapse consecutive same-domain)
    const sessions: RadialSession[] = [];
    validSessions.forEach(([sessionKey, sessionEvents]) => {
      const sortedSession = [...sessionEvents].sort((a, b) => a.ts - b.ts);
      const firstUrl = sortedSession[0].meta.url || (sortedSession[0].data as any).url || "";
      const sessionColor = domainColors.get(extractDomain(firstUrl)) ?? RADIAL_ORGANIC_COLORS[0];

      const steps: Array<{ domainId: string; timestamp: number }> = [];
      let lastDomain: string | null = null;

      sortedSession.forEach((event) => {
        const url = event.meta.url || (event.data as any).url || "";
        if (!url) return;
        const domain = extractDomain(url);
        if (!nodes.has(domain)) return;

        if (domain !== lastDomain) {
          steps.push({ domainId: domain, timestamp: event.ts });
          lastDomain = domain;
        }
      });

      if (steps.length > 0) {
        sessions.push({
          id: sessionKey,
          color: sessionColor,
          steps,
        });
      }
    });

    console.log(`[Radial] Created ${nodes.size} domain nodes, ${sessions.length} sessions`);
    return { nodes, sessions };
  }, [
    navigationEvents,
    settings.domainFilter,
    settings.maxSessions,
    settings.minSessionEvents,
    settings.canvasWidth,
    settings.canvasHeight,
  ]);

  return { radialState };
}
