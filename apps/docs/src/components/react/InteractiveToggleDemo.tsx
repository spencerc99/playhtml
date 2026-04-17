import React from 'react';
import { CanPlayElement } from '@playhtml/react';
import { TagType } from '@playhtml/common';

// CRITICAL: the `id` prop passed to <CanPlayElement> is NOT automatically stamped
// onto the underlying DOM element — `cloneThroughFragments` only applies it when
// the child is a React Fragment. For a regular <button> child, the DOM id stays
// empty, and playhtml falls back to hashing `element.outerHTML` to generate one.
// That hash changes with className (is-on vs is-off), so two tabs end up with
// DIFFERENT element ids and never sync. Fix: put `id={id}` directly on the
// rendered DOM node so playhtml keys shared state on our stable id.
export function InteractiveToggleDemo({
  id = 'ph-docs-toggle-demo',
}: {
  id?: string;
}) {
  return (
    <CanPlayElement
      // @ts-ignore — tagInfo accepts TagType[] at runtime
      tagInfo={[TagType.CanToggle]}
      id={id}
      standalone
      defaultData={{ on: false }}
    >
      {({ data, setData }) => {
        const on = !!(data as any)?.on;
        return (
          <button
            id={id}
            type="button"
            className={`ph-toggle ${on ? 'is-on' : 'is-off'}`}
            aria-pressed={on}
            onClick={() => setData({ on: !on })}
          >
            <span className="ph-toggle__dot" aria-hidden="true" />
            <span className="ph-toggle__label">{on ? 'on' : 'off'}</span>
          </button>
        );
      }}
    </CanPlayElement>
  );
}
