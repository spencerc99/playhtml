// ABOUTME: Verifies the commute landscape generator is deterministic and bounded.
// ABOUTME: Covers seeded scenery variation and the expected procedural layers.

import { describe, expect, it } from "vitest";
import { createLandscapePlan } from "./landscape";

describe("createLandscapePlan", () => {
  it("returns the same scenery for the same seed", () => {
    expect(createLandscapePlan("quiet-line")).toEqual(
      createLandscapePlan("quiet-line"),
    );
  });

  it("varies the scenery when the route seed changes", () => {
    expect(createLandscapePlan("quiet-line")).not.toEqual(
      createLandscapePlan("night-line"),
    );
  });

  it("includes each requested landscape layer", () => {
    const plan = createLandscapePlan("all-layers");

    expect(plan.clouds).toHaveLength(7);
    expect(plan.distantMountains).toHaveLength(2);
    expect(plan.mountain).toMatch(/^M /);
    expect(plan.contours).toHaveLength(4);
    expect(plan.ridgeTrees.length).toBeGreaterThan(0);
    expect(plan.foregroundTrees).toHaveLength(13);
    expect(plan.water).toHaveLength(8);
  });
});
