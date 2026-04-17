import React, { useEffect, useRef } from 'react';
import { withSharedState } from '@playhtml/react';

type RailAwareness = { color: string; scroll: number };

function randomHexColor(): string {
  const n = Math.floor(Math.random() * 0xffffff);
  return '#' + n.toString(16).padStart(6, '0');
}

export const DocsScrollRail = withSharedState<{}, RailAwareness>(
  {
    defaultData: {},
    myDefaultAwareness: () => ({ color: randomHexColor(), scroll: 0 }),
  },
  ({ awareness, myAwareness, setMyAwareness }) => {
    // Keep the latest awareness in a ref so the rAF-throttled scroll handler
    // can read it without re-subscribing on every awareness change.
    const myAwarenessRef = useRef<RailAwareness | undefined>(myAwareness);
    useEffect(() => {
      myAwarenessRef.current = myAwareness;
    }, [myAwareness]);

    useEffect(() => {
      if (typeof window === 'undefined') return;
      let ticking = false;
      const onScroll = () => {
        if (ticking) return;
        ticking = true;
        window.requestAnimationFrame(() => {
          const max =
            document.documentElement.scrollHeight - window.innerHeight;
          const raw = max > 0 ? window.scrollY / max : 0;
          const scroll = Math.min(1, Math.max(0, raw));
          const prev = myAwarenessRef.current;
          setMyAwareness({
            color: prev?.color ?? randomHexColor(),
            scroll,
          });
          ticking = false;
        });
      };
      window.addEventListener('scroll', onScroll, { passive: true });
      return () => window.removeEventListener('scroll', onScroll);
    }, [setMyAwareness]);

    const others = ((awareness ?? []) as RailAwareness[]).filter(
      (a) => a && a !== myAwareness
    );

    return (
      // Stable id so playhtml keys scroll awareness under a known element,
      // not a hashed snapshot of the dots' current positions.
      <div id="ph-docs-scroll-rail-el" className="ph-rail" role="presentation">
        {others.map((a, i) => (
          <span
            key={i}
            className="ph-rail__dot"
            style={{
              top: `${Math.round((a?.scroll ?? 0) * 100)}%`,
              backgroundColor: a?.color ?? '#999',
            }}
          />
        ))}
      </div>
    );
  },
  { standalone: true, id: 'ph-docs-scroll-rail' } as any
);
