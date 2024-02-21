import React from "react";
import { CanPlayElement } from "../src";

export function pluralize(word: string, count: number) {
  return count > 1 ? `${word}s` : word;
}
export function LiveVisitorCount() {
  return (
    <CanPlayElement
      defaultData={{}}
      myDefaultAwareness={true}
      id="visitorCount"
    >
      {({ awareness }) => {
        return (
          <div className="visitorCount">
            {awareness.length} {pluralize("visitor", awareness.length)}
          </div>
        );
      }}
    </CanPlayElement>
  );
}
