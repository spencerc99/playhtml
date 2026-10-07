// ABOUTME: Verifies identity broadcasting is a transport concern: one re-join
// ABOUTME: per socket on users.me change, no per-consumer identity wiring.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { toPublicPlayerIdentity } from "@playhtml/common";
import { playhtml, resetPlayHTML } from "../index";
import { getPresenceSocketForRoom, sentMessages } from "./presence-test-utils";

function joinIdentities(socketSent: any[]): any[] {
  return socketSent
    .filter((message) => message.type === "presence-join")
    .map((message) => message.identity);
}

describe("identity broadcasting on the shared transport", () => {
  beforeEach(async () => {
    document.body.innerHTML = "";
    (globalThis as any).PLAYHTML_TEST_PROVIDERS = [];
    await resetPlayHTML();
    await playhtml.init({ cursors: { enabled: true } });
    await new Promise((resolve) => queueMicrotask(resolve));
  });

  afterEach(async () => {
    document.body.innerHTML = "";
    await resetPlayHTML();
  });

  it("re-joins the shared socket exactly once when users.me.color changes", () => {
    const socket = getPresenceSocketForRoom(playhtml.roomId);
    const before = sentMessages(socket).filter(
      (m) => m.type === "presence-join",
    ).length;

    playhtml.users.me.color = "#123456";

    const joins = sentMessages(socket).filter((m) => m.type === "presence-join");
    // Exactly one additional join for the identity change (one broadcaster per
    // socket — cursors and element awareness share it and do not each re-join).
    expect(joins.length).toBe(before + 1);
    expect(joins.at(-1)!.identity.playerStyle.colorPalette[0]).toBe("#123456");
  });

  it("re-joins with the new name when users.me.name changes", () => {
    const socket = getPresenceSocketForRoom(playhtml.roomId);
    playhtml.users.me.name = "Ada";
    const identities = joinIdentities(sentMessages(socket));
    expect(identities.at(-1).name).toBe("Ada");
  });

  it("re-joins after the extension injects an identity via CustomEvent", () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const socket = getPresenceSocketForRoom(playhtml.roomId);
    const before = sentMessages(socket).filter(
      (m) => m.type === "presence-join",
    ).length;

    const injected = toPublicPlayerIdentity({
      publicKey: "pk_extension",
      playerStyle: { colorPalette: ["#abcdef"] },
    });
    document.dispatchEvent(
      new CustomEvent("playhtml:configure-identity", {
        detail: { playerIdentity: injected },
      }),
    );

    const joins = sentMessages(socket).filter((m) => m.type === "presence-join");
    expect(joins.length).toBeGreaterThan(before);
    expect(joins.at(-1)!.identity.publicKey).toBe("pk_extension");
    expect(log).toHaveBeenCalledWith(
      "[playhtml] Merged extension identity via CustomEvent",
    );
    log.mockRestore();
  });

  it("keeps element awareness re-keyed under the new identity after a change", async () => {
    const el = document.createElement("div");
    el.id = "identity-rekey-card";
    el.setAttribute("can-toggle", "");
    document.body.appendChild(el);
    await playhtml.setupPlayElementForTag(el, "can-toggle");

    playhtml.users.me.color = "#654321";

    // The presence API still reports self under the current publicKey.
    const myPid = playhtml.presence.getMyIdentity().publicKey;
    const self = playhtml.presence.getPresences().get(myPid);
    expect(self?.isMe).toBe(true);
  });
});
