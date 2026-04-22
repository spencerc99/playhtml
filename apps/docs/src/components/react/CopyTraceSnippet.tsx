import React, { useState } from 'react';
import { CanPlayElement } from '@playhtml/react';
import { TagType } from '@playhtml/common';

type Props = {
  id: string;
  language?: string;
  code: string;
  label?: string;
};

// DEPRECATED for markdown fenced blocks.
// As of the copy-block unification pass, every ``` fence in the docs is
// rendered with Shiki and enhanced client-side by
// `src/scripts/enhance-code-blocks.ts`, which wraps each `<pre>` in the same
// `.ph-copy` chrome you see here. This React component is kept in the tree
// for a future Phase 2 — adding a per-snippet shared `wear` counter via
// playhtml's vanilla API — but isn't imported by any page today.
//
// Copy-trace snippet: clicking "copy" writes to the clipboard AND bumps a
// shared wear counter, so the snippet visually accrues tally marks over time
// — the "well-loved library book" metaphor. No per-snippet color picker;
// cursor color is a single global concern, not something we expose here.
//
// Uses CanPlayElement directly (not withSharedState) so we can pass a dynamic
// per-snippet id through props — withSharedState only accepts a fixed id via
// its options object.
export function CopyTraceSnippet({ id, language, code, label }: Props) {
  return (
    <CanPlayElement<{ wear: number }, never>
      // @ts-ignore — tagInfo accepts TagType[] at runtime
      tagInfo={[TagType.CanPlay]}
      id={`ph-copy-${id}`}
      standalone
      defaultData={{ wear: 0 }}
    >
      {({ data, setData }) => {
        const wear = (data as { wear?: number } | undefined)?.wear ?? 0;
        const [pulse, setPulse] = useState(false);

        const onCopy = async () => {
          try {
            if (typeof navigator !== 'undefined' && navigator.clipboard) {
              await navigator.clipboard.writeText(code);
            }
          } catch {
            // Clipboard may be unavailable in some contexts; still record the
            // copy intent so the wear counter reflects reader interest.
          }
          setData({ wear: wear + 1 });
          setPulse(true);
          window.setTimeout(() => setPulse(false), 450);
        };

        return (
          // id is required on the DOM node, not just on CanPlayElement — see
          // comment in InteractiveToggleDemo.tsx. Without it, playhtml hashes
          // outerHTML (which includes the tally marks) and the shared wear
          // counter ends up under a different key on every render.
          <div
            id={`ph-copy-${id}`}
            className="ph-copy"
            data-wear={wear}
            data-pulse={pulse ? '1' : '0'}
          >
            <div className="ph-copy__frame">
              <pre>
                <code className={`language-${language ?? 'html'}`}>{code}</code>
              </pre>
            </div>
            <span
              className="ph-copy__tally"
              aria-label={`copied ${wear} times`}
            >
              {Array.from({ length: wear }, (_, i) => (
                <span key={i} className="ph-copy__tick" />
              ))}
            </span>
            <div className="ph-copy__meta">
              <button
                type="button"
                className="ph-copy__btn"
                onClick={onCopy}
                aria-label={label ? `copy ${label}` : 'copy code'}
              >
                copy
              </button>
            </div>
          </div>
        );
      }}
    </CanPlayElement>
  );
}
