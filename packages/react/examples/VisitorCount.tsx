import React from "react";
import { CanPlayElement } from "../src";
import { formatSimpleNumber, pluralize } from "./utils";

export function LiveVisitorCount() {
  return (
    <CanPlayElement
      defaultData={{}}
      myDefaultAwareness={true}
      id="visitorCount"
    >
      {({ awareness }) => {
        const count = awareness.length;
        return (
          <div className="visitorCount">
            {formatSimpleNumber(count)} {pluralize("visitor", count)}
          </div>
        );
      }}
    </CanPlayElement>
  );
}
