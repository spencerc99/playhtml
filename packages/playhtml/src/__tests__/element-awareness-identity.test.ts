// ABOUTME: Verifies element awareness and identity share the page presence transport.
// ABOUTME: Keeps presence-only users keyed by public identity when cursors are disabled.

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { elementHandlers, playhtml, resetPlayHTML } from "../index";
import { getPresenceSocketForRoom, sentChannelUpdates, sentMessages } from "./presence-test-utils";

describe("element awareness identity", () => {
  beforeEach(async () => {
    document.body.innerHTML = "";
    await resetPlayHTML();
    await playhtml.init({ cursors: { enabled: false } });
    await new Promise((resolve) => queueMicrotask(resolve));
  });
  afterEach(async () => { document.body.innerHTML = ""; await resetPlayHTML(); });

  it("joins with identity before publishing element awareness", async () => {
    const el = document.createElement("div");
    el.id = "presence-only";
    el.setAttribute("can-toggle", "");
    document.body.appendChild(el);
    await playhtml.setupPlayElementForTag(el, "can-toggle");
    elementHandlers.get("can-toggle")!.get("presence-only")!
      .setMyAwareness({ active: true } as any);
    await new Promise((resolve) => setTimeout(resolve, 0));

    const socket = getPresenceSocketForRoom(playhtml.roomId);
    const messages = sentMessages(socket);
    expect(messages.findIndex(({ type }) => type === "presence-join")).toBeLessThan(
      messages.findIndex(({ type, channel }) => type === "presence-update" && channel === "element:shard:0"),
    );
    expect(sentChannelUpdates(socket, "element:shard:0").at(-1)).toMatchObject({
      entries: [["can-toggle", "presence-only", { active: true }]],
    });
  });

  it("joins the page room with the persistent identity", () => {
    const join = sentMessages(getPresenceSocketForRoom(playhtml.roomId))
      .find(({ type }) => type === "presence-join");
    expect(join.identity.publicKey).toBe(playhtml.users.me.pid);
  });
});
