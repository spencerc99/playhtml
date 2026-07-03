// ABOUTME: Verifies element awareness publishes stable player identity metadata.
// ABOUTME: Keeps presence-only users keyed by public identity instead of Yjs client id.

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getStableIdForAwareness } from "../awareness-utils";
import { playhtml, resetPlayHTML } from "../index";

function getCurrentProvider(): any {
  const providers = (globalThis as any).PLAYHTML_TEST_PROVIDERS as any[];
  const provider = providers?.[providers.length - 1];
  if (!provider) throw new Error("Expected test provider");
  return provider;
}

describe("element awareness identity", () => {
  beforeEach(async () => {
    document.body.innerHTML = "";
    (globalThis as any).PLAYHTML_TEST_PROVIDERS = [];
    await resetPlayHTML();
    await playhtml.init({
      cursors: { enabled: false },
    });
    await new Promise((resolve) => queueMicrotask(resolve));
  });

  afterEach(async () => {
    document.body.innerHTML = "";
    await resetPlayHTML();
  });

  it("writes player identity before publishing element awareness", async () => {
    const el = document.createElement("div");
    el.id = "presence-only";
    el.setAttribute("can-toggle", "");
    document.body.appendChild(el);
    await playhtml.setupPlayElementForTag(el, "can-toggle");

    const handler = playhtml.elementHandlers.get("can-toggle")!.get("presence-only")!;
    handler.setMyAwareness({ active: true } as any);

    const awareness = getCurrentProvider().awareness;
    const state = awareness.getLocalState();
    const stableId = getStableIdForAwareness(state, awareness.clientID);

    expect(state.__playhtml_identity__).toMatchObject({
      publicKey: playhtml.presence.getMyIdentity().publicKey,
    });
    expect(stableId).toBe(playhtml.presence.getMyIdentity().publicKey);
  });
});
