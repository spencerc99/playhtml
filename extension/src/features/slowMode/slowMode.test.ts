// ABOUTME: Verifies Slow Mode navigation eligibility, consent gates, and ride state.
// ABOUTME: Covers same-site safety, cooldowns, chance, commute URLs, and ride logs.

import { describe, expect, it } from "vitest";
import {
  DEFAULT_SLOW_MODE_SETTINGS,
  SLOW_MODE_COOLDOWN_MS,
  createCommuteUrl,
  evaluateSlowModeNavigation,
  getCooldownStatus,
  isFarJump,
  recordSlowModeRide,
  type SlowModeState,
} from "./slowMode";

const NOW = new Date("2026-08-21T17:00:00-07:00").getTime();

function emptyState(): SlowModeState {
  return {
    lastCommuteAt: null,
    lastCommuteByDomain: {},
    rides: [],
  };
}

describe("isFarJump", () => {
  it.each(["typed", "auto_bookmark", "generated"] as const)(
    "accepts deliberate %s navigation",
    (transitionType) => {
      expect(
        isFarJump({
          previousUrl: "https://garden.example/notes",
          destinationUrl: "https://museum.example/exhibit",
          transitionType,
          transitionQualifiers: [],
        }),
      ).toBe(true);
    },
  );

  it("accepts a new-tab navigation", () => {
    expect(
      isFarJump({
        previousUrl: "chrome://newtab/",
        destinationUrl: "https://museum.example/exhibit",
        transitionType: "other",
        transitionQualifiers: [],
      }),
    ).toBe(true);
  });

  it.each(["link", "form_submit", "reload"] as const)(
    "rejects %s navigation",
    (transitionType) => {
      expect(
        isFarJump({
          previousUrl: "https://garden.example/notes",
          destinationUrl: "https://museum.example/exhibit",
          transitionType,
          transitionQualifiers: [],
        }),
      ).toBe(false);
    },
  );

  it("rejects back and forward navigation", () => {
    expect(
      isFarJump({
        previousUrl: "https://garden.example/notes",
        destinationUrl: "https://museum.example/exhibit",
        transitionType: "typed",
        transitionQualifiers: ["forward_back"],
      }),
    ).toBe(false);
  });

  it("rejects same-site navigation across subdomains", () => {
    expect(
      isFarJump({
        previousUrl: "https://notes.example.co.uk/one",
        destinationUrl: "https://www.example.co.uk/two",
        transitionType: "typed",
        transitionQualifiers: [],
      }),
    ).toBe(false);
  });

  it.each([
    "https://accounts.google.com/signin",
    "https://shop.example/checkout",
    "https://localhost:3000/private",
    "http://192.168.1.4/admin",
    "https://mail.example/inbox",
    "https://calendar.google.com/calendar/u/0/r",
    "https://docs.google.com/document/d/private/edit",
  ])("rejects protected destination %s", (destinationUrl) => {
    expect(
      isFarJump({
        previousUrl: "https://garden.example/notes",
        destinationUrl,
        transitionType: "typed",
        transitionQualifiers: [],
      }),
    ).toBe(false);
  });

  it("rejects navigation while a form is in progress", () => {
    expect(
      isFarJump({
        previousUrl: "https://garden.example/notes",
        destinationUrl: "https://museum.example/exhibit",
        transitionType: "typed",
        transitionQualifiers: [],
        formInProgress: true,
      }),
    ).toBe(false);
  });
});

describe("Slow Mode consent gates", () => {
  const navigation = {
    previousUrl: "https://garden.example/notes",
    destinationUrl: "https://museum.example/exhibit",
    transitionType: "typed" as const,
    transitionQualifiers: [],
  };

  it("does not intercept while disabled", () => {
    expect(
      evaluateSlowModeNavigation(
        navigation,
        DEFAULT_SLOW_MODE_SETTINGS,
        emptyState(),
        NOW,
        () => 0,
      ).reason,
    ).toBe("disabled");
  });

  it("applies the chance after navigation eligibility", () => {
    const settings = { enabled: true, chancePercent: 30 };
    expect(
      evaluateSlowModeNavigation(
        navigation,
        settings,
        emptyState(),
        NOW,
        () => 0.29,
      ).shouldCommute,
    ).toBe(true);
    expect(
      evaluateSlowModeNavigation(
        navigation,
        settings,
        emptyState(),
        NOW,
        () => 0.3,
      ).reason,
    ).toBe("chance");
  });

  it("enforces global and per-domain cooldowns", () => {
    const settings = { enabled: true, chancePercent: 100 };
    const globalState = emptyState();
    globalState.lastCommuteAt = NOW - SLOW_MODE_COOLDOWN_MS + 1;
    expect(
      evaluateSlowModeNavigation(
        navigation,
        settings,
        globalState,
        NOW,
        () => 0,
      ).reason,
    ).toBe("global-cooldown");

    const domainState = emptyState();
    domainState.lastCommuteByDomain["museum.example"] = "2026-08-21";
    expect(
      evaluateSlowModeNavigation(
        navigation,
        settings,
        domainState,
        NOW,
        () => 0,
      ).reason,
    ).toBe("domain-cooldown");
  });

  it("shares the daily cooldown across subdomains", () => {
    const domainState = emptyState();
    domainState.lastCommuteByDomain["example.com"] = "2026-08-21";

    expect(
      evaluateSlowModeNavigation(
        {
          ...navigation,
          destinationUrl: "https://news.example.com/article",
        },
        { enabled: true, chancePercent: 100 },
        domainState,
        NOW,
        () => 0,
      ).reason,
    ).toBe("domain-cooldown");
  });
});

describe("Slow Mode state", () => {
  it("records a ride and reports the cooldown", () => {
    const state = recordSlowModeRide(emptyState(), {
      destinationUrl: "https://museum.example/exhibit?utm_source=test",
      startedAt: NOW,
      stopCount: 3,
      outcome: "arrived",
    });

    expect(state.lastCommuteAt).toBe(NOW);
    expect(state.lastCommuteByDomain["museum.example"]).toBe("2026-08-21");
    expect(state.rides[0]).toMatchObject({
      destinationDomain: "museum.example",
      stopCount: 3,
      outcome: "arrived",
    });
    expect(getCooldownStatus(state, NOW + 5 * 60_000).remainingMs).toBe(
      SLOW_MODE_COOLDOWN_MS - 5 * 60_000,
    );
  });

  it("builds an encoded extension commute URL", () => {
    expect(
      createCommuteUrl(
        "chrome-extension://abc/commute.html",
        "https://museum.example/exhibit?q=slow mode",
      ),
    ).toBe(
      "chrome-extension://abc/commute.html?slow=1&destination=https%3A%2F%2Fmuseum.example%2Fexhibit%3Fq%3Dslow+mode",
    );
  });
});
