// ABOUTME: Verifies quarantine-tape rip tracking does not take over ordinary host-page drags.
// ABOUTME: Keeps native drag suppression limited to explicitly armed tape placement.

import { afterEach, describe, expect, it } from "vitest";
import { QuarantineTapeManager } from "../features/social/quarantine-tape/QuarantineTapeManager";

function getHandler<T extends Event>(
  manager: QuarantineTapeManager,
  name: "onMouseDown" | "onDragStart",
): (event: T) => void {
  return Reflect.get(manager, name) as (event: T) => void;
}

describe("quarantine tape page interactions", () => {
  afterEach(() => {
    document.body.style.userSelect = "";
  });

  it("tracks an unarmed rip without disabling normal selection or native dragging", () => {
    const manager = new QuarantineTapeManager("player");
    document.body.style.userSelect = "text";

    getHandler<MouseEvent>(manager, "onMouseDown")(
      new MouseEvent("mousedown", { clientX: 10, clientY: 20 }),
    );
    const drag = new Event("dragstart", { cancelable: true }) as DragEvent;
    getHandler<DragEvent>(manager, "onDragStart")(drag);

    expect(document.body.style.userSelect).toBe("text");
    expect(drag.defaultPrevented).toBe(false);
  });

  it("still prevents native dragging while tape placement is armed", () => {
    const manager = new QuarantineTapeManager("player");
    Reflect.set(manager, "equipped", "slop");
    const drag = new Event("dragstart", { cancelable: true }) as DragEvent;

    getHandler<DragEvent>(manager, "onDragStart")(drag);

    expect(drag.defaultPrevented).toBe(true);
  });
});
