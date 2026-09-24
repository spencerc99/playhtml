// ABOUTME: Verifies quarantine-tape rip tracking does not take over ordinary host-page drags.
// ABOUTME: Keeps native drag suppression limited to explicitly armed tape placement.

import { afterEach, describe, expect, it } from "vitest";
import { QuarantineTapeManager } from "../features/social/quarantine-tape/QuarantineTapeManager";

function getHandler<T extends Event>(
  manager: QuarantineTapeManager,
  name: "onMouseDown" | "onMouseUp" | "onDragStart",
): (event: T) => void {
  return Reflect.get(manager, name) as (event: T) => void;
}

describe("quarantine tape page interactions", () => {
  afterEach(() => {
    document.body.style.userSelect = "";
  });

  it("tracks an unarmed rip without disabling normal selection or native dragging", () => {
    const manager = new QuarantineTapeManager("player");
    const image = document.createElement("img");
    document.body.style.userSelect = "text";

    getHandler<MouseEvent>(manager, "onMouseDown")(
      new MouseEvent("mousedown", { clientX: 10, clientY: 20 }),
    );
    const drag = new Event("dragstart", { cancelable: true }) as DragEvent;
    image.addEventListener("dragstart", getHandler<DragEvent>(manager, "onDragStart"));
    image.dispatchEvent(drag);

    expect(document.body.style.userSelect).toBe("text");
    expect(drag.defaultPrevented).toBe(false);
  });

  it("takes over a native drag only when the image has standing tape to rip", () => {
    const manager = new QuarantineTapeManager("player");
    const image = document.createElement("img");
    image.src = "https://example.com/taped.png";
    Reflect.set(manager, "elementMarks", [{
      id: "mark",
      src: image.src,
      type: "slop",
      seed: 1,
      createdBy: "player",
      createdAt: new Date().toISOString(),
      rips: [],
      ripsRequired: null,
    }]);
    getHandler<MouseEvent>(manager, "onMouseDown")(
      new MouseEvent("mousedown", { clientX: 10, clientY: 20 }),
    );
    const drag = new Event("dragstart", { cancelable: true }) as DragEvent;
    image.addEventListener("dragstart", getHandler<DragEvent>(manager, "onDragStart"));

    image.dispatchEvent(drag);

    expect(drag.defaultPrevented).toBe(true);
  });

  it("still prevents native dragging while tape placement is armed", () => {
    const manager = new QuarantineTapeManager("player");
    Reflect.set(manager, "equipped", "slop");
    const drag = new Event("dragstart", { cancelable: true }) as DragEvent;

    getHandler<DragEvent>(manager, "onDragStart")(drag);

    expect(drag.defaultPrevented).toBe(true);
  });

  it("restores the host page selection style after armed image placement", () => {
    const manager = new QuarantineTapeManager("player");
    const image = document.createElement("img");
    document.body.style.userSelect = "text";
    Reflect.set(manager, "equipped", "slop");
    Reflect.set(manager, "hoverTarget", image);
    Reflect.set(manager, "gPreview", document.createElementNS("http://www.w3.org/2000/svg", "g"));

    getHandler<MouseEvent>(manager, "onMouseDown")(
      new MouseEvent("mousedown", { clientX: 10, clientY: 20 }),
    );
    expect(document.body.style.userSelect).toBe("none");

    getHandler<MouseEvent>(manager, "onMouseUp")(
      new MouseEvent("mouseup", { clientX: 11, clientY: 20 }),
    );

    expect(document.body.style.userSelect).toBe("text");
  });
});
