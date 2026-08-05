// ABOUTME: Checks the canonical Matter.js recipe's shared-state safety invariants.
// ABOUTME: Guards its stable element setup, keyed data, throttling, and controller model.

import { describe, expect, it } from "vitest";
import { matterPhysicsRecipe } from "../matter-physics";

describe("matter physics recipe", () => {
  it("is a complete canonical recipe", () => {
    expect(matterPhysicsRecipe.id).toBe("matter-physics");
    expect(matterPhysicsRecipe.docsHref).toBe(
      "/docs/examples/matter-physics/",
    );
    expect(matterPhysicsRecipe.html).toMatch(/^<!doctype html>/);
    expect(matterPhysicsRecipe.html).toContain(
      'id="physics-world" can-play',
    );
    expect(matterPhysicsRecipe.html).toContain(
      'from "https://esm.sh/matter-js@0.20.0"',
    );
  });

  it("configures the can-play element before initialization", () => {
    const source = matterPhysicsRecipe.html;
    const configPosition = source.indexOf("worldElement.defaultData =");
    const updatePosition = source.indexOf("worldElement.updateElement =");
    const mountPosition = source.indexOf("worldElement.onMount =");
    const initPosition = source.indexOf("await playhtml.init(");

    expect(configPosition).toBeGreaterThan(-1);
    expect(updatePosition).toBeGreaterThan(configPosition);
    expect(mountPosition).toBeGreaterThan(updatePosition);
    expect(initPosition).toBeGreaterThan(mountPosition);
  });

  it("uses one controller and bounded, throttled keyed writes", () => {
    const source = matterPhysicsRecipe.html;

    expect(source).toContain("const SYNC_INTERVAL_MS = 100;");
    expect(source).toContain("draft.controllerId !== CLIENT_ID");
    expect(source).toContain("draft.bodies[id].x = transform.x;");
    expect(source).toContain("Math.max(BODY_SIZE / 2");
    expect(source).toContain("resetLocalBodies();");

    const updateBody = source.slice(
      source.indexOf("worldElement.updateElement ="),
      source.indexOf("worldElement.onMount ="),
    );
    expect(updateBody).not.toContain("setData");
  });
});
