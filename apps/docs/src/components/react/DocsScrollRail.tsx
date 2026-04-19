import React, { useEffect, useRef, useState } from 'react';
import { withSharedState } from '@playhtml/react';

type RailAwareness = { color: string; scroll: number };

type SectionTick = {
  key: string;
  relPos: number; // 0..1 vertical position in the document
  level: 2 | 3;
};

const FALLBACK_COLOR = '#8e897a';

function readCursorColor(): string {
  try {
    const c = (window as any).cursors?.color;
    if (typeof c === 'string' && c.length > 0) return c;
  } catch {}
  return FALLBACK_COLOR;
}

// Compute section heading positions as fractions of the document height.
// The rail uses these to draw ruler-style ticks: h2 = louder/longer,
// h3 = quieter/shorter. Positions need to be recomputed on resize and
// whenever the document height changes (font/image load, dynamic islands
// growing), otherwise ticks drift away from the actual headings.
function computeSectionTicks(): SectionTick[] {
  if (typeof document === 'undefined') return [];
  const headings = document.querySelectorAll<HTMLElement>(
    'main h2, main h3, article h2, article h3'
  );
  const docHeight = Math.max(1, document.documentElement.scrollHeight);
  const ticks: SectionTick[] = [];
  headings.forEach((h, idx) => {
    // offsetTop is relative to the offsetParent; rect-based approach
    // accounts for nested layouts where offsetTop alone underreports.
    const rect = h.getBoundingClientRect();
    const top = rect.top + window.scrollY + rect.height / 2;
    const rel = Math.min(1, Math.max(0, top / docHeight));
    ticks.push({
      key: `${h.id || h.tagName}-${idx}-${rel.toFixed(3)}`,
      relPos: rel,
      level: h.tagName === 'H2' ? 2 : 3,
    });
  });
  return ticks;
}

export const DocsScrollRail = withSharedState<{}, RailAwareness>(
  {
    defaultData: {},
    myDefaultAwareness: () => ({ color: readCursorColor(), scroll: 0 }),
  },
  ({ awareness, myAwareness, setMyAwareness }) => {
    const myAwarenessRef = useRef<RailAwareness | undefined>(myAwareness);
    useEffect(() => {
      myAwarenessRef.current = myAwareness;
    }, [myAwareness]);

    const [sections, setSections] = useState<SectionTick[]>([]);

    useEffect(() => {
      if (typeof window === 'undefined') return;
      let disposed = false;
      const syncColor = () => {
        if (disposed) return;
        const color = readCursorColor();
        const prev = myAwarenessRef.current;
        if (prev?.color === color) return;
        setMyAwareness({
          color,
          scroll: prev?.scroll ?? 0,
        });
      };

      const onColor = (_c: string) => syncColor();
      const tryAttach = () => {
        const cursors = (window as any).cursors;
        if (!cursors) return false;
        syncColor();
        cursors.on?.('color', onColor);
        return true;
      };
      let interval: number | null = null;
      if (!tryAttach()) {
        interval = window.setInterval(() => {
          if (tryAttach()) {
            if (interval !== null) window.clearInterval(interval);
            interval = null;
          }
        }, 250);
      }
      return () => {
        disposed = true;
        if (interval !== null) window.clearInterval(interval);
        try {
          (window as any).cursors?.off?.('color', onColor);
        } catch {}
      };
    }, [setMyAwareness]);

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
            color: prev?.color ?? readCursorColor(),
            scroll,
          });
          ticking = false;
        });
      };
      window.addEventListener('scroll', onScroll, { passive: true });
      return () => window.removeEventListener('scroll', onScroll);
    }, [setMyAwareness]);

    // Section-tick computation. Run on mount, on window resize, and on
    // body size changes (catches font/image reflow + dynamic islands).
    // Debounce the resize/observer path so we don't recompute on every
    // animation frame during smooth font swap-in.
    useEffect(() => {
      if (typeof window === 'undefined') return;
      let timer: number | null = null;
      const recompute = () => {
        setSections(computeSectionTicks());
      };
      const schedule = () => {
        if (timer !== null) window.clearTimeout(timer);
        timer = window.setTimeout(() => {
          timer = null;
          recompute();
        }, 120);
      };

      recompute();
      // Headings can shift well after first paint as fonts and images
      // load. A few delayed recomputes catch the common reflow moments
      // without needing to wire into every async asset event.
      const t1 = window.setTimeout(recompute, 350);
      const t2 = window.setTimeout(recompute, 1500);

      window.addEventListener('resize', schedule);
      let observer: ResizeObserver | null = null;
      try {
        observer = new ResizeObserver(schedule);
        observer.observe(document.body);
      } catch {
        // ResizeObserver isn't critical — older browsers fall back to
        // resize + the initial delayed recomputes.
      }

      return () => {
        if (timer !== null) window.clearTimeout(timer);
        window.clearTimeout(t1);
        window.clearTimeout(t2);
        window.removeEventListener('resize', schedule);
        observer?.disconnect();
      };
    }, []);

    const others = ((awareness ?? []) as RailAwareness[]).filter(
      (a) => a && a !== myAwareness
    );

    const myScroll = myAwareness?.scroll ?? 0;
    const myColor = myAwareness?.color ?? readCursorColor();

    return (
      <div id="ph-docs-scroll-rail-el" className="ph-rail" role="presentation">
        {/* Section-heading ticks: the rail's "ruler". Drawn first so the
            dots paint on top of any tick that happens to share a y. h2
            ticks are wider/louder; h3 ticks are shorter and quieter so
            you read structure as well as people. */}
        {sections.map((s) => (
          <span
            key={s.key}
            className={`ph-rail__tick ph-rail__tick--h${s.level}`}
            style={{ top: `${(s.relPos * 100).toFixed(2)}%` }}
            aria-hidden="true"
          />
        ))}
        {/* Other readers' positions. */}
        {others.map((a, i) => (
          <span
            key={`other-${i}`}
            className="ph-rail__dot"
            style={
              {
                top: `${Math.round((a?.scroll ?? 0) * 100)}%`,
                ['--ph-dot-color' as any]: a?.color ?? FALLBACK_COLOR,
                ['--ph-dot-delay' as any]: `${(i * 0.37) % 3}s`,
              } as React.CSSProperties
            }
          />
        ))}
        {/* Your own position — rendered last so it sits ON TOP of any
            other dot you happen to be sharing a scroll position with.
            Hollow ring + no breath = "this is you". Static treatment
            mirrors the self-dot in the header HUD: identity, not noise. */}
        <span
          className="ph-rail__dot ph-rail__dot--self"
          style={
            {
              top: `${Math.round(myScroll * 100)}%`,
              ['--ph-dot-color' as any]: myColor,
            } as React.CSSProperties
          }
          aria-hidden="true"
        />
      </div>
    );
  },
  { standalone: true, id: 'ph-docs-scroll-rail' } as any
);
