// ABOUTME: Hook for processing navigation events into a graph visualization
// ABOUTME: Extracts navigation-specific logic from movement.tsx for cleaner separation of concerns

import { useMemo } from "react";
import {
  CollectionEvent,
  NavigationNode,
  NavigationEdge,
  NavigationState,
  NavigationJourney,
} from "../types";
import { generateWobblyCursorPath, hashString as hashStr, seededRandom } from "../utils/styleUtils";
import {
  RISO_COLORS,
  getColorForParticipant,
  extractDomain,
} from "../utils/eventUtils";

// Settings interface for navigation graph
export interface NavigationGraphSettings {
  domainFilter: string;
  navigationMaxNodes: number;
  navigationMinVisits: number;
}

export interface UseNavigationGraphResult {
  navigationState: NavigationState | null;
  timeBounds: { min: number; max: number };
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
 * Hook for processing navigation events into a graph structure
 *
 * @param events - All collection events (will be filtered to navigation type)
 * @param viewportSize - Current viewport dimensions for layout
 * @param settings - Navigation graph settings
 * @returns Navigation state with nodes, edges, and journeys, plus time bounds
 */
export function useNavigationGraph(
  events: CollectionEvent[],
  viewportSize: { width: number; height: number },
  settings: NavigationGraphSettings
): UseNavigationGraphResult {
  // Filter to navigation events only
  const navigationEvents = useMemo(() => {
    return events.filter((e) => e.type === "navigation");
  }, [events]);

  // Build navigation graph from navigation events
  const navigationState = useMemo((): NavigationState | null => {
    if (navigationEvents.length === 0 || viewportSize.width === 0) {
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

    console.log(
      `[Navigation] Processing ${filteredEvents.length} navigation events`
    );

    // Build nodes from page visits
    const nodeMap = new Map<string, NavigationNode>();
    const edgeMap = new Map<string, NavigationEdge>();

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

    // Process each session to extract page visits and transitions
    eventsBySession.forEach((sessionEvents) => {
      const pid = sessionEvents[0].meta.pid;
      let lastPageUrl: string | null = null;
      let lastPageTs = 0;

      // Sort session events by timestamp
      const sortedSessionEvents = [...sessionEvents].sort(
        (a, b) => a.ts - b.ts
      );

      sortedSessionEvents.forEach((event) => {
        const eventData = event.data as any;
        const currentUrl =
          event.meta.url || eventData.url || eventData.from_url || "";

        if (!currentUrl) return;

        const normalizedUrl = normalizeUrl(currentUrl);
        const domain = extractDomain(currentUrl);

        // Create or update node for this page
        if (!nodeMap.has(normalizedUrl)) {
          nodeMap.set(normalizedUrl, {
            id: normalizedUrl,
            domain,
            fullUrl: currentUrl,
            visitCount: 0,
            totalTimeMs: 0,
            participants: new Set<string>(),
            firstVisitTs: event.ts,
            lastVisitTs: event.ts,
            x: 0,
            y: 0,
            domainColor: "", // Will be set after domain colors are assigned
          });
        }

        const node = nodeMap.get(normalizedUrl)!;

        // Track URL transition - create edge on ANY URL change
        if (normalizedUrl !== lastPageUrl) {
          // Count this as a visit
          node.visitCount++;
          node.participants.add(pid);
          node.lastVisitTs = Math.max(node.lastVisitTs, event.ts);

          // Create edge from previous page if exists
          if (lastPageUrl) {
            const edgeId = `${lastPageUrl}→${normalizedUrl}`;
            if (!edgeMap.has(edgeId)) {
              edgeMap.set(edgeId, {
                id: edgeId,
                source: lastPageUrl,
                target: normalizedUrl,
                traversalCount: 0,
                participants: new Set<string>(),
                wobblePath: [],
              });
            }
            const edge = edgeMap.get(edgeId)!;
            edge.traversalCount++;
            edge.participants.add(pid);
          }

          // Update time spent on previous page
          if (lastPageUrl && lastPageTs > 0) {
            const prevNode = nodeMap.get(lastPageUrl);
            if (prevNode) {
              prevNode.totalTimeMs += event.ts - lastPageTs;
            }
          }

          lastPageUrl = normalizedUrl;
          lastPageTs = event.ts;
        }

        // Handle beforeunload - update time on current page
        if (eventData.event === "beforeunload") {
          if (lastPageUrl && lastPageTs > 0) {
            const currNode = nodeMap.get(lastPageUrl);
            if (currNode) {
              currNode.totalTimeMs += event.ts - lastPageTs;
            }
          }
        }
      });
    });

    // Filter nodes by minVisits and limit to maxNodes
    let nodes = Array.from(nodeMap.values())
      .filter((n) => n.visitCount >= settings.navigationMinVisits)
      .sort((a, b) => b.visitCount - a.visitCount)
      .slice(0, settings.navigationMaxNodes);

    if (nodes.length === 0) {
      console.log("[Navigation] No nodes after filtering");
      return null;
    }

    // Keep only edges where both source and target are in the filtered nodes
    const nodeIds = new Set(nodes.map((n) => n.id));
    const edges = Array.from(edgeMap.values()).filter(
      (e) => nodeIds.has(e.source) && nodeIds.has(e.target)
    );

    console.log(
      `[Navigation] Created ${nodes.length} nodes and ${edges.length} edges`
    );

    // Generate spread layout across the canvas
    const canvasWidth = viewportSize.width;
    const canvasHeight = viewportSize.height;

    // Group nodes by domain for clustering
    const nodesByDomain = new Map<string, NavigationNode[]>();
    nodes.forEach((node) => {
      if (!nodesByDomain.has(node.domain)) {
        nodesByDomain.set(node.domain, []);
      }
      nodesByDomain.get(node.domain)!.push(node);
    });

    // Assign domain colors (consistent per domain)
    const domains = Array.from(nodesByDomain.keys()).sort();
    domains.forEach((domain, idx) => {
      const color = RISO_COLORS[idx % RISO_COLORS.length];
      nodesByDomain.get(domain)!.forEach((node) => {
        node.domainColor = color;
      });
    });

    console.log(
      `[Navigation] ${domains.length} domains: ${domains.slice(0, 5).join(", ")}${
        domains.length > 5 ? "..." : ""
      }`
    );

    // Spread layout - use entire canvas, cluster same-domain nodes nearby
    const layoutSeed = hashStr(nodes[0]?.id || "default");
    const padding = 100;
    const usableWidth = canvasWidth - padding * 2;
    const usableHeight = canvasHeight - padding * 2;

    // Position domains in a grid-like pattern across the canvas
    const numDomains = domains.length;
    const cols = Math.ceil(Math.sqrt(numDomains * (usableWidth / usableHeight)));
    const rows = Math.ceil(numDomains / cols);
    const cellWidth = usableWidth / cols;
    const cellHeight = usableHeight / rows;

    const domainPositions = new Map<string, { x: number; y: number }>();

    domains.forEach((domain, idx) => {
      const col = idx % cols;
      const row = Math.floor(idx / cols);
      const seed = hashStr(domain);

      // Position in cell with some randomness
      const cellCenterX = padding + col * cellWidth + cellWidth / 2;
      const cellCenterY = padding + row * cellHeight + cellHeight / 2;

      // Add jitter within cell
      const jitterX = (seededRandom(seed, 0) - 0.5) * cellWidth * 0.4;
      const jitterY = (seededRandom(seed, 1) - 0.5) * cellHeight * 0.4;

      domainPositions.set(domain, {
        x: cellCenterX + jitterX,
        y: cellCenterY + jitterY,
      });
    });

    // Position nodes within their domain area
    nodesByDomain.forEach((domainNodes, domain) => {
      const domainPos = domainPositions.get(domain)!;

      // Spread nodes around the domain center
      const spreadRadius = Math.min(cellWidth, cellHeight) * 0.35;
      const nodeAngleStep = (2 * Math.PI) / Math.max(1, domainNodes.length);

      domainNodes.forEach((node, idx) => {
        const seed = hashStr(node.id) + layoutSeed;

        if (domainNodes.length === 1) {
          // Single node - place at domain center with small jitter
          node.x = domainPos.x + (seededRandom(seed, 2) - 0.5) * 30;
          node.y = domainPos.y + (seededRandom(seed, 3) - 0.5) * 30;
        } else {
          // Multiple nodes - spiral out from center
          const angle = nodeAngleStep * idx + seededRandom(seed, 0) * 0.6;
          const radius =
            spreadRadius * (0.3 + (idx / domainNodes.length) * 0.7);

          node.x = domainPos.x + Math.cos(angle) * radius;
          node.y = domainPos.y + Math.sin(angle) * radius;

          // Add jitter
          node.x += (seededRandom(seed, 4) - 0.5) * 25;
          node.y += (seededRandom(seed, 5) - 0.5) * 25;
        }

        // Clamp to canvas bounds (URL pills: 140px wide, 24px tall)
        const pillWidth = 140;
        const pillHeight = 24;
        node.x = Math.max(
          pillWidth / 2 + 20,
          Math.min(canvasWidth - pillWidth / 2 - 20, node.x)
        );
        node.y = Math.max(
          pillHeight / 2 + 20,
          Math.min(canvasHeight - pillHeight / 2 - 20, node.y)
        );
      });
    });

    // Collision detection and resolution (simple push apart)
    const minSeparation = 100;
    for (let iter = 0; iter < 5; iter++) {
      for (let i = 0; i < nodes.length; i++) {
        for (let j = i + 1; j < nodes.length; j++) {
          const dx = nodes[j].x - nodes[i].x;
          const dy = nodes[j].y - nodes[i].y;
          const dist = Math.sqrt(dx * dx + dy * dy);

          if (dist < minSeparation && dist > 0) {
            const overlap = (minSeparation - dist) / 2;
            const nx = dx / dist;
            const ny = dy / dist;

            nodes[i].x -= nx * overlap;
            nodes[i].y -= ny * overlap;
            nodes[j].x += nx * overlap;
            nodes[j].y += ny * overlap;

            // Re-clamp
            const pillWidth = 140;
            const pillHeight = 24;
            nodes[i].x = Math.max(
              pillWidth / 2 + 10,
              Math.min(canvasWidth - pillWidth / 2 - 10, nodes[i].x)
            );
            nodes[i].y = Math.max(
              pillHeight / 2 + 10,
              Math.min(canvasHeight - pillHeight / 2 - 10, nodes[i].y)
            );
            nodes[j].x = Math.max(
              pillWidth / 2 + 10,
              Math.min(canvasWidth - pillWidth / 2 - 10, nodes[j].x)
            );
            nodes[j].y = Math.max(
              pillHeight / 2 + 10,
              Math.min(canvasHeight - pillHeight / 2 - 10, nodes[j].y)
            );
          }
        }
      }
    }

    // Generate wobbly cursor paths for edges
    edges.forEach((edge) => {
      const sourceNode = nodes.find((n) => n.id === edge.source);
      const targetNode = nodes.find((n) => n.id === edge.target);

      if (sourceNode && targetNode) {
        const seed = hashStr(edge.id);
        edge.wobblePath = generateWobblyCursorPath(
          { x: sourceNode.x, y: sourceNode.y },
          { x: targetNode.x, y: targetNode.y },
          seed,
          1.2
        );
      }
    });

    // Build journeys from sessions
    const journeys: NavigationJourney[] = [];

    eventsBySession.forEach((sessionEvents, sessionKey) => {
      const pid = sessionEvents[0].meta.pid;
      const color = getColorForParticipant(pid);

      const journeyNodeSequence: string[] = [];
      const journeyEdgeSequence: string[] = [];
      let journeyStartTime = Infinity;
      let journeyEndTime = 0;

      let lastNormalizedUrl: string | null = null;

      // Sort by timestamp
      const sortedSessionEvents = [...sessionEvents].sort(
        (a, b) => a.ts - b.ts
      );

      sortedSessionEvents.forEach((event) => {
        const eventData = event.data as any;
        const currentUrl =
          event.meta.url || eventData.url || eventData.from_url || "";

        if (!currentUrl) return;

        const normalizedUrl = normalizeUrl(currentUrl);

        // Only process if this node is in our filtered set
        if (!nodeIds.has(normalizedUrl)) return;

        // Add node to sequence if different from last
        if (normalizedUrl !== lastNormalizedUrl) {
          journeyNodeSequence.push(normalizedUrl);

          // Add edge if we have a previous page
          if (lastNormalizedUrl) {
            const edgeId = `${lastNormalizedUrl}→${normalizedUrl}`;
            if (edges.some((e) => e.id === edgeId)) {
              journeyEdgeSequence.push(edgeId);
            }
          }

          lastNormalizedUrl = normalizedUrl;

          // Track timing
          journeyStartTime = Math.min(journeyStartTime, event.ts);
          journeyEndTime = Math.max(journeyEndTime, event.ts);
        }
      });

      // Add journey if it has at least 1 node
      if (journeyNodeSequence.length >= 1) {
        journeys.push({
          id: `journey-${sessionKey}`,
          participantId: pid,
          color,
          nodeSequence: journeyNodeSequence,
          edgeSequence: journeyEdgeSequence,
          startTime: journeyStartTime,
          endTime: journeyEndTime,
        });
      }
    });

    // Sort journeys by number of edges (multi-node journeys first)
    journeys.sort((a, b) => b.edgeSequence.length - a.edgeSequence.length);

    // Log journey details
    const journeysWithEdges = journeys.filter((j) => j.edgeSequence.length > 0);
    console.log(
      `[Navigation] Created ${journeys.length} journeys (${journeysWithEdges.length} with edges)`
    );

    // Calculate animation duration based on journeys
    const maxJourneyLength = Math.max(
      ...journeys.map((j) => j.nodeSequence.length),
      1
    );
    const durationMs = Math.max(
      10000,
      Math.min(45000, journeys.length * 3000 + maxJourneyLength * 1500)
    );

    return {
      nodes,
      edges,
      journeys,
      durationMs,
    };
  }, [
    navigationEvents,
    viewportSize,
    settings.domainFilter,
    settings.navigationMaxNodes,
    settings.navigationMinVisits,
  ]);

  // Calculate time bounds from navigation events
  const timeBounds = useMemo(() => {
    if (navigationEvents.length === 0) {
      return { min: 0, max: 0 };
    }

    const timestamps = navigationEvents.map((e) => e.ts);
    return {
      min: Math.min(...timestamps),
      max: Math.max(...timestamps),
    };
  }, [navigationEvents]);

  return {
    navigationState,
    timeBounds,
  };
}
