// ABOUTME: Collapses the hand holds people publish in experiment 7 into one per pair,
// ABOUTME: and picks which in-reach hold a person publishes when several people are near.

export interface HandHoldPerson {
  publicKey?: string;
  playerStyle: { colorPalette: string[] };
}

export interface HandHold {
  id: string;
  user1: HandHoldPerson;
  user2: HandHoldPerson;
  position1: { x: number; y: number };
  position2: { x: number; y: number };
  angle: number;
  startedAt: number;
}

export interface PublishedHandHold {
  publisherPid: string;
  handHold: HandHold;
}

/**
 * Order-independent key for the pair in a published hold: the publisher's pid
 * and their partner's pid, sorted. A hold without a partner pid falls back to
 * its color-pair id.
 */
export function handHoldPairKey({ publisherPid, handHold }: PublishedHandHold) {
  const partnerPid = handHold.user2?.publicKey;
  if (typeof partnerPid !== "string" || partnerPid === "") {
    return `colors:${handHold.id}`;
  }
  return [publisherPid, partnerPid].sort().join("|");
}

/**
 * Returns one hold per pair. When both people have published, every screen
 * keeps the same copy: the earliest `startedAt`, then the lower publisher pid.
 * Keeping the earliest copy means the hold drawn while only one side had
 * published stays put when the second copy arrives.
 */
export function collapseHandHolds(
  published: PublishedHandHold[],
): Array<{ key: string; handHold: HandHold }> {
  const chosen = new Map<string, PublishedHandHold>();
  for (const entry of published) {
    const key = handHoldPairKey(entry);
    const current = chosen.get(key);
    if (!current || isPreferred(entry, current)) {
      chosen.set(key, entry);
    }
  }
  return [...chosen.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([key, entry]) => ({ key, handHold: entry.handHold }));
}

/**
 * The hold someone publishes while their hand is in reach of one or more
 * people, keyed by partner pid: the most recent one, or none when nobody is
 * in reach. Presence holds a single hold per person, so leaving one partner
 * falls back to a hold that is still in reach rather than clearing it.
 */
export function holdToPublish(
  holdsByPartnerPid: ReadonlyMap<string, HandHold>,
): HandHold | undefined {
  let newest: HandHold | undefined;
  for (const handHold of holdsByPartnerPid.values()) {
    if (!newest || handHold.startedAt >= newest.startedAt) {
      newest = handHold;
    }
  }
  return newest;
}

function isPreferred(candidate: PublishedHandHold, current: PublishedHandHold) {
  if (candidate.handHold.startedAt !== current.handHold.startedAt) {
    return candidate.handHold.startedAt < current.handHold.startedAt;
  }
  return candidate.publisherPid < current.publisherPid;
}
