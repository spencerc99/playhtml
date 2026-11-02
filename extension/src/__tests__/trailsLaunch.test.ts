import { describe, expect, it } from "vitest";
import { parseTrailsLaunch } from "../utils/trailsLaunch";

describe("parseTrailsLaunch", () => {
  it("opens everyone's trails from the hash", () => {
    expect(parseTrailsLaunch("#wwo-trails=everyone")).toEqual({
      source: "everyone",
      uiHidden: false,
    });
  });

  it("hides the controls when asked", () => {
    expect(parseTrailsLaunch("#wwo-trails=everyone&wwo-ui=hidden")).toEqual({
      source: "everyone",
      uiHidden: true,
    });
  });

  it("works after an anchor", () => {
    expect(parseTrailsLaunch("#History&wwo-trails=mine")).toEqual({
      source: "mine",
      uiHidden: false,
    });
  });

  it("ignores hashes without the switch", () => {
    expect(parseTrailsLaunch("")).toBeNull();
    expect(parseTrailsLaunch("#History")).toBeNull();
    expect(parseTrailsLaunch("#wwo-trails=someone")).toBeNull();
  });
});
