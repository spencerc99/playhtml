// ABOUTME: Tests playhtml's default PartyKit host selection.
// ABOUTME: Covers production, staging, local development, and explicit host overrides.
/**
 * @vitest-environment happy-dom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

function mockLocation(host: string) {
  const href = `https://${host}/test/page`;
  const locationMock = {
    host,
    hostname: host.split(":")[0],
    pathname: "/test/page",
    search: "",
    href,
    origin: `https://${host}`,
    protocol: "https:" as const,
    port: "",
    hash: "",
    assign: vi.fn(),
    replace: vi.fn(),
    reload: vi.fn(),
    toString: () => href,
  };

  Object.defineProperty(window, "location", {
    value: locationMock,
    writable: true,
    configurable: true,
  });
}

async function freshPlayhtml() {
  delete (globalThis as any).playhtml;
  delete (window as any).playhtml;
  vi.resetModules();

  const mod = await import("../index");
  return mod.playhtml;
}

describe("PartyKit host defaults", () => {
  beforeEach(() => {
    (globalThis as any).PLAYHTML_TEST_DISABLE_AUTO_SYNC = false;
    (globalThis as any).PLAYHTML_TEST_PROVIDER_THROW = false;
    (globalThis as any).PLAYHTML_TEST_PROVIDERS = [];
    document.body.innerHTML = "";
    delete document.documentElement.dataset.playhtml;
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("uses the custom production API host outside development", async () => {
    vi.stubEnv("DEV", false);
    mockLocation("playhtml.fun");
    const playhtml = await freshPlayhtml();

    await playhtml.init({});

    expect(playhtml.host).toBe("api.playhtml.fun");
  });

  it("uses the custom staging API host on staging pages", async () => {
    vi.stubEnv("DEV", false);
    mockLocation("staging.playhtml.fun");
    const playhtml = await freshPlayhtml();

    await playhtml.init({});

    expect(playhtml.host).toBe("api-staging.playhtml.fun");
  });

  it("uses the local PartyKit host in development", async () => {
    vi.stubEnv("DEV", true);
    mockLocation("playhtml.fun");
    const playhtml = await freshPlayhtml();

    await playhtml.init({});

    expect(playhtml.host).toBe("localhost:1999");
  });

  it("uses an explicitly supplied host", async () => {
    vi.stubEnv("DEV", false);
    mockLocation("playhtml.fun");
    const playhtml = await freshPlayhtml();

    await playhtml.init({ host: "custom.example.com" });

    expect(playhtml.host).toBe("custom.example.com");
  });
});
