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

const EXCLUDED_DOMAINS_KEY = "conversations-excluded-domains";
const SORT_MODE_KEY = "conversations-sort-mode";
const MAX_CONSECUTIVE_KEY = "conversations-max-consecutive";
const DEFAULT_MAX_CONSECUTIVE = 4;
const START_HOUR_KEY = "conversations-start-hour";
const SPEED_KEY = "conversations-speed";

type SortMode = "day" | "time";

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

/** Count messages per calendar date (YYYY-MM-DD). */
function getDateCounts(processed: ProcessedEvent[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const p of processed) {
    const date = new Date(p.event.ts).toISOString().slice(0, 10);
    counts.set(date, (counts.get(date) ?? 0) + 1);
  }
  return counts;
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

/** Extract time-of-day in ms from midnight for time-mode sorting. */
function timeOfDayMs(ts: number): number {
  const d = new Date(ts);
  return d.getHours() * 3600000 + d.getMinutes() * 60000 + d.getSeconds() * 1000 + d.getMilliseconds();
}

function buildMessages(
  processed: ProcessedEvent[],
  startTime: Date,
  excludedDomains: Set<string>,
  sortMode: SortMode,
  maxConsecutive: number,
  startHour: number,
): ConversationMessage[] {
  const startTs = startTime.getTime();
  let filtered = processed.filter((p) => {
    if (startTs > 0 && p.event.ts < startTs) return false;
    if (excludedDomains.has(p.domain)) return false;
    return true;
  });

  // In time mode, sort by time-of-day and filter by startHour
  if (sortMode === "time") {
    if (startHour > 0) {
      const startMs = startHour * 3600000;
      filtered = filtered.filter((p) => timeOfDayMs(p.event.ts) >= startMs);
    }
    filtered = [...filtered].sort((a, b) => timeOfDayMs(a.event.ts) - timeOfDayMs(b.event.ts));
  }

  // Apply max consecutive limit: skip messages that would exceed the cap
  if (maxConsecutive > 0) {
    const capped: ProcessedEvent[] = [];
    let runDomain = "";
    let runCount = 0;
    for (const p of filtered) {
      if (p.domain === runDomain) {
        runCount++;
        if (runCount > maxConsecutive) continue;
      } else {
        runDomain = p.domain;
        runCount = 1;
      }
      capped.push(p);
    }
    filtered = capped;
  }

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

    // Use time-of-day as timestamp in time mode for display
    const displayTs = sortMode === "time" ? timeOfDayMs(event.ts) : event.ts;

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
      timestamp: sortMode === "time" ? event.ts : event.ts,
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
  dateCounts: Map<string, number>;
  excludedDomains: Set<string>;
  onToggleDomain: (domain: string) => void;
  sortMode: SortMode;
  onSortModeChange: (mode: SortMode) => void;
  maxConsecutive: number;
  onMaxConsecutiveChange: (n: number) => void;
  startHour: number;
  onStartHourChange: (h: number) => void;
  speed: number;
  onSpeedChange: (s: number) => void;
  totalMessages: number;
  visibleMessages: number;
}

function ConfigPanel({
  startTime,
  onStartTimeChange,
  onRestart,
  domainStats,
  dateCounts,
  excludedDomains,
  onToggleDomain,
  sortMode,
  onSortModeChange,
  maxConsecutive,
  onMaxConsecutiveChange,
  startHour,
  onStartHourChange,
  speed,
  onSpeedChange,
  totalMessages,
  visibleMessages,
}: ConfigPanelProps) {
  const [domainSearch, setDomainSearch] = useState("");
  const maxCount = domainStats.length > 0 ? domainStats[0].count : 1;

  // Sort dates chronologically
  const sortedDates = Array.from(dateCounts.entries())
    .sort(([a], [b]) => a.localeCompare(b));

  // Current selected date (from startTime)
  const selectedDate = startTime.getTime() > 0
    ? startTime.toISOString().slice(0, 10)
    : "";

  return (
    <div className="config-panel">
      <div className="config-header">
        <span className="config-title">configuration</span>
        <span className="config-hint">press d twice to close</span>
      </div>

      <div className="config-section">
        <label className="config-label">start from date</label>
        <select
          className="config-select"
          value={selectedDate}
          onChange={(e) => {
            const val = e.target.value;
              if (val) {
                onStartTimeChange(new Date(val + "T00:00:00"));
              } else {
                onStartTimeChange(new Date(0));
              }
            }}
          >
            <option value="">all dates ({totalMessages})</option>
            {sortedDates.map(([date, count]) => (
              <option key={date} value={date}>
                {date} ({count})
              </option>
            ))}
          </select>
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
        <label className="config-label">
          speed: {speed}x
        </label>
        <input
          type="range"
          className="config-range"
          min={0.5}
          max={10}
          step={0.5}
          value={speed}
          onChange={(e) => onSpeedChange(parseFloat(e.target.value))}
        />
        <div className="config-range-labels">
          <span>0.5x</span>
          <span>5x</span>
          <span>10x</span>
        </div>
      </div>

      <div className="config-section">
        <label className="config-label">sort order</label>
        <div className="config-toggle-row">
          <button
            className={`config-toggle ${sortMode === "day" ? "active" : ""}`}
            onClick={() => onSortModeChange("day")}
          >
            by day
          </button>
          <button
            className={`config-toggle ${sortMode === "time" ? "active" : ""}`}
            onClick={() => onSortModeChange("time")}
          >
            by time of day
          </button>
        </div>
      </div>

      {sortMode === "time" && (
        <div className="config-section">
          <label className="config-label">
            start from: {String(Math.floor(startHour)).padStart(2, "0")}:{String(Math.round((startHour % 1) * 60)).padStart(2, "0")}
          </label>
          <input
            type="range"
            className="config-range"
            min={0}
            max={23.5}
            step={0.5}
            value={startHour}
            onChange={(e) => onStartHourChange(parseFloat(e.target.value))}
          />
          <div className="config-range-labels">
            <span>00:00</span>
            <span>06:00</span>
            <span>12:00</span>
            <span>18:00</span>
            <span>23:30</span>
          </div>
        </div>
      )}

      <div className="config-section">
        <label className="config-label">
          max consecutive per domain: {maxConsecutive === 0 ? "off" : maxConsecutive}
        </label>
        <input
          type="range"
          className="config-range"
          min={0}
          max={20}
          value={maxConsecutive}
          onChange={(e) => onMaxConsecutiveChange(parseInt(e.target.value, 10))}
        />
      </div>

      <div className="config-section">
        <label className="config-label">
          domains
          {excludedDomains.size > 0 && (
            <span className="config-excluded-count">
              {" "}({excludedDomains.size} hidden)
            </span>
          )}
        </label>
        <input
          type="text"
          className="config-search"
          placeholder="search domains..."
          value={domainSearch}
          onChange={(e) => setDomainSearch(e.target.value)}
        />
        <div className="config-histogram">
          {domainStats
            .filter((ds) => !domainSearch || ds.domain.includes(domainSearch.toLowerCase()))
            .map((ds) => {
              const excluded = excludedDomains.has(ds.domain);
              return (
                <div
                  key={ds.domain}
                  className={`histogram-row ${excluded ? "excluded" : ""}`}
                  onClick={() => onToggleDomain(ds.domain)}
                  title={excluded ? "click to include" : "click to exclude"}
                >
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
              );
            })}
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
  hasMore?: boolean;
  onNeedMore?: () => void;
}

export function ConversationView({
  events,
  loading,
  error,
  startTime: initialStartTime,
  hasMore = false,
  onNeedMore,
}: ConversationViewProps) {
  const [startTime, setStartTime] = useState<Date>(initialStartTime ?? DEFAULT_START);
  const [showConfig, setShowConfig] = useState(false);
  const [excludedDomains, setExcludedDomains] = useState<Set<string>>(() => {
    try {
      const stored = localStorage.getItem(EXCLUDED_DOMAINS_KEY);
      return stored ? new Set(JSON.parse(stored)) : new Set();
    } catch {
      return new Set();
    }
  });
  const [sortMode, setSortMode] = useState<SortMode>(() => {
    return (localStorage.getItem(SORT_MODE_KEY) as SortMode) || "day";
  });
  const [maxConsecutive, setMaxConsecutive] = useState(() => {
    const stored = localStorage.getItem(MAX_CONSECUTIVE_KEY);
    return stored !== null ? parseInt(stored, 10) : DEFAULT_MAX_CONSECUTIVE;
  });
  const [startHour, setStartHour] = useState(() => {
    const stored = localStorage.getItem(START_HOUR_KEY);
    return stored !== null ? parseFloat(stored) : 0;
  });
  const [speed, setSpeed] = useState(() => {
    const stored = localStorage.getItem(SPEED_KEY);
    return stored !== null ? parseFloat(stored) : 1;
  });

  const handleToggleDomain = useCallback((domain: string) => {
    setExcludedDomains((prev) => {
      const next = new Set(prev);
      if (next.has(domain)) {
        next.delete(domain);
      } else {
        next.add(domain);
      }
      localStorage.setItem(EXCLUDED_DOMAINS_KEY, JSON.stringify([...next]));
      return next;
    });
    animationIndexRef.current = 0;
    setVisibleCount(0);
    setAnimationKey((k) => k + 1);
  }, []);

  const handleSortModeChange = useCallback((mode: SortMode) => {
    setSortMode(mode);
    localStorage.setItem(SORT_MODE_KEY, mode);
    animationIndexRef.current = 0;
    setVisibleCount(0);
    setAnimationKey((k) => k + 1);
  }, []);

  const handleMaxConsecutiveChange = useCallback((n: number) => {
    setMaxConsecutive(n);
    localStorage.setItem(MAX_CONSECUTIVE_KEY, String(n));
    animationIndexRef.current = 0;
    setVisibleCount(0);
    setAnimationKey((k) => k + 1);
  }, []);

  const handleStartHourChange = useCallback((h: number) => {
    setStartHour(h);
    localStorage.setItem(START_HOUR_KEY, String(h));
    animationIndexRef.current = 0;
    setVisibleCount(0);
    setAnimationKey((k) => k + 1);
  }, []);

  const handleSpeedChange = useCallback((s: number) => {
    setSpeed(s);
    localStorage.setItem(SPEED_KEY, String(s));
  }, []);

  // Pre-process all events once (independent of start time)
  const allProcessed = useMemo(() => processEvents(events), [events]);
  const domainStats = useMemo(() => getDomainStats(allProcessed), [allProcessed]);
  const dateCounts = useMemo(() => getDateCounts(allProcessed), [allProcessed]);

  // Build messages filtered by start time, excluded domains, sort mode, max consecutive, start hour
  const messages = useMemo(
    () => buildMessages(allProcessed, startTime, excludedDomains, sortMode, maxConsecutive, startHour),
    [allProcessed, startTime, excludedDomains, sortMode, maxConsecutive, startHour],
  );

  const [visibleCount, setVisibleCount] = useState(0);
  const [showTyping, setShowTyping] = useState(false);
  const [typingText, setTypingText] = useState("");
  const [animationKey, setAnimationKey] = useState(0);
  const [waitingForMore, setWaitingForMore] = useState(false);
  const streamRef = useRef<HTMLDivElement>(null);
  const timeoutsRef = useRef<number[]>([]);
  const lastDPressRef = useRef<number>(0);
  const animationIndexRef = useRef(0);
  const speedRef = useRef(speed);
  speedRef.current = speed;

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

  // Scroll-lock: auto-scroll only when locked on
  const [scrollLocked, setScrollLocked] = useState(true);

  // Detect user scroll — lock on when near bottom, unlock when scrolling away
  useEffect(() => {
    function handleScroll() {
      const nearBottom =
        window.innerHeight + window.scrollY >= document.body.scrollHeight - 100;
      setScrollLocked(nearBottom);
    }
    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  // Auto-scroll when locked
  useEffect(() => {
    if (scrollLocked && streamRef.current) {
      const lastChild = streamRef.current.lastElementChild;
      if (lastChild) {
        lastChild.scrollIntoView({ behavior: "smooth", block: "end" });
      }
    }
  }, [visibleCount, showTyping, scrollLocked]);

  // Resume animation when new messages arrive (from pagination)
  useEffect(() => {
    if (waitingForMore && messages.length > animationIndexRef.current) {
      setWaitingForMore(false);
    }
  }, [messages.length, waitingForMore]);

  // Animation loop
  useEffect(() => {
    if (messages.length === 0) return;
    if (waitingForMore) return;
    clearTimeouts();

    let currentIndex = animationIndexRef.current;

    function showNextMessage() {
      if (currentIndex >= messages.length) {
        if (hasMore && onNeedMore) {
          // Request more data — pause animation until new messages arrive
          animationIndexRef.current = currentIndex;
          setWaitingForMore(true);
          onNeedMore();
        } else {
          // All data exhausted — loop after a pause
          addTimeout(() => {
            currentIndex = 0;
            animationIndexRef.current = 0;
            setVisibleCount(0);
            setShowTyping(false);
            setTypingText("");
            if (streamRef.current) {
              streamRef.current.scrollTo({ top: 0 });
            }
            addTimeout(showNextMessage, 500);
          }, 3000);
        }
        return;
      }

      const msg = messages[currentIndex];
      const s = speedRef.current;
      const typingDuration = Math.min(1500, Math.max(500, msg.text.length * 30)) / s;

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
            addTimeout(typeNextChar, 30 / speedRef.current);
          } else {
            // Phase 3: Done typing, pause then next message
            setTypingText("");
            const pause = (200 + Math.random() * 200) / speedRef.current;
            currentIndex++;
            animationIndexRef.current = currentIndex;
            addTimeout(showNextMessage, pause);
          }
        }

        typeNextChar();
      }, typingDuration);
    }

    // Start after a brief initial delay only on first run
    if (currentIndex === 0) {
      addTimeout(showNextMessage, 500 / speedRef.current);
    } else {
      showNextMessage();
    }

    return clearTimeouts;
  }, [messages, animationKey, waitingForMore, hasMore, onNeedMore, clearTimeouts, addTimeout]);

  const handleRestart = useCallback(() => {
    clearTimeouts();
    animationIndexRef.current = 0;
    setVisibleCount(0);
    setShowTyping(false);
    setTypingText("");
    setWaitingForMore(false);
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
            dateCounts={dateCounts}
            excludedDomains={excludedDomains}
            onToggleDomain={handleToggleDomain}
            sortMode={sortMode}
            onSortModeChange={handleSortModeChange}
            maxConsecutive={maxConsecutive}
            onMaxConsecutiveChange={handleMaxConsecutiveChange}
            startHour={startHour}
            onStartHourChange={handleStartHourChange}
            speed={speed}
            onSpeedChange={handleSpeedChange}
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
          const showDateDivider = sortMode === "day" && (!prevDate ||
            time.toDateString() !== prevDate.toDateString());

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

      {!scrollLocked && (
        <button
          className="conversations-follow"
          onClick={() => {
            setScrollLocked(true);
            window.scrollTo({ top: document.body.scrollHeight, behavior: "smooth" });
          }}
        >
          follow
        </button>
      )}
    </div>
  );
}
