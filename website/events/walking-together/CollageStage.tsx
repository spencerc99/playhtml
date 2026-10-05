// ABOUTME: The collage stage of a walking-together session, shown after the walk.
// ABOUTME: Everyone places their collected scraps onto one shared collage.
import React from "react";

/** Shared collage built from everyone's scraps. The room switches here when
 * the admin moves the session from the walk stage to the collage stage. */
export function CollageStage() {
  return (
    <div className="collage-stage">
      <h3>collage together</h3>
      <p>Place the scraps you collected on the walk.</p>
    </div>
  );
}
