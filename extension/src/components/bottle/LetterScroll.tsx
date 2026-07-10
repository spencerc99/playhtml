// ABOUTME: The unrolled letter scroll — snap-scrolls one segment at a time, lands
// ABOUTME: on the latest letter, tick rail jumps, blank writer segment at the end.

import { useEffect, useRef } from "react";
import type { BottleNote } from "../../features/BottleManager";
import { segmentStyle } from "./segmentStyles";
import { LetterSegment } from "./LetterSegment";
import { WriteSegment, type StampedLetter } from "./WriteSegment";

interface LetterScrollProps {
  notes: BottleNote[];
  canReply: boolean;
  authorColor: string;
  onStamped: (letter: StampedLetter) => void;
  onClose: () => void;
}

export function LetterScroll({
  notes,
  canReply,
  authorColor,
  onStamped,
  onClose,
}: LetterScrollProps) {
  const scrollerRef = useRef<HTMLDivElement>(null);

  // Land on the latest letter (the roll's outermost wrap). An empty bottle
  // lands straight on the blank writing segment.
  useEffect(() => {
    const scroller = scrollerRef.current;
    if (!scroller) return;
    const target = scroller.querySelector<HTMLElement>(
      notes.length > 0 ? `[data-seg="${notes.length - 1}"]` : '[data-seg="write"]',
    );
    // Mark the landing segment current immediately so its salutation is
    // visible on the very first paint, before the observer has a chance to run.
    target?.classList.add("mbs-segCurrent");
    target?.scrollIntoView({ block: "center", behavior: "instant" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Track which segment is centered in the viewport and mark it current, so
  // only the letter being read shows its salutation — neighboring segments
  // peeking at the top/bottom stay teasers of the letter text.
  useEffect(() => {
    const scroller = scrollerRef.current;
    if (!scroller) return;
    const slots = scroller.querySelectorAll<HTMLElement>(".mbs-segSlot");
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          entry.target.classList.toggle("mbs-segCurrent", entry.isIntersecting);
        }
      },
      { root: scroller, threshold: 0.6 },
    );
    slots.forEach((slot) => observer.observe(slot));
    return () => observer.disconnect();
  }, [notes, canReply]);

  function jumpTo(i: number) {
    scrollerRef.current
      ?.querySelector<HTMLElement>(`[data-seg="${i}"]`)
      ?.scrollIntoView({ block: "center", behavior: "smooth" });
  }

  return (
    <div className="mbs-scrollFrame">
      <div ref={scrollerRef} className="mbs-scroller">
        <div className="mbs-strip">
          {notes.map((n, i) => (
            <div key={i} data-seg={i} className="mbs-segSlot">
              <LetterSegment note={n} />
            </div>
          ))}
          {canReply ? (
            <div data-seg="write" className="mbs-segSlot">
              <WriteSegment
                authorColor={authorColor}
                isFirst={notes.length === 0}
                onStamped={onStamped}
              />
            </div>
          ) : (
            <div className="mbs-segSlot mbs-lastWordSlot">
              <div className="mbs-lastWord">
                you&rsquo;ve signed this book — your letter rests here for the
                next visitor to find
              </div>
            </div>
          )}
        </div>
      </div>

      {notes.length > 1 && (
        <div className="mbs-tickRail" aria-hidden="true">
          {notes.map((n, i) => (
            <button
              key={i}
              type="button"
              className="mbs-tick"
              style={{ background: segmentStyle(n.styleId).ink, borderColor: n.authorColor }}
              title={`letter ${i + 1} of ${notes.length}`}
              onClick={() => jumpTo(i)}
            />
          ))}
        </div>
      )}

      <button type="button" className="mbs-leave" onClick={onClose}>
        seal &amp; leave
      </button>
    </div>
  );
}
