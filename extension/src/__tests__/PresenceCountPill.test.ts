// ABOUTME: Tests for the Wikipedia presence count pill and portal target selection.
// ABOUTME: Verifies domain-lobby pages only advertise useful live destinations.

import type { PresenceAPI, PlayerIdentity } from "@playhtml/common";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PresenceCountPill } from "../features/PresenceCountPill";

function setLocation(href: string) {
  const url = new URL(href);
  Object.defineProperty(window, "location", {
    configurable: true,
    value: {
      href: url.href,
      pathname: url.pathname,
      origin: url.origin,
      hostname: url.hostname,
      hash: url.hash,
    },
  });
}

function identity(publicKey: string): PlayerIdentity {
  return {
    publicKey,
    playerStyle: { colorPalette: ["#4a9a8a"] },
  } as PlayerIdentity;
}

function presenceApi(myKey: string, presences: Map<string, any>): PresenceAPI {
  return {
    setMyPresence: vi.fn(),
    getPresences: () => presences,
    onPresenceChange: vi.fn(() => () => {}),
    getMyIdentity: () => identity(myKey),
  };
}

describe("PresenceCountPill", () => {
  afterEach(() => {
    document.body.innerHTML = "";
    vi.useRealTimers();
    setLocation("https://en.wikipedia.org/wiki/Current");
  });

  it("does not show the jump portal for stale lobby pages", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-30T12:00:00Z"));
    setLocation("https://en.wikipedia.org/wiki/Current");

    const pagePresence = presenceApi(
      "me",
      new Map([
        ["me", { isMe: true, playerIdentity: identity("me") }],
      ]),
    );
    const lobbyPresence = presenceApi(
      "me",
      new Map([
        ["me", { isMe: true, playerIdentity: identity("me") }],
        [
          "peer",
          {
            isMe: false,
            playerIdentity: identity("peer"),
            page: {
              url: "https://en.wikipedia.org/wiki/Stale",
              title: "Stale",
              visible: true,
              lastSeenAt: Date.now() - 60_000,
            },
          },
        ],
      ]),
    );

    const pill = new PresenceCountPill(pagePresence, lobbyPresence);
    pill.init();

    expect(
      document.querySelector('button[title="jump to someone"]'),
    ).toBeNull();

    pill.destroy();
  });

  it("does not show the jump portal for fresh hidden lobby pages", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-30T12:00:00Z"));
    setLocation("https://en.wikipedia.org/wiki/Current");

    const pagePresence = presenceApi(
      "me",
      new Map([
        ["me", { isMe: true, playerIdentity: identity("me") }],
      ]),
    );
    const lobbyPresence = presenceApi(
      "me",
      new Map([
        ["me", { isMe: true, playerIdentity: identity("me") }],
        [
          "peer",
          {
            isMe: false,
            playerIdentity: identity("peer"),
            page: {
              url: "https://en.wikipedia.org/wiki/Hidden",
              title: "Hidden",
              visible: false,
              lastSeenAt: Date.now(),
            },
          },
        ],
      ]),
    );

    const pill = new PresenceCountPill(pagePresence, lobbyPresence);
    pill.init();

    expect(
      document.querySelector('button[title="jump to someone"]'),
    ).toBeNull();

    pill.destroy();
  });

  it("does not show the jump portal for Wikipedia media views", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-30T12:00:00Z"));
    setLocation("https://en.wikipedia.org/wiki/Current");

    const pagePresence = presenceApi(
      "me",
      new Map([
        ["me", { isMe: true, playerIdentity: identity("me") }],
      ]),
    );
    const lobbyPresence = presenceApi(
      "me",
      new Map([
        ["me", { isMe: true, playerIdentity: identity("me") }],
        [
          "peer",
          {
            isMe: false,
            playerIdentity: identity("peer"),
            page: {
              url: "https://en.wikipedia.org/wiki/Octopus#/media/File:Octopus.jpg",
              title: "Octopus",
              visible: true,
              lastSeenAt: Date.now(),
            },
          },
        ],
      ]),
    );

    const pill = new PresenceCountPill(pagePresence, lobbyPresence);
    pill.init();

    expect(
      document.querySelector('button[title="jump to someone"]'),
    ).toBeNull();

    pill.destroy();
  });

  it("jumps to a fresh lobby page instead of a stale one", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-30T12:00:00Z"));
    vi.spyOn(Math, "random").mockReturnValue(0);
    setLocation("https://en.wikipedia.org/wiki/Current");

    const pagePresence = presenceApi(
      "me",
      new Map([
        ["me", { isMe: true, playerIdentity: identity("me") }],
      ]),
    );
    const lobbyPresence = presenceApi(
      "me",
      new Map([
        ["me", { isMe: true, playerIdentity: identity("me") }],
        [
          "stale-peer",
          {
            isMe: false,
            playerIdentity: identity("stale-peer"),
            page: {
              url: "https://en.wikipedia.org/wiki/Stale",
              title: "Stale",
              visible: true,
              lastSeenAt: Date.now() - 60_000,
            },
          },
        ],
        [
          "fresh-peer",
          {
            isMe: false,
            playerIdentity: identity("fresh-peer"),
            page: {
              url: "https://en.wikipedia.org/wiki/Fresh",
              title: "Fresh",
              visible: true,
              lastSeenAt: Date.now(),
            },
          },
        ],
      ]),
    );

    const pill = new PresenceCountPill(pagePresence, lobbyPresence);
    pill.init();

    document
      .querySelector<HTMLButtonElement>('button[title="jump to someone"]')
      ?.click();

    expect(window.location.href).toBe("https://en.wikipedia.org/wiki/Fresh");

    pill.destroy();
  });
});
