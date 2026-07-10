// ABOUTME: Verifies element awareness transport follows the page room across
// ABOUTME: navigation and ignores cursor-room-only changes.

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { playhtml, resetPlayHTML } from "../index";
import {
  getPresenceSocketForRoom,
  getPresenceSockets,
  sentChannelUpdates,
} from "./presence-test-utils";

describe("element awareness across navigation", () => {
  const origPath = window.location.pathname + window.location.search;

  beforeEach(async () => {
    document.body.innerHTML = "";
    (globalThis as any).PLAYHTML_TEST_PROVIDERS = [];
    await resetPlayHTML();
  });

  afterEach(async () => {
    history.replaceState(null, "", origPath);
    document.body.innerHTML = "";
    await resetPlayHTML();
  });

  function addCanPlayElement(id: string) {
    const el = document.createElement("div");
    el.id = id;
    el.setAttribute("can-play", "");
    (el as any).defaultData = {};
    (el as any).updateElement = () => {};
    document.body.appendChild(el);
    return el;
  }

  it("rebuilds the page-room transport when navigation changes the page room", async () => {
    history.replaceState(null, "", "/nav-a");
    await playhtml.init({ cursors: { enabled: false } });
    const roomA = playhtml.roomId;
    const socketA = getPresenceSocketForRoom(roomA);

    history.replaceState(null, "", "/nav-b");
    await playhtml.handleNavigation();
    const roomB = playhtml.roomId;
    expect(roomB).not.toBe(roomA);

    expect(socketA.closed).toBe(true);
    const socketB = getPresenceSocketForRoom(roomB);
    expect(socketB.closed).toBe(false);

    const el = addCanPlayElement("nav-card");
    await playhtml.setupPlayElementForTag(el, "can-play");
    playhtml.elementHandlers.get("can-play")!.get("nav-card")!
      .setMyAwareness({ here: true } as any);
    expect(sentChannelUpdates(socketB, "element:can-play").at(-1)).toEqual({
      "nav-card": { here: true },
    });
    expect(sentChannelUpdates(socketA, "element:can-play")).toEqual([]);
  });

  it("keeps the page-room transport when only the cursor room changes across navigation", async () => {
    // cursors.room "page" derives from the live pathname, while the explicit
    // `room` option pins the main/page room. Navigating therefore changes ONLY
    // the cursor room — element awareness must keep its socket untouched.
    history.replaceState(null, "", "/pinned");
    await playhtml.init({
      room: "/pinned-room",
      cursors: { enabled: true, room: "page" },
    });
    const pageRoom = playhtml.roomId;
    const pageSocket = getPresenceSocketForRoom(pageRoom);

    history.replaceState(null, "", "/pinned-elsewhere");
    await playhtml.handleNavigation();

    // Page room unchanged: same socket, no rebuild, still open.
    expect(playhtml.roomId).toBe(pageRoom);
    expect(pageSocket.closed).toBe(false);
    expect(getPresenceSocketForRoom(pageRoom)).toBe(pageSocket);
  });

  it("does not deliver another page's element awareness into this page room", async () => {
    await playhtml.init({ cursors: { enabled: true, room: "domain" } });
    const el = addCanPlayElement("isolated-card");
    const snapshots: unknown[][] = [];
    (el as any).updateElementAwareness = ({ awareness }: any) => {
      snapshots.push(awareness);
    };
    await playhtml.setupPlayElementForTag(el, "can-play");

    // A peer on ANOTHER page publishes element awareness into the shared
    // domain cursor room. The page-room element listener must never see it.
    const cursorSocket = getPresenceSockets().find(
      (socket) => socket.options.room !== playhtml.roomId && !socket.closed,
    )!;
    cursorSocket.receive({
      type: "presence-changes",
      updates: {
        "conn-other-page": {
          identity: {
            publicKey: "pk_other",
            playerStyle: { colorPalette: ["blue"] },
          },
          "element:can-play": { "isolated-card": { intruder: true } },
        },
      },
      removes: {},
    });

    expect(snapshots.flat()).not.toContainEqual({ intruder: true });
  });
});
