import React, { useCallback, useEffect, useRef, useState } from "react";
import { playhtml } from "playhtml";
import type { PlayerIdentity } from "@playhtml/common";

function primaryColor(identity?: PlayerIdentity): string {
  return identity?.playerStyle?.colorPalette?.[0] ?? "#6a6a66";
}

function inRect(x: number, y: number, rect: DOMRect): boolean {
  return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
}

/**
 * Gradient pad: colors of every multiplayer cursor over the pad, plus yours
 * while your pointer is inside. Requires `playhtml.init({ cursors: … })`.
 */
export function HoverCursorColorsDemo(): React.ReactElement {
  const padRef = useRef<HTMLDivElement>(null);
  const [gradient, setGradient] = useState(
    "linear-gradient(135deg, var(--ph-paper-warm), var(--ph-paper-deep))",
  );
  const hovering = useRef(false);

  const recompute = useCallback(() => {
    const pad = padRef.current;
    const client = playhtml.cursorClient;
    if (!pad || !client) return;

    const rect = pad.getBoundingClientRect();
    const colors: string[] = [];
    const seen = new Set<string>();
    const myPk = client.getMyPlayerIdentity().publicKey;

    const add = (c: string) => {
      if (seen.has(c)) return;
      seen.add(c);
      colors.push(c);
    };

    client.getCursorPresences().forEach((p, stableId) => {
      if (stableId === myPk) return;
      const cur = p.cursor;
      if (!cur) return;
      if (inRect(cur.x, cur.y, rect)) {
        add(primaryColor(p.playerIdentity));
      }
    });

    const w = window as unknown as { cursors?: { color?: string } };
    if (hovering.current && w.cursors?.color) {
      add(w.cursors.color);
    }

    if (colors.length === 0) {
      setGradient(
        "linear-gradient(135deg, var(--ph-paper-warm), var(--ph-paper-deep))",
      );
      return;
    }
    if (colors.length === 1) {
      setGradient(
        `linear-gradient(135deg, ${colors[0]}, color-mix(in srgb, ${colors[0]} 55%, var(--ph-paper)))`,
      );
      return;
    }
    const stops = colors
      .map((c, i) => `${c} ${(i / (colors.length - 1)) * 100}%`)
      .join(", ");
    setGradient(`linear-gradient(135deg, ${stops})`);
  }, []);

  useEffect(() => {
    const client = playhtml.cursorClient;
    const unsub = client?.onCursorPresencesChange(() => {
      recompute();
    });
    const onMove = () => recompute();
    window.addEventListener("mousemove", onMove, { passive: true });
    const id = window.setInterval(recompute, 150);
    recompute();
    return () => {
      unsub?.();
      window.removeEventListener("mousemove", onMove);
      window.clearInterval(id);
    };
  }, [recompute]);

  return (
    <div
      ref={padRef}
      className="ph-hover-cursor-pad"
      style={{ background: gradient }}
      onMouseEnter={() => {
        hovering.current = true;
        recompute();
      }}
      onMouseLeave={() => {
        hovering.current = false;
        recompute();
      }}
    >
      <p className="ph-hover-cursor-pad__label">
        Hover here with a friend — the pad picks up everyone&apos;s cursor colors.
      </p>
    </div>
  );
}
