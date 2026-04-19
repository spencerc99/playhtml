import React, { useEffect, useRef, useState } from 'react';
import { playhtml } from '@playhtml/react';
import type { CursorPresenceView } from '@playhtml/common';

// Header presence HUD + cursor-color picker.
//
// Reads from playhtml's CURSOR awareness (not a page-scoped `withSharedState`
// room) so:
//
// 1. The colored dot matches each reader's cursor color — there is exactly one
//    cursor color per user, globally. Previously this component generated a
//    second independent random hex color just for the header dot, which
//    looked like a second identity and didn't match the on-page cursor.
// 2. The count scales to the whole docs site ("12 people reading the docs")
//    instead of a single URL, because `cursors.room = 'domain'` puts all docs
//    pages in a single cursor room.
//
// The self-dot is also a COLOR PICKER. Clicking it opens the browser's
// native color input directly (no custom popover). The new color is only
// committed when the user dismisses the picker — the DOM `change` event
// on `<input type="color">` fires exactly once on close, so we get
// "preview while dragging, save on close" for free without any state
// machinery. An earlier iteration committed on every `input` event, which
// closed the surrounding popover and dismissed the native picker
// prematurely.
//
// Self filtering: `getCursorPresences()` returns ALL awareness states
// including this client's own. We filter by `playerIdentity.publicKey`
// (matched against `getMyPlayerIdentity()`) so the self-dot — already
// rendered as the picker button — isn't double-rendered as one of the
// "other readers" in the dot row.

function readCursorColor(): string | null {
  try {
    const c = (window as any).cursors?.color;
    if (typeof c === 'string' && c.length > 0) return c;
  } catch {}
  return null;
}

function setCursorColor(hex: string): void {
  try {
    (window as any).cursors.color = hex;
  } catch (err) {
    console.warn('[docs] Failed to update cursor color', err);
  }
}

export function DocsPresenceBar() {
  const [presences, setPresences] = useState<Map<string, CursorPresenceView>>(
    () => new Map(),
  );
  const [myColor, setMyColor] = useState<string | null>(null);
  // Stable identity key for filtering self out of the presences list.
  // Pulled once from `getMyPlayerIdentity()` after wiring up the cursor
  // client; doesn't change for the lifetime of this tab.
  const [myPublicKey, setMyPublicKey] = useState<string | null>(null);

  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const colorInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    let unsub: (() => void) | null = null;
    let unsubColor: (() => void) | null = null;

    const wire = () => {
      const client = playhtml.cursorClient;
      if (!client) return false;
      const identity = client.getMyPlayerIdentity();
      setMyColor(identity?.playerStyle?.colorPalette?.[0] ?? null);
      setMyPublicKey(identity?.publicKey ?? null);
      setPresences(client.getCursorPresences());
      unsub = client.onCursorPresencesChange((next) => {
        if (cancelled) return;
        setPresences(new Map(next));
      });
      // Subscribe to the global "color" event so the dot updates the
      // instant the reader picks a new color, without waiting for cursor
      // awareness to round-trip back through the network.
      const cursors = (window as any).cursors;
      const onColor = (c: string) => {
        if (cancelled) return;
        setMyColor(c);
      };
      cursors?.on?.('color', onColor);
      unsubColor = () => {
        try {
          cursors?.off?.('color', onColor);
        } catch {}
      };
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
        unsubColor?.();
      };
    }

    return () => {
      cancelled = true;
      unsub?.();
      unsubColor?.();
    };
  }, []);

  // Native DOM `change` listener on the hidden color input. We use the
  // raw DOM event (not React's `onChange`, which maps to the `input`
  // event for inputs) because `change` fires exactly once when the user
  // dismisses the native picker — that's the "save on close" semantic
  // we want. Using the React onChange path would commit on every drag
  // step and constantly close the picker.
  useEffect(() => {
    const input = colorInputRef.current;
    if (!input) return;
    const onChange = () => {
      const value = input.value;
      if (value && value !== myColor) {
        setMyColor(value); // optimistic; the cursors "color" event will confirm
        setCursorColor(value);
      }
    };
    input.addEventListener('change', onChange);
    return () => input.removeEventListener('change', onChange);
  }, [myColor]);

  // Filter out self from the visible "other readers" dot list. The
  // self-dot is already represented as the picker button; including it
  // again here would render two dots changing color in lockstep when
  // the user picks a new hue.
  const others: CursorPresenceView[] = [];
  presences.forEach((p) => {
    if (myPublicKey && p.playerIdentity?.publicKey === myPublicKey) return;
    others.push(p);
  });

  const otherColors = others
    .map((p) => p.playerIdentity?.playerStyle?.colorPalette?.[0])
    .filter((c): c is string => Boolean(c));

  const selfColor = myColor ?? undefined;
  const total = otherColors.length + (selfColor ? 1 : 0);

  if (!selfColor) return null;

  const otherDotColors = otherColors.slice(0, 5);

  // Open the native color picker. Programmatically clicking a hidden
  // <input type="color"> is the standard cross-browser way to surface
  // the OS picker without the input itself taking up visible space in
  // the layout.
  const openPicker = () => {
    colorInputRef.current?.click();
  };

  return (
    <div
      id="ph-docs-presence-hud"
      className="ph-presence"
      data-count={total}
      aria-label={`${total} ${total === 1 ? 'reader' : 'readers'} online`}
    >
      <span className="ph-presence__count">{total}</span>
      <div className="ph-presence__dots" role="presentation">
        <button
          type="button"
          ref={buttonRef}
          className="ph-presence__dot ph-presence__dot--btn is-self"
          // `--ph-dot-color` drives the fill, border tint, and glow halo
          // so a single source-of-truth value feeds all three layers.
          style={{ ['--ph-dot-color' as any]: selfColor } as React.CSSProperties}
          aria-label="Change your cursor color"
          onClick={openPicker}
        />
        {otherDotColors.map((color, i) => (
          <span
            key={i}
            className="ph-presence__dot"
            style={
              {
                ['--ph-dot-color' as any]: color,
                // Stagger breath phase across the row so dots pulse out
                // of sync with each other.
                ['--ph-dot-delay' as any]: `${((i + 1) * 0.41) % 3}s`,
              } as React.CSSProperties
            }
            aria-hidden="true"
          />
        ))}
      </div>
      {/*
        Hidden native color input. Visually offscreen but kept in the
        accessibility tree as the picker mechanism — when the user
        activates the dot button we forward the click here, and the OS
        picker opens anchored to the button's position. The value prop
        seeds the picker with the current color but isn't used as a
        controlled-input source of truth (we read input.value in the
        DOM `change` listener).
      */}
      <input
        ref={colorInputRef}
        type="color"
        className="ph-presence__color-input"
        defaultValue={selfColor.startsWith('#') ? selfColor : '#888888'}
        tabIndex={-1}
        aria-hidden="true"
      />
    </div>
  );
}
