// ABOUTME: Verifies QuarantineTapeManager signs strip/rip writes with the caller's identity
// ABOUTME: and skips the network write entirely when no signable identity is available.

import { afterEach, describe, expect, it, vi } from "vitest";
import { QuarantineTapeManager } from "../features/social/quarantine-tape/QuarantineTapeManager";
import { quarantineRipPayload, quarantineStripPayload } from "../features/social/quarantine-tape/quarantineProof";
import type { Strip } from "../features/social/quarantine-tape/types";

const postStrip = vi.hoisted(() => vi.fn());
const postRip = vi.hoisted(() => vi.fn());

vi.mock("../features/social/quarantine-tape/quarantine-api", () => ({
  getVerdict: vi.fn().mockResolvedValue([]),
  postStrip,
  postRip,
}));

const EDGE_A = { wall: "left" as const, t: 0.2 };
const EDGE_B = { wall: "right" as const, t: 0.8 };

function callPrivate<T>(target: object, name: string, ...args: unknown[]): Promise<T> {
  return Reflect.get(target, name).apply(target, args);
}

/** commitStrip/ripStrip both call this.renderStrips(), which needs a real SVG
 * tree set up by init(). These tests only care about the signing/network
 * behavior, so stub it out rather than exercising the full render pipeline. */
function withoutRendering(manager: QuarantineTapeManager): void {
  Reflect.set(manager, "renderStrips", () => {});
}

afterEach(() => {
  postStrip.mockReset();
  postRip.mockReset();
});

describe("QuarantineTapeManager ownership proof", () => {
  it("signs the exact strip content before posting it", async () => {
    const signPayload = vi.fn().mockResolvedValue("sig-strip");
    postStrip.mockResolvedValue({ id: "s1" } as Strip);
    const manager = new QuarantineTapeManager("pk_player", signPayload);
    withoutRendering(manager);

    await callPrivate(manager, "commitStrip", EDGE_A, EDGE_B, "slop");

    expect(postStrip).toHaveBeenCalledWith(
      expect.objectContaining({ createdBy: "pk_player", signature: "sig-strip", type: "slop" }),
    );
    // The signed payload must bind the exact seed that was actually posted —
    // pull it from the postStrip call rather than predicting the random value.
    const postedSeed = postStrip.mock.calls[0][0].seed;
    expect(signPayload).toHaveBeenCalledWith(
      quarantineStripPayload("pk_player", location.href, "slop", EDGE_A, EDGE_B, postedSeed),
    );
  });

  it("never calls the network when no signable identity is available", async () => {
    const signPayload = vi.fn().mockResolvedValue(null);
    const manager = new QuarantineTapeManager("pk_player", signPayload);
    withoutRendering(manager);

    await callPrivate(manager, "commitStrip", EDGE_A, EDGE_B, "slop");

    expect(signPayload).toHaveBeenCalled();
    expect(postStrip).not.toHaveBeenCalled();
  });

  it("defaults to a no-signature signer when none is provided, so writes never reach the network unsigned", async () => {
    const manager = new QuarantineTapeManager("pk_player");
    withoutRendering(manager);

    await callPrivate(manager, "commitStrip", EDGE_A, EDGE_B, "slop");

    expect(postStrip).not.toHaveBeenCalled();
  });

  it("signs the exact rip content before posting it", async () => {
    const signPayload = vi.fn().mockResolvedValue("sig-rip");
    postRip.mockResolvedValue({ id: "s1", rips: [] } as unknown as Strip);
    const manager = new QuarantineTapeManager("pk_player", signPayload);
    withoutRendering(manager);
    const strip: Strip = {
      id: "s1",
      type: "slop",
      a: EDGE_A,
      b: EDGE_B,
      seed: 1,
      createdBy: "pk_other",
      createdAt: "t",
      rips: [],
      ripsRequired: null,
    };

    await callPrivate(manager, "ripStrip", strip, 0.5);

    expect(signPayload).toHaveBeenCalledWith(
      quarantineRipPayload("pk_player", location.href, "s1", 0.5),
    );
    expect(postRip).toHaveBeenCalledWith(
      expect.objectContaining({ by: "pk_player", signature: "sig-rip", stripId: "s1", pos: 0.5 }),
    );
  });
});
