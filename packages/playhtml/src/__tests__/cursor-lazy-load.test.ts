// ABOUTME: Verifies the cursor client module is downloaded only when cursors are enabled.
// ABOUTME: Holds the module import open to prove pages without cursors never wait on it.
import { beforeEach, describe, expect, it, vi } from "vitest";

let cursorModuleRequested = false;
let releaseCursorModule: () => void = () => {};
const cursorModuleGate = new Promise<void>((resolve) => {
  releaseCursorModule = resolve;
});

vi.mock("../cursors/cursor-client", async (importOriginal) => {
  cursorModuleRequested = true;
  await cursorModuleGate;
  return importOriginal();
});

const { playhtml, resetPlayHTML } = await import("../index");

describe("cursor client lazy loading", () => {
  beforeEach(async () => {
    await resetPlayHTML();
    document.body.innerHTML = "";
    (globalThis as any).PLAYHTML_TEST_PROVIDERS = [];
  });

  it("initializes without requesting the cursor client when cursors are off", async () => {
    await playhtml.init({ host: "http://localhost:1999", room: "/no-cursors" } as any);

    expect(cursorModuleRequested).toBe(false);
    expect(playhtml.cursorClient).toBeNull();
  });

  it("builds cursors once the cursor client has loaded", async () => {
    let initialized = false;
    const initializing = playhtml
      .init({ host: "http://localhost:1999", room: "/with-cursors", cursors: { enabled: true } } as any)
      .then(() => {
        initialized = true;
      });
    for (let i = 0; i < 10; i += 1) await new Promise((r) => setTimeout(r, 0));
    expect(cursorModuleRequested).toBe(true);
    expect(initialized).toBe(false);
    // The main connection opens while the cursor client downloads.
    expect((globalThis as any).PLAYHTML_TEST_PROVIDERS.length).toBe(1);

    releaseCursorModule();
    await initializing;

    expect(playhtml.cursorClient).not.toBeNull();
  });
});
