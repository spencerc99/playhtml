import React, { useContext, useEffect, useMemo, useRef, useState } from "react";
import { PlayContext } from "@playhtml/react";
import { playhtml } from "playhtml";

/** Wire event name if you mount multiple instances on one page. */
export const DEFAULT_LIVE_REACTION_EVENT = "playhtml-live-reaction";

type Burst = { id: string; emoji: string; at: number };

export interface LiveReactionsProps {
  /** Default / initial emoji when `emojiOptions` is not set. */
  emoji?: string;
  /** How long each burst stays visible (fade animation window). */
  windowMs?: number;
  /** Pass a unique string per mount if several pickers share one page. */
  eventType?: string;
  /** When set, shows a row of emoji buttons; otherwise a single "React {emoji}" control. */
  emojiOptions?: string[];
  className?: string;
}

/**
 * Fire-and-forget emoji bursts for everyone connected **right now**.
 * Implemented with `dispatchPlayEvent` / `registerPlayEventListener` — not
 * element data — so late joiners do not see past reactions.
 */
export function LiveReactions({
  emoji = "💖",
  windowMs = 5000,
  eventType = DEFAULT_LIVE_REACTION_EVENT,
  emojiOptions,
  className,
}: LiveReactionsProps) {
  const ctx = useContext(PlayContext);
  // Fall back to the `playhtml` singleton when no <PlayProvider> is in the
  // tree. The context default throws from every method, which would unmount
  // the whole island once the subscription useEffect ran (this used to
  // manifest as the button "flashing on screen then disappearing" on any
  // page that called `playhtml.init()` directly instead of wrapping React
  // islands in a provider — e.g. the docs site).
  const eventHub = useMemo(
    () => (ctx.isProviderMissing ? playhtml : ctx),
    [ctx],
  );
  const [selected, setSelected] = useState(emoji);
  const [bursts, setBursts] = useState<Burst[]>([]);
  const [now, setNow] = useState(() => Date.now());
  const rafRef = useRef<number | null>(null);
  const burstTimeoutsRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(
    new Map(),
  );

  useEffect(() => {
    setSelected(emoji);
  }, [emoji]);

  useEffect(() => {
    const tick = () => {
      setNow(Date.now());
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    };
  }, []);

  useEffect(() => {
    const id = eventHub.registerPlayEventListener(eventType, {
      onEvent: (payload: unknown) => {
        const em =
          typeof payload === "object" &&
          payload !== null &&
          "emoji" in payload &&
          typeof (payload as { emoji: unknown }).emoji === "string"
            ? (payload as { emoji: string }).emoji
            : undefined;
        if (!em) return;
        const burst: Burst = {
          id: Math.random().toString(36).slice(2, 9),
          emoji: em,
          at: Date.now(),
        };
        setBursts((prev) => [...prev, burst]);
        const t = setTimeout(() => {
          burstTimeoutsRef.current.delete(burst.id);
          setBursts((prev) => prev.filter((b) => b.id !== burst.id));
        }, windowMs);
        burstTimeoutsRef.current.set(burst.id, t);
      },
    });
    return () => {
      eventHub.removePlayEventListener(eventType, id);
      burstTimeoutsRef.current.forEach((timeout) => clearTimeout(timeout));
      burstTimeoutsRef.current.clear();
    };
  }, [eventHub, eventType, windowMs]);

  const fire = () => {
    eventHub.dispatchPlayEvent({
      type: eventType,
      data: { emoji: selected },
    });
  };

  const stage = (
    <div
      style={{
        position: "absolute",
        inset: 0,
        overflow: "hidden",
        pointerEvents: "none",
      }}
    >
      {bursts.map((b) => {
        const t = Math.min(1, (now - b.at) / windowMs);
        const y = 140 - t * 140;
        const scale = 0.8 + 0.4 * (1 - t);
        const opacity = 1 - t;
        const left = 20 + (b.id.charCodeAt(0) % 180);
        return (
          <div
            key={b.id}
            style={{
              position: "absolute",
              left,
              top: y,
              transform: `scale(${scale})`,
              opacity,
            }}
          >
            {b.emoji}
          </div>
        );
      })}
    </div>
  );

  if (emojiOptions && emojiOptions.length > 0) {
    return (
      <div
        className={className}
        style={{ position: "relative", width: 280, minHeight: 180 }}
      >
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: 6,
            marginBottom: 8,
          }}
          role="radiogroup"
          aria-label="Pick reaction emoji"
        >
          {emojiOptions.map((e) => (
            <button
              key={e}
              type="button"
              role="radio"
              aria-checked={selected === e}
              onClick={() => setSelected(e)}
              style={{
                border:
                  selected === e
                    ? "2px solid #333"
                    : "1px solid #ccc",
                borderRadius: 6,
                background: selected === e ? "#f0f0f0" : "#fff",
                cursor: "pointer",
                fontSize: "1.2rem",
                lineHeight: 1,
                padding: "4px 8px",
              }}
            >
              {e}
            </button>
          ))}
        </div>
        <button type="button" onClick={fire}>
          React {selected}
        </button>
        {stage}
      </div>
    );
  }

  return (
    <div
      className={className}
      id="live-reactions"
      style={{ position: "relative", width: 240, height: 160 }}
    >
      <button type="button" onClick={fire}>
        React {emoji}
      </button>
      {stage}
    </div>
  );
}
