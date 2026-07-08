// ABOUTME: The blank trailing segment of the scroll — a textarea sheet the writer
// ABOUTME: styles, signs (name + fingerprint), then commits with the date stamp.

import { useEffect, useRef, useState } from "react";
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
  onStamped: (letter: StampedLetter) => void;
}

export function WriteSegment({ authorColor, onStamped }: WriteSegmentProps) {
  const [text, setText] = useState("");
  const [name, setName] = useState("");
  const [styleId, setStyleId] = useState(SEGMENT_STYLES[0].id);
  const textRef = useRef<HTMLTextAreaElement>(null);
  const style = segmentStyle(styleId);

  useEffect(() => {
    browser.storage.local.get(SIGNATURE_KEY).then((res) => {
      const saved = res[SIGNATURE_KEY];
      if (typeof saved === "string") setName(saved);
    });
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
    <div className={`mbs-segment mbs-writeSegment ${style.className}`} style={{ color: style.ink }}>
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
        ref={textRef}
        className="mbs-writeField"
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="write something for the next person who finds this place..."
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
