// ABOUTME: Tests that experiment 7 draws one hand hold per pair of people.
// ABOUTME: Also covers which hold a person publishes when several people are in reach.
import { describe, expect, test } from "bun:test";
import {
  collapseHandHolds,
  holdToPublish,
  type HandHold,
  type PublishedHandHold,
} from "../experiments/7/handHolds";

const colors: Record<string, string> = {
  a: "#ff0000",
  b: "#00ff00",
  c: "#0000ff",
  d: "#ffff00",
};

function publish(
  publisherPid: string,
  partnerPid: string,
  startedAt: number,
): PublishedHandHold {
  const handHold: HandHold = {
    id: [colors[publisherPid], colors[partnerPid]].sort().join("-"),
    user1: { playerStyle: { colorPalette: [colors[publisherPid]] } },
    user2: {
      publicKey: partnerPid,
      playerStyle: { colorPalette: [colors[partnerPid]] },
    },
    position1: { x: 100, y: 100 },
    position2: { x: 110, y: 100 },
    angle: 0,
    startedAt,
  };
  return { publisherPid, handHold };
}

describe("collapseHandHolds", () => {
  test("two people holding hands give one hold with both colors", () => {
    const holds = collapseHandHolds([
      publish("a", "b", 10),
      publish("b", "a", 12),
    ]);
    expect(holds).toHaveLength(1);
    const [{ handHold }] = holds;
    expect(
      [
        handHold.user1.playerStyle.colorPalette[0],
        handHold.user2.playerStyle.colorPalette[0],
      ].sort(),
    ).toEqual([colors.a, colors.b].sort());
  });

  test("both screens keep the same copy regardless of order", () => {
    const first = collapseHandHolds([
      publish("a", "b", 10),
      publish("b", "a", 12),
    ]);
    const second = collapseHandHolds([
      publish("b", "a", 12),
      publish("a", "b", 10),
    ]);
    expect(second).toEqual(first);
    expect(first[0].handHold.startedAt).toBe(10);
  });

  test("equal start times fall back to the lower publisher pid", () => {
    const holds = collapseHandHolds([
      publish("b", "a", 10),
      publish("a", "b", 10),
    ]);
    expect(holds[0].handHold.user1.playerStyle.colorPalette[0]).toBe(colors.a);
  });

  test("a hold published by only one side still draws once", () => {
    expect(collapseHandHolds([publish("a", "b", 10)])).toHaveLength(1);
  });

  test("the copy drawn first stays when the second side publishes", () => {
    const [only] = collapseHandHolds([publish("b", "a", 10)]);
    const [both] = collapseHandHolds([
      publish("b", "a", 10),
      publish("a", "b", 11),
    ]);
    expect(both).toEqual(only);
  });

  test("separate pairs stay separate", () => {
    const holds = collapseHandHolds([
      publish("a", "b", 10),
      publish("b", "a", 11),
      publish("c", "d", 12),
      publish("d", "c", 13),
    ]);
    expect(holds).toHaveLength(2);
  });

  test("one person in two holds keeps both pairs", () => {
    const holds = collapseHandHolds([
      publish("a", "b", 10),
      publish("c", "a", 11),
    ]);
    expect(holds.map(({ key }) => key)).toEqual(["a|b", "a|c"]);
  });

  test("a hold without a partner pid falls back to its color pair", () => {
    const entry = publish("a", "b", 10);
    delete entry.handHold.user2.publicKey;
    const holds = collapseHandHolds([entry, publish("b", "a", 11)]);
    expect(holds).toHaveLength(2);
    expect(collapseHandHolds([entry])).toHaveLength(1);
  });

  test("nobody holding hands gives no holds", () => {
    expect(collapseHandHolds([])).toEqual([]);
  });
});

describe("holdToPublish", () => {
  test("nobody in reach publishes no hold", () => {
    expect(holdToPublish(new Map())).toBeUndefined();
  });

  test("the newest hold in reach is published", () => {
    const withB = publish("a", "b", 10).handHold;
    const withC = publish("a", "c", 20).handHold;
    const holds = new Map([
      ["b", withB],
      ["c", withC],
    ]);
    expect(holdToPublish(holds)).toBe(withC);
  });

  test("leaving one partner keeps the hold with the other", () => {
    const withB = publish("a", "b", 10).handHold;
    const withC = publish("a", "c", 20).handHold;
    const holds = new Map([
      ["b", withB],
      ["c", withC],
    ]);
    holds.delete("c");
    expect(holdToPublish(holds)).toBe(withB);
    holds.delete("b");
    expect(holdToPublish(holds)).toBeUndefined();
  });
});
