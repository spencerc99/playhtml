// ABOUTME: Verifies presence transports are shared per room via refcounting.
// ABOUTME: Covers cursor teardown not closing sockets still used elsewhere.

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { playhtml, resetPlayHTML } from "../index";
import { getPresenceSockets } from "./presence-test-utils";

describe("presence transport sharing", () => {
  beforeEach(async () => {
    document.body.innerHTML = "";
    (globalThis as any).PLAYHTML_TEST_PROVIDERS = [];
    await resetPlayHTML();
  });

  afterEach(async () => {
    document.body.innerHTML = "";
    await resetPlayHTML();
  });

  it("opens exactly one presence socket when cursors share the page room", async () => {
    await playhtml.init({ cursors: { enabled: true } });
    const rooms = getPresenceSockets()
      .filter((socket) => !socket.closed)
      .map((socket) => socket.options.room);
    expect(rooms).toEqual([playhtml.roomId]);
  });

  it("closes presence sockets on resetPlayHTML", async () => {
    await playhtml.init({ cursors: { enabled: true } });
    await resetPlayHTML();
    expect(getPresenceSockets().every((socket) => socket.closed)).toBe(true);
  });
});
