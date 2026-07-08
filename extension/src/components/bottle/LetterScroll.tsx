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
    target?.scrollIntoView({ block: "center", behavior: "instant" as ScrollBehavior });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function jumpTo(i: number) {
    scrollerRef.current
      ?.querySelector<HTMLElement>(`[data-seg="${i}"]`)
      ?.scrollIntoView({ block: "center", behavior: "smooth" });
  }

  return (
    <div className="mbs-scrollFrame">
      <div ref={scrollerRef} className="mbs-scroller">
        <div className="mbs-rollEnd" aria-hidden="true" />
        {notes.map((n, i) => (
          <div key={i} data-seg={i} className="mbs-segSlot">
            <LetterSegment note={n} />
          </div>
        ))}
        {canReply ? (
          <div data-seg="write" className="mbs-segSlot">
            <WriteSegment authorColor={authorColor} onStamped={onStamped} />
          </div>
        ) : (
          <div className="mbs-lastWord">
            you left the last word — someone else passes through next
          </div>
        )}
        <div className="mbs-rollEnd" aria-hidden="true" />
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
