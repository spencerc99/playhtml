import React, { useEffect, useState } from 'react';
import { playhtml } from '@playhtml/react';
import type { CursorPresenceView } from '@playhtml/common';

// Header presence HUD.
//
// Reads from playhtml's CURSOR awareness (not a page-scoped `withSharedState`
// room) so:
//
// 1. The colored dot matches each reader's cursor color — there is exactly one
//    cursor color per user, globally. Previously this component generated a
//    second independent random hex color just for the header dot, which looked
//    like a second identity and didn't match the on-page cursor.
// 2. The count scales to the whole docs site ("12 people reading the docs")
//    instead of a single URL, because `cursors.room = 'domain'` puts all docs
//    pages in a single cursor room. Domain-wide presence is what the user
//    expects the header to represent.
//
// There's no PlayProvider in this tree (Astro islands hydrate independently),
// so we consume the cursor client imperatively via the playhtml singleton.
export function DocsPresenceBar() {
  const [presences, setPresences] = useState<Map<string, CursorPresenceView>>(
    () => new Map(),
  );
  const [myColor, setMyColor] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let unsub: (() => void) | null = null;

    // cursorClient is created lazily inside playhtml.init(). Poll briefly
    // until it's ready, then wire up the subscription. This avoids a race
    // where the island hydrates before init() finishes attaching cursors.
    const wire = () => {
      const client = playhtml.cursorClient;
      if (!client) return false;
      const identity = client.getMyPlayerIdentity();
      setMyColor(identity?.playerStyle?.colorPalette?.[0] ?? null);
      setPresences(client.getCursorPresences());
      unsub = client.onCursorPresencesChange((next) => {
        if (cancelled) return;
        setPresences(new Map(next));
      });
      return true;
    };

    if (!wire()) {
      const interval = window.setInterval(() => {
        if (wire()) window.clearInterval(interval);
      }, 250);
      return () => {
        cancelled = true;
        window.clearInterval(interval);
        unsub?.();
      };
    }

    return () => {
      cancelled = true;
      unsub?.();
    };
  }, []);

  // Include self in the count/color list — seeing your own dot confirms "the
  // system is working and I'm connected". Exclude self if you'd rather emphasize
  // "others reading", but for a docs HUD the feedback is more valuable.
  const others = Array.from(presences.values());
  const otherColors = others
    .map((p) => p.playerIdentity?.playerStyle?.colorPalette?.[0])
    .filter((c): c is string => Boolean(c));

  const selfColor = myColor ?? undefined;
  const total = otherColors.length + (selfColor ? 1 : 0);

  // Hide the HUD until cursors are connected (no self color yet). Once we're
  // connected but alone, show `1 ·` so the user knows the connection is live.
  if (!selfColor) return null;

  const dotColors = [selfColor, ...otherColors].slice(0, 6);

  return (
    <div
      id="ph-docs-presence-hud"
      className="ph-presence"
      data-count={total}
      aria-label={`${total} ${total === 1 ? 'reader' : 'readers'} online`}
    >
      <span className="ph-presence__count">{total}</span>
      <ul className="ph-presence__dots" aria-hidden="true">
        {dotColors.map((color, i) => (
          <li
            key={i}
            className={`ph-presence__dot${i === 0 ? ' is-self' : ''}`}
            style={{ backgroundColor: color }}
          />
        ))}
      </ul>
    </div>
  );
}
