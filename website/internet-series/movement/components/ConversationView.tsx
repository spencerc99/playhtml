// ABOUTME: Renders keyboard events as an animated chat conversation between websites
// ABOUTME: Processes events into messages, manages animation state, renders bubbles with typing indicators
import React, { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { CollectionEvent, KeyboardEventData } from "../types";
import { hashString, seededRandom } from "../utils/styleUtils";

const MIN_MESSAGE_LENGTH = 3;
const SAME_DOMAIN_GROUP_THRESHOLD_MS = 60_000;
const FAVICON_URL = (domain: string) =>
  `https://www.google.com/s2/favicons?domain=${domain}&sz=32`;

const FILL_CLASSES = ["fill-0", "fill-1", "fill-2", "fill-3", "fill-4"];
const SHAPE_CLASSES = ["shape-0", "shape-1", "shape-2", "shape-3"];
const FONT_CLASSES = ["font-0", "font-1", "font-2"];

// Default start date if none provided via URL param
const DEFAULT_START = new Date("2026-03-15T09:00:00");

interface ConversationMessage {
  id: string;
  text: string;
  domain: string;
  timestamp: number;
  fillClass: string;
  shapeClass: string;
  fontClass: string;
  side: "left" | "right";
  showAvatar: boolean;
  showSender: boolean;
}

interface DomainIdentity {
  fillClass: string;
  fontClass: string;
  side: "left" | "right";
}

function buildMessages(
  events: CollectionEvent[],
  startTime: Date | null,
): ConversationMessage[] {
  const start = startTime ?? DEFAULT_START;
  const startTs = start.getTime();

  const filtered = events.filter((e) => {
    if (e.ts < startTs) return false;
    const data = e.data as unknown as KeyboardEventData;
    const text = data?.t;
    return typeof text === "string" && text.trim().length >= MIN_MESSAGE_LENGTH;
  });

  filtered.sort((a, b) => a.ts - b.ts);

  const domainIdentities = new Map<string, DomainIdentity>();
  let nextSideIndex = 0;

  function getDomainIdentity(domain: string): DomainIdentity {
    if (domainIdentities.has(domain)) return domainIdentities.get(domain)!;
    const hash = hashString(domain);
    const fillClass = FILL_CLASSES[Math.abs(hash) % FILL_CLASSES.length];
    const fontClass = FONT_CLASSES[Math.abs(hash) % FONT_CLASSES.length];
    const side: "left" | "right" = nextSideIndex % 2 === 0 ? "left" : "right";
    nextSideIndex++;
    const identity = { fillClass, fontClass, side };
    domainIdentities.set(domain, identity);
    return identity;
  }

  const messages: ConversationMessage[] = [];
  for (let i = 0; i < filtered.length; i++) {
    const event = filtered[i];
    const data = event.data as unknown as KeyboardEventData;
    const text = (data.t ?? "").trim();
    const domain = event.domain ?? "unknown";
    const identity = getDomainIdentity(domain);

    const shapeClass =
      SHAPE_CLASSES[Math.abs(hashString(event.id)) % SHAPE_CLASSES.length];

    const prevDomain = i > 0 ? (filtered[i - 1].domain ?? "unknown") : null;
    const nextDomain =
      i < filtered.length - 1
        ? (filtered[i + 1].domain ?? "unknown")
        : null;
    const prevTs = i > 0 ? filtered[i - 1].ts : 0;
    const nextTs =
      i < filtered.length - 1 ? filtered[i + 1].ts : Infinity;

    const sameAsPrev =
      prevDomain === domain && event.ts - prevTs < SAME_DOMAIN_GROUP_THRESHOLD_MS;
    const sameAsNext =
      nextDomain === domain && nextTs - event.ts < SAME_DOMAIN_GROUP_THRESHOLD_MS;

    messages.push({
      id: event.id,
      text,
      domain,
      timestamp: event.ts,
      fillClass: identity.fillClass,
      shapeClass,
      fontClass: identity.fontClass,
      side: identity.side,
      showAvatar: !sameAsNext,
      showSender: !sameAsPrev,
    });
  }

  return messages;
}

interface ConversationViewProps {
  events: CollectionEvent[];
  loading: boolean;
  error: string | null;
  startTime: Date | null;
}

export function ConversationView({
  events,
  loading,
  error,
  startTime,
}: ConversationViewProps) {
  const messages = useMemo(
    () => buildMessages(events, startTime),
    [events, startTime],
  );

  // Animation state placeholder — Task 4 will add the animation loop
  const [visibleCount, setVisibleCount] = useState(0);
  const [showTyping, setShowTyping] = useState(false);
  const [typingText, setTypingText] = useState("");
  const streamRef = useRef<HTMLDivElement>(null);

  const startDisplay = startTime ?? DEFAULT_START;

  if (loading) {
    return (
      <div className="conversations-page">
        <div className="conversations-loading">loading conversations...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="conversations-page">
        <div className="conversations-error">{error}</div>
      </div>
    );
  }

  return (
    <div className="conversations-page">
      <div className="conversations-title">internet conversations</div>
      <div className="conversations-subtitle">
        starting from {startDisplay.toISOString().slice(0, 16).replace("T", " ")}
      </div>
      <div className="conversations-stream" ref={streamRef}>
        {/* Messages and typing indicator will be rendered here in Task 4 */}
      </div>
    </div>
  );
}
