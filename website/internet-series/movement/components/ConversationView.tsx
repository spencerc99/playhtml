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

  const [visibleCount, setVisibleCount] = useState(0);
  const [showTyping, setShowTyping] = useState(false);
  const [typingText, setTypingText] = useState("");
  const [animationKey, setAnimationKey] = useState(0); // increment to restart
  const streamRef = useRef<HTMLDivElement>(null);
  const timeoutsRef = useRef<number[]>([]);

  const clearTimeouts = useCallback(() => {
    timeoutsRef.current.forEach((id) => clearTimeout(id));
    timeoutsRef.current = [];
  }, []);

  const addTimeout = useCallback((fn: () => void, ms: number) => {
    const id = window.setTimeout(fn, ms);
    timeoutsRef.current.push(id);
    return id;
  }, []);

  // Auto-scroll to bottom when new content appears
  useEffect(() => {
    if (streamRef.current) {
      const el = streamRef.current;
      el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
    }
  }, [visibleCount, showTyping]);

  // Animation loop
  useEffect(() => {
    if (messages.length === 0) return;
    clearTimeouts();
    setVisibleCount(0);
    setShowTyping(false);
    setTypingText("");

    let currentIndex = 0;

    function showNextMessage() {
      if (currentIndex >= messages.length) return;

      const msg = messages[currentIndex];
      const typingDuration = Math.min(
        1500,
        Math.max(500, msg.text.length * 30),
      );

      // Phase 1: Show typing indicator
      setShowTyping(true);

      addTimeout(() => {
        // Phase 2: Hide typing indicator, start typing text
        setShowTyping(false);
        setVisibleCount(currentIndex + 1);

        const chars = msg.text.split("");
        let charIndex = 0;

        function typeNextChar() {
          if (charIndex < chars.length) {
            charIndex++;
            setTypingText(msg.text.slice(0, charIndex));
            addTimeout(typeNextChar, 30);
          } else {
            // Phase 3: Done typing, pause then next message
            setTypingText("");
            const pause = 200 + Math.random() * 200;
            currentIndex++;
            addTimeout(showNextMessage, pause);
          }
        }

        typeNextChar();
      }, typingDuration);
    }

    // Start after a brief initial delay
    addTimeout(showNextMessage, 500);

    return clearTimeouts;
  }, [messages, animationKey, clearTimeouts, addTimeout]);

  const handleRestart = useCallback(() => {
    clearTimeouts();
    setVisibleCount(0);
    setShowTyping(false);
    setTypingText("");
    if (streamRef.current) {
      streamRef.current.scrollTo({ top: 0 });
    }
    setAnimationKey((k) => k + 1);
  }, [clearTimeouts]);

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

  // Messages to render: all fully visible + the one currently being typed
  const fullyVisible = messages.slice(0, visibleCount);
  const currentlyTyping =
    typingText && visibleCount > 0 ? messages[visibleCount - 1] : null;

  return (
    <div className="conversations-page">
      <div className="conversations-title">internet conversations</div>
      <div className="conversations-subtitle">
        starting from{" "}
        {startDisplay.toISOString().slice(0, 16).replace("T", " ")}
      </div>
      <div className="conversations-stream" ref={streamRef}>
        {fullyVisible.map((msg, i) => {
          const isBeingTyped = currentlyTyping?.id === msg.id;
          const displayText = isBeingTyped ? typingText : msg.text;
          const time = new Date(msg.timestamp);
          const timeStr = `${time.getHours().toString().padStart(2, "0")}:${time.getMinutes().toString().padStart(2, "0")}`;

          // Rotation based on message id hash
          const rotation = seededRandom(hashString(msg.id), 0) * 0.6 - 0.3;

          return (
            <div
              key={msg.id}
              className={`msg-row ${msg.side}`}
            >
              {msg.side === "left" && (
                <div
                  className={`msg-avatar ${msg.showAvatar ? "" : "hidden"}`}
                >
                  <img
                    src={FAVICON_URL(msg.domain)}
                    alt=""
                    loading="lazy"
                  />
                </div>
              )}
              <div
                className={`msg-bubble ${msg.fillClass} ${msg.shapeClass} ${msg.fontClass}`}
                style={{ transform: `rotate(${rotation}deg)` }}
              >
                {msg.showSender && (
                  <div className="msg-sender">
                    {msg.side === "right" && (
                      <span className="msg-time">{timeStr}</span>
                    )}
                    <span className="msg-domain">{msg.domain}</span>
                    {msg.side === "left" && (
                      <span className="msg-time">{timeStr}</span>
                    )}
                  </div>
                )}
                <div className="msg-text">{displayText}</div>
              </div>
              {msg.side === "right" && (
                <div
                  className={`msg-avatar ${msg.showAvatar ? "" : "hidden"}`}
                >
                  <img
                    src={FAVICON_URL(msg.domain)}
                    alt=""
                    loading="lazy"
                  />
                </div>
              )}
            </div>
          );
        })}

        {showTyping && (
          <div className="typing-indicator">
            <div className="typing-dot" />
            <div className="typing-dot" />
            <div className="typing-dot" />
          </div>
        )}
      </div>

      <button className="conversations-restart" onClick={handleRestart}>
        restart
      </button>
    </div>
  );
}
