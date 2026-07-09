// ABOUTME: The blank trailing segment of the scroll — a textarea sheet the writer
// ABOUTME: styles, signs (name + fingerprint), then commits with the date stamp.

import { useEffect, useState } from "react";
import browser from "webextension-polyfill";
import { SEGMENT_STYLES, segmentStyle } from "./segmentStyles";
import { Fingerprint } from "./LetterSegment";
import { DateStamp } from "./DateStamp";

const SIGNATURE_KEY = "bottle:signature:v1";

export interface StampedLetter {
  text: string;
  authorName?: string;
  styleId: string;
}

interface WriteSegmentProps {
  authorColor: string;
  /** True when no letters exist yet — the writer is starting the thread, so the
   * sheet greets them as a first letter rather than a reply. */
  isFirst?: boolean;
  onStamped: (letter: StampedLetter) => void;
}

export function WriteSegment({
  authorColor,
  isFirst = false,
  onStamped,
}: WriteSegmentProps) {
  const [text, setText] = useState("");
  const [name, setName] = useState("");
  const [styleId, setStyleId] = useState(SEGMENT_STYLES[0].id);
  const style = segmentStyle(styleId);

  useEffect(() => {
    let cancelled = false;
    browser.storage.local.get(SIGNATURE_KEY).then((res) => {
      if (cancelled) return;
      const saved = res[SIGNATURE_KEY];
      if (typeof saved === "string") setName(saved);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  function handleStamped() {
    const trimmedName = name.trim();
    void browser.storage.local.set({ [SIGNATURE_KEY]: trimmedName });
    onStamped({
      text: text.trim(),
      ...(trimmedName ? { authorName: trimmedName } : {}),
      styleId,
    });
  }

  return (
    <div
      className={`mbs-segment mbs-writeSegment ${style.className}${
        isFirst ? " mbs-writeFirst" : ""
      }`}
      style={{ color: style.ink }}
    >
      <div className="mbs-swatchRow">
        {SEGMENT_STYLES.map((s) => (
          <button
            key={s.id}
            type="button"
            className={`mbs-swatch swatch-${s.id}${s.id === styleId ? " selected" : ""}`}
            title={s.label}
            aria-label={`paper style: ${s.label}`}
            onClick={() => setStyleId(s.id)}
          />
        ))}
      </div>
      <textarea
        className="mbs-writeField"
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={
          isFirst
            ? "leave the first note for whoever finds this place next..."
            : "write something for the next person who finds this place..."
        }
        maxLength={500}
        style={{ color: style.ink }}
      />
      <div className="mbs-signoff" style={{ color: authorColor }}>
        <input
          className="mbs-signInput"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="sign your name (optional)"
          maxLength={40}
          style={{ color: authorColor }}
        />
        <Fingerprint color={authorColor} />
      </div>
      <DateStamp disabled={!text.trim()} onStamped={handleStamped} />
    </div>
  );
}
