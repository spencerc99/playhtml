// ABOUTME: Tests for the night-shift skyline model (derivePeople) and layout.

import { describe, it, expect } from "vitest";
import type { CollectionEvent } from "../../types";
import {
  derivePeople,
  layoutSkyline,
  buildingKeyFor,
  MAX_HOUSES,
  type TowerInput,
  type HouseInput,
} from "../skyline";
import { getOwner, INDEPENDENT } from "../corporations";

const NOW = 1_750_000_000_000;

function cursorEvent(
  overrides: Partial<{
    id: string;
    ts: number;
    pid: string;
    url: string;
    tz: string;
    color: string | null;
    event: "move" | "click" | "hold";
  }> = {},
): CollectionEvent {
  const {
    id = Math.random().toString(36).slice(2),
    ts = NOW - 1000,
    pid = "pk_alice",
    url = "https://en.wikipedia.org/wiki/Lighthouse",
    tz = "America/New_York",
    color = "#ff48b0",
    event = "move",
  } = overrides;
  return {
    id,
    type: "cursor",
    ts,
    data: { x: 0.5, y: 0.5, event },
    meta: { pid, sid: "sid_1", url, vw: 1280, vh: 800, tz, cursor_color: color },
  };
}

describe("derivePeople", () => {
  it("folds events into one light per participant", () => {
    const people = derivePeople(
      [
        cursorEvent({ ts: NOW - 5000 }),
        cursorEvent({ ts: NOW - 1000 }),
        cursorEvent({ pid: "pk_bob", url: "https://small.blog/post" }),
      ],
      NOW,
    );
    expect(people.size).toBe(2);
    expect(people.get("pk_alice")?.domain).toBe("en.wikipedia.org");
    expect(people.get("pk_bob")?.owner).toBe(INDEPENDENT);
  });

  it("uses the latest event for domain even when events arrive out of order", () => {
    const people = derivePeople(
      [
        cursorEvent({ ts: NOW - 1000, url: "https://www.youtube.com/watch" }),
        cursorEvent({ ts: NOW - 60_000, url: "https://small.blog/" }),
      ],
      NOW,
    );
    const alice = people.get("pk_alice")!;
    expect(alice.domain).toBe("youtube.com");
    expect(alice.owner.id).toBe("alphabet");
    expect(alice.lastTs).toBe(NOW - 1000);
  });

  it("clamps future timestamps to now", () => {
    const people = derivePeople([cursorEvent({ ts: NOW + 90_000 })], NOW);
    expect(people.get("pk_alice")!.lastTs).toBe(NOW);
  });

  it("tracks clicks and recent movement", () => {
    const people = derivePeople(
      [
        cursorEvent({ ts: NOW - 3000 }),
        cursorEvent({ ts: NOW - 2000, event: "click" }),
        cursorEvent({ ts: NOW - 60_000 }),
      ],
      NOW,
    );
    const alice = people.get("pk_alice")!;
    expect(alice.lastClickTs).toBe(NOW - 2000);
    expect(alice.recentCount).toBe(2); // the 60s-old event is outside the rate window
  });

  it("skips events without a usable url or pid", () => {
    const bad = cursorEvent();
    bad.meta = { ...bad.meta, url: "" };
    expect(derivePeople([bad], NOW).size).toBe(0);
  });
});

describe("buildingKeyFor", () => {
  it("groups corporate domains by owner and indie domains by domain", () => {
    const people = derivePeople(
      [
        cursorEvent({ url: "https://docs.google.com/x" }),
        cursorEvent({ pid: "pk_bob", url: "https://small.blog/" }),
      ],
      NOW,
    );
    expect(buildingKeyFor(people.get("pk_alice")!)).toBe("alphabet");
    expect(buildingKeyFor(people.get("pk_bob")!)).toBe("indie:small.blog");
  });
});

describe("layoutSkyline", () => {
  const towers: TowerInput[] = [
    { owner: getOwner("alphabet"), cumEvents: 900, occupants: 4 },
    { owner: getOwner("meta"), cumEvents: 100, occupants: 1 },
  ];
  const houses: HouseInput[] = [
    { domain: "small.blog", occupants: 1, lastTs: NOW },
    { domain: "tiny.garden", occupants: 2, lastTs: NOW - 1000 },
  ];

  it("gives more floors to owners with more cumulative attention", () => {
    const layout = layoutSkyline({
      width: 1400,
      groundY: 600,
      maxHeight: 500,
      towers,
      houses: [],
    });
    const alphabet = layout.buildings.find((b) => b.key === "alphabet")!;
    const meta = layout.buildings.find((b) => b.key === "meta")!;
    expect(alphabet.floors).toBeGreaterThan(meta.floors);
  });

  it("creates floors*cols slots per building, none overlapping the ground", () => {
    const layout = layoutSkyline({
      width: 1400,
      groundY: 600,
      maxHeight: 500,
      towers,
      houses,
    });
    for (const b of layout.buildings) {
      expect(b.slots.length).toBe(b.floors * b.cols);
      for (const s of b.slots) {
        expect(s.y + s.h).toBeLessThanOrEqual(b.baseY);
        expect(s.y).toBeGreaterThanOrEqual(b.topY);
      }
    }
  });

  it("always leaves room for every occupant", () => {
    const crowded: TowerInput[] = [
      { owner: getOwner("alphabet"), cumEvents: 10, occupants: 40 },
    ];
    const layout = layoutSkyline({
      width: 1400,
      groundY: 600,
      maxHeight: 900,
      towers: crowded,
      houses: [],
    });
    expect(layout.buildings[0].slots.length).toBeGreaterThanOrEqual(40);
  });

  it("compresses horizontally instead of dropping towers when narrow", () => {
    const wide = layoutSkyline({
      width: 2000,
      groundY: 600,
      maxHeight: 500,
      towers,
      houses,
    });
    const narrow = layoutSkyline({
      width: 300,
      groundY: 600,
      maxHeight: 500,
      towers,
      houses,
    });
    expect(narrow.scale).toBeLessThan(1);
    expect(narrow.buildings.filter((b) => b.owner.kind !== "indie").length).toBe(
      wide.buildings.filter((b) => b.owner.kind !== "indie").length,
    );
    for (const b of narrow.buildings) {
      expect(b.x + b.w).toBeLessThanOrEqual(300);
    }
  });

  it("caps the street and reports overflow houses", () => {
    const manyHouses: HouseInput[] = Array.from({ length: MAX_HOUSES + 10 }, (_, i) => ({
      domain: `site-${i}.net`,
      occupants: 1,
      lastTs: NOW - i,
    }));
    const layout = layoutSkyline({
      width: 1200,
      groundY: 600,
      maxHeight: 500,
      towers: [],
      houses: manyHouses,
    });
    expect(layout.overflowDomains).toBeGreaterThanOrEqual(10);
    // Most recently lit houses kept first.
    expect(layout.buildings[0].domain).toBe("site-0.net");
  });
});
