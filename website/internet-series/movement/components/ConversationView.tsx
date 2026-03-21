// ABOUTME: Renders keyboard events as an animated chat conversation between websites
// ABOUTME: Processes events into messages, manages animation state, renders bubbles with typing indicators
import React, { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { CollectionEvent, KeyboardEventData, TypingAction } from "../types";
import { hashString, seededRandom } from "../utils/styleUtils";
import { extractDomain } from "../utils/eventUtils";

const MIN_MESSAGE_LENGTH = 3;
const SAME_DOMAIN_GROUP_THRESHOLD_MS = 60_000;
const FAVICON_URL = (domain: string) =>
  `https://www.google.com/s2/favicons?domain=${domain}&sz=32`;

const FILL_CLASSES = ["fill-0", "fill-1", "fill-2", "fill-3", "fill-4"];
const SHAPE_CLASSES = ["shape-0", "shape-1", "shape-2", "shape-3"];
const FONT_CLASSES = ["font-0", "font-1", "font-2"];

// Default: show all data (epoch 0 = no filtering)
const DEFAULT_START = new Date(0);

// Double-tap threshold for 'd' key to toggle config panel
const DOUBLE_TAP_MS = 400;

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

interface DomainStats {
  domain: string;
  count: number;
}

/** Replay a typing sequence to its final text (apply all types and backspaces). */
function replayToFinalText(sequence: TypingAction[]): string {
  let text = "";
  for (const action of sequence) {
    if (action.action === "type" && action.text) {
      text += action.text;
    } else if (action.action === "backspace" && action.deletedCount) {
      text = text.slice(0, -Math.min(action.deletedCount, text.length));
    }
  }
  return text;
}

/** Filter out key-repeat spam (e.g. "sssssss") by checking character diversity. */
function isRepeatSpam(text: string): boolean {
  if (text.length < 5) return false;
  const charCounts = new Map<string, number>();
  for (const c of text) {
    charCounts.set(c, (charCounts.get(c) ?? 0) + 1);
  }
  // If any single character makes up > 70% of the text, it's spam
  for (const count of charCounts.values()) {
    if (count / text.length > 0.7) return true;
  }
  return false;
}

interface ProcessedEvent {
  event: CollectionEvent;
  text: string;
  domain: string;
}

/** Pre-process all events into usable messages (before start time filtering). */
function processEvents(events: CollectionEvent[]): ProcessedEvent[] {
  const processed: ProcessedEvent[] = [];
  for (const e of events) {
    const data = e.data as unknown as KeyboardEventData;
    if (!data?.sequence || data.sequence.length === 0) continue;

    const text = replayToFinalText(data.sequence).trim();
    if (text.length < MIN_MESSAGE_LENGTH) continue;
    if (isRepeatSpam(text)) continue;

    const domain = extractDomain(e.meta?.url ?? "") || "unknown";
    processed.push({ event: e, text, domain });
  }
  processed.sort((a, b) => a.event.ts - b.event.ts);
  return processed;
}

/** Count messages per domain for the histogram. */
function getDomainStats(processed: ProcessedEvent[]): DomainStats[] {
  const counts = new Map<string, number>();
  for (const p of processed) {
    counts.set(p.domain, (counts.get(p.domain) ?? 0) + 1);
  }
  return Array.from(counts.entries())
    .map(([domain, count]) => ({ domain, count }))
    .sort((a, b) => b.count - a.count);
}

function buildMessages(
  processed: ProcessedEvent[],
  startTime: Date,
): ConversationMessage[] {
  const startTs = startTime.getTime();
  const filtered = startTs > 0
    ? processed.filter((p) => p.event.ts >= startTs)
    : processed;

  // Assign domain identities (deterministic via hash)
  const domainIdentities = new Map<string, DomainIdentity>();
  let nextSideIndex = 0;

  function getDomainIdentity(domain: string): DomainIdentity {
    if (domainIdentities.has(domain)) return domainIdentities.get(domain)!;
    const hash = hashString(domain);
    const fillClass = FILL_CLASSES[hash % FILL_CLASSES.length];
    const fontClass = FONT_CLASSES[hash % FONT_CLASSES.length];
    const side: "left" | "right" = nextSideIndex % 2 === 0 ? "left" : "right";
    nextSideIndex++;
    const identity = { fillClass, fontClass, side };
    domainIdentities.set(domain, identity);
    return identity;
  }

  // Build message list with grouping info
  const messages: ConversationMessage[] = [];
  for (let i = 0; i < filtered.length; i++) {
    const { event, text, domain } = filtered[i];
    const identity = getDomainIdentity(domain);

    const shapeClass =
      SHAPE_CLASSES[hashString(event.id) % SHAPE_CLASSES.length];

    // Determine clustering: same domain within threshold
    const prevDomain = i > 0 ? filtered[i - 1].domain : null;
    const nextDomain = i < filtered.length - 1 ? filtered[i + 1].domain : null;
    const prevTs = i > 0 ? filtered[i - 1].event.ts : 0;
    const nextTs = i < filtered.length - 1 ? filtered[i + 1].event.ts : Infinity;

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

// ── Config Panel ──────────────────────────────────────────────────────────────

interface ConfigPanelProps {
  startTime: Date;
  onStartTimeChange: (date: Date) => void;
  onRestart: () => void;
  domainStats: DomainStats[];
  totalMessages: number;
  visibleMessages: number;
}

function ConfigPanel({
  startTime,
  onStartTimeChange,
  onRestart,
  domainStats,
  totalMessages,
  visibleMessages,
}: ConfigPanelProps) {
  const maxCount = domainStats.length > 0 ? domainStats[0].count : 1;

  // Format start time for the datetime-local input
  const startTimeValue = startTime.getTime() > 0
    ? startTime.toISOString().slice(0, 16)
    : "";

  return (
    <div className="config-panel">
      <div className="config-header">
        <span className="config-title">configuration</span>
        <span className="config-hint">press d twice to close</span>
      </div>

      <div className="config-section">
        <label className="config-label">start from</label>
        <div className="config-row">
          <input
            type="datetime-local"
            className="config-input"
            value={startTimeValue}
            onChange={(e) => {
              const val = e.target.value;
              if (val) {
                onStartTimeChange(new Date(val));
              } else {
                onStartTimeChange(new Date(0));
              }
            }}
          />
          {startTime.getTime() > 0 && (
            <button
              className="config-clear"
              onClick={() => onStartTimeChange(new Date(0))}
              title="show all"
            >
              clear
            </button>
          )}
        </div>
      </div>

      <div className="config-section">
        <label className="config-label">
          {visibleMessages} / {totalMessages} messages
        </label>
        <button className="config-btn" onClick={onRestart}>
          restart animation
        </button>
      </div>

      <div className="config-section">
        <label className="config-label">domains</label>
        <div className="config-histogram">
          {domainStats.slice(0, 12).map((ds) => (
            <div key={ds.domain} className="histogram-row">
              <img
                className="histogram-favicon"
                src={FAVICON_URL(ds.domain)}
                alt=""
                loading="lazy"
              />
              <span className="histogram-domain">{ds.domain}</span>
              <div className="histogram-bar-track">
                <div
                  className="histogram-bar-fill"
                  style={{ width: `${(ds.count / maxCount) * 100}%` }}
                />
              </div>
              <span className="histogram-count">{ds.count}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Main Component ────────────────────────────────────────────────────────────

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
  startTime: initialStartTime,
}: ConversationViewProps) {
  const [startTime, setStartTime] = useState<Date>(initialStartTime ?? DEFAULT_START);
  const [showConfig, setShowConfig] = useState(false);

  // Pre-process all events once (independent of start time)
  const allProcessed = useMemo(() => processEvents(events), [events]);
  const domainStats = useMemo(() => getDomainStats(allProcessed), [allProcessed]);

  // Build messages filtered by start time
  const messages = useMemo(
    () => buildMessages(allProcessed, startTime),
    [allProcessed, startTime],
  );

  const [visibleCount, setVisibleCount] = useState(0);
  const [showTyping, setShowTyping] = useState(false);
  const [typingText, setTypingText] = useState("");
  const [animationKey, setAnimationKey] = useState(0);
  const streamRef = useRef<HTMLDivElement>(null);
  const timeoutsRef = useRef<number[]>([]);
  const lastDPressRef = useRef<number>(0);

  const clearTimeouts = useCallback(() => {
    timeoutsRef.current.forEach((id) => clearTimeout(id));
    timeoutsRef.current = [];
  }, []);

  const addTimeout = useCallback((fn: () => void, ms: number) => {
    const id = window.setTimeout(fn, ms);
    timeoutsRef.current.push(id);
    return id;
  }, []);

  // Double-tap 'd' to toggle config panel
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key !== "d" || e.target !== document.body) return;
      const now = Date.now();
      if (now - lastDPressRef.current < DOUBLE_TAP_MS) {
        setShowConfig((s) => !s);
        lastDPressRef.current = 0;
      } else {
        lastDPressRef.current = now;
      }
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
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
      if (currentIndex >= messages.length) {
        // Loop: pause, then restart from the beginning
        addTimeout(() => {
          currentIndex = 0;
          setVisibleCount(0);
          setShowTyping(false);
          setTypingText("");
          if (streamRef.current) {
            streamRef.current.scrollTo({ top: 0 });
          }
          addTimeout(showNextMessage, 500);
        }, 3000);
        return;
      }

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

  const handleStartTimeChange = useCallback((date: Date) => {
    setStartTime(date);
    // Restart animation with new time range
    setAnimationKey((k) => k + 1);
  }, []);

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

  // Show the effective start date (filtered or earliest message)
  const effectiveStart = startTime.getTime() > 0
    ? startTime
    : messages.length > 0 ? new Date(messages[0].timestamp) : null;
  const subtitleText = effectiveStart
    ? `starting from ${effectiveStart.toISOString().slice(0, 16).replace("T", " ")}`
    : "no messages";

  return (
    <div className="conversations-page">
      {showConfig && (
        <div className="config-sidebar">
          <ConfigPanel
            startTime={startTime}
            onStartTimeChange={handleStartTimeChange}
            onRestart={handleRestart}
            domainStats={domainStats}
            totalMessages={allProcessed.length}
            visibleMessages={messages.length}
          />
        </div>
      )}

      <div className="conversations-title">internet conversations</div>
      <div className="conversations-subtitle">{subtitleText}</div>

      <div className="conversations-stream" ref={streamRef}>
        {fullyVisible.map((msg, i) => {
          const isBeingTyped = currentlyTyping?.id === msg.id;
          const displayText = isBeingTyped ? typingText : msg.text;
          const time = new Date(msg.timestamp);
          const timeStr = `${time.getHours().toString().padStart(2, "0")}:${time.getMinutes().toString().padStart(2, "0")}`;

          const prevDate = i > 0 ? new Date(fullyVisible[i - 1].timestamp) : null;
          const showDateDivider = !prevDate ||
            time.toDateString() !== prevDate.toDateString();

          // Rotation based on message id hash
          const rotation = seededRandom(hashString(msg.id), 0) * 0.6 - 0.3;

          return (
            <React.Fragment key={msg.id}>
              {showDateDivider && (
                <div className="date-divider">
                  {time.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })}
                </div>
              )}
              <div
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
            </React.Fragment>
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
