// ABOUTME: Verifies that a peer's color or name change after load reaches the other peer's view of them.
// ABOUTME: Records peer A's real wire messages, replays them into peer B, and checks B's people list, drawn cursor, and proximity data.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PlayerIdentity, User } from "@playhtml/common";
import { playhtml, resetPlayHTML } from "../../index";
import {
  flushPresencePublishes,
  getPresenceSocketForRoom,
  sentMessages,
  type FakePresenceSocket,
} from "../../__tests__/presence-test-utils";

const NEW_COLOR = "#e0115f";
const OLD_COLOR = "#336699";
const PEER_A = "conn-a";

function freshIdentity(publicKey: string, color: string): PlayerIdentity {
  return { publicKey, playerStyle: { colorPalette: [color] } };
}

type PeerState = Record<string, unknown>;

/** Folds a client's outgoing presence messages into the channels the server relays to peers. */
function relayedChannels(messages: any[]): PeerState {
  const channels: PeerState = {};
  for (const message of messages) {
    if (message.type === "presence-join") {
      if (message.identity !== undefined) channels.identity = message.identity;
      if (message.page !== undefined) channels.page = message.page;
    } else if (message.type === "presence-update") {
      channels[message.channel] = message.value;
    }
  }
  return channels;
}

function moveMouse(x: number, y: number) {
  document.dispatchEvent(new MouseEvent("mousemove", { clientX: x, clientY: y }));
}

async function waitFor(check: () => boolean, label: string) {
  for (let i = 0; i < 50; i++) {
    if (check()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`timed out waiting for ${label}`);
}

function pageSocket(): FakePresenceSocket {
  return getPresenceSocketForRoom(playhtml.roomId);
}

/**
 * Runs peer A: a full playhtml page with cursors, next to one other person so
 * it publishes its cursor. Returns what the server would relay for A before
 * and after `change` runs.
 */
async function recordPeerA(change: () => void): Promise<{
  before: PeerState;
  after: PeerState;
  pid: string;
}> {
  // Each peer gets its own identity: both pages run in one test process,
  // which otherwise shares a single saved identity.
  await playhtml.init({ cursors: { enabled: true, playerIdentity: freshIdentity("pk_a", OLD_COLOR) } });
  await flushPresencePublishes();
  const socket = pageSocket();
  socket.receive({
    type: "presence-sync",
    peers: {
      "conn-someone": {
        identity: { publicKey: "pk_someone", playerStyle: { colorPalette: ["#123456"] } },
      },
    },
  });
  await waitFor(() => !!playhtml.cursorClient, "cursor client");
  moveMouse(100, 100);
  await waitFor(
    () => sentMessages(socket).some((m) => m.type === "presence-update" && m.channel === "cursor"),
    "A's cursor publish",
  );
  const before = relayedChannels(sentMessages(socket));
  const sentBefore = socket.sent.length;

  change();
  await flushPresencePublishes();
  const changed = relayedChannels(sentMessages(socket).slice(sentBefore));
  const pid = playhtml.people.me.pid;

  await resetPlayHTML();
  localStorage.clear();
  document.body.innerHTML = "";
  return { before, after: { ...before, ...changed }, pid };
}

/** Runs peer B: a full playhtml page with cursors that sees peer A's recorded state. */
async function startPeerB(
  initial: PeerState,
  onProximityEntered: (identity?: PlayerIdentity, p?: unknown, a?: number, user?: User) => void,
) {
  await playhtml.init({
    cursors: { enabled: true, playerIdentity: freshIdentity("pk_b", "#0a7f3f"), onProximityEntered },
  });
  await flushPresencePublishes();
  await waitFor(() => !!playhtml.cursorClient, "cursor client");
  pageSocket().receive({ type: "presence-sync", peers: { [PEER_A]: initial } });
}

function receiveFromA(changed: PeerState) {
  pageSocket().receive({
    type: "presence-changes",
    updates: { [PEER_A]: changed },
    removes: {},
  });
}

function drawnCursorFill(): string | null {
  const cursors = document.querySelectorAll(".playhtml-cursor-other");
  expect(cursors).toHaveLength(1);
  const paths = cursors[0].querySelectorAll("path");
  return paths[paths.length - 1].getAttribute("fill");
}

function drawnCursorName(): string | null {
  return (
    document.querySelector(".playhtml-cursor-other .playhtml-cursor-name")?.textContent ?? null
  );
}

function drawnNameBackground(): string {
  const label = document.querySelector<HTMLElement>(
    ".playhtml-cursor-other .playhtml-cursor-name",
  );
  return label?.style.background ?? "";
}

describe("a peer changing their identity after load", () => {
  beforeEach(() => {
    Object.defineProperty(document, "elementFromPoint", {
      configurable: true,
      value: () => document.body,
    });
  });

  afterEach(async () => {
    await resetPlayHTML();
    localStorage.clear();
    document.body.innerHTML = "";
    vi.restoreAllMocks();
  });

  const colorSetters: Array<[string, () => void]> = [
    ["playhtml.people.me.color", () => (playhtml.people.me.color = NEW_COLOR)],
    ["playhtml.users.me.color", () => (playhtml.users.me.color = NEW_COLOR)],
    ["window.cursors.color", () => (window.cursors.color = NEW_COLOR)],
  ];

  for (const [setter, change] of colorSetters) {
    it(`shows the new color everywhere on the other peer (${setter})`, async () => {
      const a = await recordPeerA(change);
      const oldColor = (a.before.identity as PlayerIdentity).playerStyle.colorPalette[0];
      expect(oldColor).not.toBe(NEW_COLOR);
      expect((a.after.identity as PlayerIdentity).playerStyle.colorPalette[0]).toBe(NEW_COLOR);

      const entered = vi.fn();
      await startPeerB(a.before, entered);
      expect(drawnCursorFill()).toBe(oldColor);

      receiveFromA({ identity: a.after.identity });

      // (a) the people list
      const personA = playhtml.people.everyone.find((person) => person.pid === a.pid);
      expect(personA?.color).toBe(NEW_COLOR);
      // (b) the cursor B draws for A
      expect(drawnCursorFill()).toBe(NEW_COLOR);
      // (c) identity data handed to the page
      const view = playhtml.cursorClient!.getCursorPresences().get(a.pid);
      expect(view?.user?.color).toBe(NEW_COLOR);
      expect(view?.playerIdentity?.playerStyle.colorPalette[0]).toBe(NEW_COLOR);

      moveMouse(105, 105);
      await waitFor(() => entered.mock.calls.length > 0, "proximity");
      const [identity, , , user] = entered.mock.lastCall!;
      expect(user?.color).toBe(NEW_COLOR);
      expect(identity?.playerStyle.colorPalette[0]).toBe(NEW_COLOR);
    });
  }

  it("redraws the cursor label for a new name and color (playhtml.people.me.name)", async () => {
    const a = await recordPeerA(() => {
      playhtml.people.me.name = "Ada";
    });
    const recolored = structuredClone(a.after.identity) as PlayerIdentity;
    recolored.playerStyle.colorPalette[0] = NEW_COLOR;

    await startPeerB(a.before, () => {});
    expect(drawnCursorName()).toBeNull();

    receiveFromA({ identity: a.after.identity });
    expect(drawnCursorName()).toBe("Ada");

    receiveFromA({ identity: recolored });
    expect(drawnCursorName()).toBe("Ada");
    expect(drawnNameBackground()).toBe("rgb(224, 17, 95)");
  });
});
