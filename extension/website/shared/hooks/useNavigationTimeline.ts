// ABOUTME: Hook for processing navigation events into a timeline visualization
// ABOUTME: Creates branching roots timeline with sessions as tracks and shared nodes

import { useMemo } from "react";
import {
  CollectionEvent,
  TimelineNode,
  TimelineEdge,
  TimelineSession,
  TimelineState,
} from "../types";
import { RISO_COLORS, extractDomain } from "../utils/eventUtils";

// Settings interface for navigation timeline
export interface NavigationTimelineSettings {
  domainFilter: string;
  maxSessions: number;
  minSessionEvents: number;
  canvasWidth: number;
  canvasHeight: number;
}

export interface UseNavigationTimelineResult {
  timelineState: TimelineState | null;
}

/**
 * Normalize URL for grouping (domain + path, no query params)
 */
function normalizeUrl(url: string): string {
  try {
    const urlObj = new URL(url.startsWith("http") ? url : `https://${url}`);
    return urlObj.hostname.replace("www.", "") + urlObj.pathname;
  } catch {
    return url;
  }
}

/**
 * Seeded random for consistent layout
 */
function seededRandom(seed: number, offset: number = 0): number {
  const x = Math.sin(seed + offset * 12.9898) * 43758.5453;
  return x - Math.floor(x);
}

/**
 * Hash string to number
 */
function hashString(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = (hash << 5) - hash + str.charCodeAt(i);
    hash = hash & hash;
  }
  return Math.abs(hash);
}

/**
 * Map timestamp to x position.
 * Linear mapping spreads events by actual time gaps for a less packed look.
 */
function timeToX(
  timestamp: number,
  minTime: number,
  maxTime: number,
  baseWidth: number,
  padding: number
): number {
  if (maxTime === minTime) return padding;
  
  const elapsed = timestamp - minTime;
  const totalDuration = maxTime - minTime;
  
  // Linear: events spread proportionally to time gaps
  const normalizedTime = elapsed / totalDuration;
  
  return padding + normalizedTime * (baseWidth - padding * 2);
}

/**
 * Hook for processing navigation events into a timeline structure
 */
export function useNavigationTimeline(
  events: CollectionEvent[],
  settings: NavigationTimelineSettings
): UseNavigationTimelineResult {
  // Filter to navigation events only
  const navigationEvents = useMemo(() => {
    return events.filter((e) => e.type === "navigation");
  }, [events]);

  // Build timeline from navigation events
  const timelineState = useMemo((): TimelineState | null => {
    if (navigationEvents.length === 0 || settings.canvasWidth === 0) {
      return null;
    }

    // Apply domain filter
    const filteredEvents = settings.domainFilter
      ? navigationEvents.filter((event) => {
          const eventDomain = extractDomain(event.meta.url || "");
          return eventDomain === settings.domainFilter;
        })
      : navigationEvents;

    if (filteredEvents.length === 0) {
      return null;
    }

    // Sort events by timestamp
    const sortedEvents = [...filteredEvents].sort((a, b) => a.ts - b.ts);

    // Group events by session
    const eventsBySession = new Map<string, CollectionEvent[]>();
    sortedEvents.forEach((event) => {
      const sessionKey = `${event.meta.pid}|${event.meta.sid}`;
      if (!eventsBySession.has(sessionKey)) {
        eventsBySession.set(sessionKey, []);
      }
      eventsBySession.get(sessionKey)!.push(event);
    });

    // Filter sessions by minimum events
    const validSessions = Array.from(eventsBySession.entries())
      .filter(([_, events]) => events.length >= settings.minSessionEvents)
      .sort((a, b) => b[1].length - a[1].length) // Most events first
      .slice(0, settings.maxSessions);

    if (validSessions.length === 0) {
      console.log("[Timeline] No valid sessions after filtering");
      return null;
    }

    console.log(`[Timeline] Processing ${validSessions.length} sessions`);

    // Build domain color map
    const domainSet = new Set<string>();
    validSessions.forEach(([_, sessionEvents]) => {
      sessionEvents.forEach((event) => {
        const url = event.meta.url || (event.data as any).url || "";
        if (url) {
          domainSet.add(extractDomain(url));
        }
      });
    });
    const domains = Array.from(domainSet).sort();
    const domainColors = new Map<string, string>();
    domains.forEach((domain, idx) => {
      domainColors.set(domain, RISO_COLORS[idx % RISO_COLORS.length]);
    });

    // Find time bounds across all valid sessions
    let minTime = Infinity;
    let maxTime = 0;
    validSessions.forEach(([_, sessionEvents]) => {
      sessionEvents.forEach((event) => {
        minTime = Math.min(minTime, event.ts);
        maxTime = Math.max(maxTime, event.ts);
      });
    });

    // Calculate timeline width - much wider for comfortable horizontal spread
    const totalWidth = Math.max(settings.canvasWidth * 12, 8000);
    const padding = 200;

    // Create sessions with random Y tracks
    const sessions: TimelineSession[] = [];
    const nodes = new Map<string, TimelineNode>();
    const edges: TimelineEdge[] = [];

    validSessions.forEach(([sessionKey, sessionEvents], sessionIdx) => {
      const pid = sessionEvents[0].meta.pid;
      const seed = hashString(sessionKey);
      
      // Distribute sessions across full vertical space with randomness
      // Use full height for maximum spread
      const numSessions = validSessions.length;
      const basePosition = (sessionIdx + 0.5) / numSessions; // Even distribution 0-1
      const jitter = (seededRandom(seed, 0) - 0.5) * (1.0 / numSessions); // Random jitter
      const baseY = 0.05 + (basePosition + jitter) * 0.9; // Use 90% of height
      
      // Session color based on first domain visited
      const firstUrl = sessionEvents[0].meta.url || (sessionEvents[0].data as any).url || "";
      const firstDomain = extractDomain(firstUrl);
      const sessionColor = domainColors.get(firstDomain) || RISO_COLORS[sessionIdx % RISO_COLORS.length];

      const sessionNodeEvents: Array<{ nodeId: string; timestamp: number }> = [];
      let lastNodeId: string | null = null;

      // Sort session events by timestamp
      const sortedSessionEvents = [...sessionEvents].sort((a, b) => a.ts - b.ts);

      sortedSessionEvents.forEach((event) => {
        const url = event.meta.url || (event.data as any).url || "";
        if (!url) return;

        const nodeId = normalizeUrl(url);
        const domain = extractDomain(url);
        const x = timeToX(event.ts, minTime, maxTime, totalWidth, padding);

        // Create or update node
        if (!nodes.has(nodeId)) {
          // Y position: average of sessions that touch this node (will update)
          nodes.set(nodeId, {
            id: nodeId,
            domain,
            fullUrl: url,
            x,
            y: baseY * settings.canvasHeight, // Initial Y based on first session
            color: domainColors.get(domain) || RISO_COLORS[0],
            sessions: [sessionKey],
            firstVisitTime: event.ts,
            visitCount: 1,
          });
        } else {
          const node = nodes.get(nodeId)!;
          if (!node.sessions.includes(sessionKey)) {
            node.sessions.push(sessionKey);
          }
          node.visitCount++;
          // Keep earliest x position
          if (event.ts < node.firstVisitTime) {
            node.x = x;
            node.firstVisitTime = event.ts;
          }
        }

        // Track node visit for this session
        if (nodeId !== lastNodeId) {
          sessionNodeEvents.push({ nodeId, timestamp: event.ts });

          // Create edge if not first node
          if (lastNodeId) {
            edges.push({
              id: `${sessionKey}-${lastNodeId}-${nodeId}-${event.ts}`,
              sourceNodeId: lastNodeId,
              targetNodeId: nodeId,
              sessionId: sessionKey,
              color: sessionColor,
              timestamp: event.ts,
            });
          }

          lastNodeId = nodeId;
        }
      });

      sessions.push({
        id: sessionKey,
        participantId: pid,
        baseY,
        color: sessionColor,
        events: sessionNodeEvents,
        startTime: sortedSessionEvents[0]?.ts || 0,
        endTime: sortedSessionEvents[sortedSessionEvents.length - 1]?.ts || 0,
      });
    });

    // Update node Y positions based on sessions that touch them
    // Nodes touched by multiple sessions get Y position that's average of those sessions
    nodes.forEach((node) => {
      if (node.sessions.length > 1) {
        // Average Y of all sessions touching this node, plus jitter
        let totalY = 0;
        node.sessions.forEach((sessionId) => {
          const session = sessions.find((s) => s.id === sessionId);
          if (session) {
            totalY += session.baseY;
          }
        });
        const avgY = (totalY / node.sessions.length) * settings.canvasHeight;
        const jitterRange = settings.canvasHeight * 0.35; // ±17.5% of height
        const jitter = (seededRandom(hashString(node.id), 2) - 0.5) * jitterRange;
        node.y = avgY + jitter;
      } else if (node.sessions.length === 1) {
        // Single session: large vertical jitter scaled by canvas height
        const session = sessions.find((s) => s.id === node.sessions[0]);
        if (session) {
          const jitterRange = settings.canvasHeight * 0.55; // ±27.5% of height
          const jitter = (seededRandom(hashString(node.id), 1) - 0.5) * jitterRange;
          node.y = session.baseY * settings.canvasHeight + jitter;
        }
      }
      
      // Clamp Y to canvas with generous margins
      node.y = Math.max(80, Math.min(settings.canvasHeight - 80, node.y));
    });

    // Minimum spacing pass: nudge apart nodes that are too close
    const nodeList = Array.from(nodes.values());
    const minDist = 100;
    const margin = 80;
    
    for (let iter = 0; iter < 5; iter++) {
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
      
      // Re-clamp after each iteration
      nodeList.forEach((node) => {
        node.x = Math.max(padding, Math.min(totalWidth - padding, node.x));
        node.y = Math.max(margin, Math.min(settings.canvasHeight - margin, node.y));
      });
    }

    console.log(
      `[Timeline] Created ${nodes.size} nodes, ${edges.length} edges, ${sessions.length} sessions`
    );

    return {
      nodes,
      edges,
      sessions,
      minTime,
      maxTime,
      totalWidth,
    };
  }, [
    navigationEvents,
    settings.domainFilter,
    settings.maxSessions,
    settings.minSessionEvents,
    settings.canvasWidth,
    settings.canvasHeight,
  ]);

  return { timelineState };
}
