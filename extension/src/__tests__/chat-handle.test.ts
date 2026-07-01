// ABOUTME: Tests for the chat-handle module — storage, roll, reroll, profanity filter.
// ABOUTME: Mocks browser.storage.local with an in-memory backing store and globalThis.fetch.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import browser from "webextension-polyfill";
import { getOrCreateHandle, rerollHandle, _resetForTest } from "../features/chat-handle";

const STORAGE_KEY = "wiki_chat_handle";

function setupStorage(): { data: Record<string, unknown> } {
  const data: Record<string, unknown> = {};
  vi.mocked(browser.storage.local.get).mockImplementation((keys: any) => {
    if (typeof keys === "string") return Promise.resolve({ [keys]: data[keys] });
    if (Array.isArray(keys)) {
      const out: Record<string, unknown> = {};
      keys.forEach((k) => { out[k] = data[k]; });
      return Promise.resolve(out);
    }
    return Promise.resolve({ ...data });
  });
  vi.mocked(browser.storage.local.set).mockImplementation((items: any) => {
    Object.assign(data, items);
    return Promise.resolve();
  });
  return { data };
}

function mockFetchOnce(title: string) {
  return vi.fn().mockResolvedValue({
    ok: true,
    json: () => Promise.resolve({ title }),
  } as Response);
}

describe("chat-handle", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupStorage();
    _resetForTest();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns stored handle if present", async () => {
    const { data } = setupStorage();
    data[STORAGE_KEY] = "Tundra Swan";
    _resetForTest();
    const handle = await getOrCreateHandle();
    expect(handle).toBe("Tundra Swan");
  });

  it("rolls a new handle on miss and persists it", async () => {
    globalThis.fetch = mockFetchOnce("Pyotr Stolypin") as typeof fetch;
    const handle = await getOrCreateHandle();
    expect(handle).toBe("Pyotr Stolypin");
    expect(browser.storage.local.set).toHaveBeenCalledWith({ [STORAGE_KEY]: "Pyotr Stolypin" });
  });

  it("retries on profane rolls and returns a clean one", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ title: "Shit Article" }) } as Response)
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ title: "Octopus" }) } as Response);
    globalThis.fetch = fetchMock as typeof fetch;
    const handle = await getOrCreateHandle();
    expect(handle).toBe("Octopus");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("falls back to Anonymous after 5 profane rolls", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ title: "shit" }),
    } as Response);
    globalThis.fetch = fetchMock as typeof fetch;
    const handle = await getOrCreateHandle();
    expect(handle).toBe("Anonymous");
    expect(fetchMock).toHaveBeenCalledTimes(5);
  });

  it("falls back to Anonymous on network failure", async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error("net down")) as typeof fetch;
    const handle = await getOrCreateHandle();
    expect(handle).toBe("Anonymous");
  });

  it("rerollHandle ignores stored value and refetches", async () => {
    const { data } = setupStorage();
    data[STORAGE_KEY] = "Old Name";
    _resetForTest();
    globalThis.fetch = mockFetchOnce("New Name") as typeof fetch;
    const handle = await rerollHandle();
    expect(handle).toBe("New Name");
    expect(browser.storage.local.set).toHaveBeenCalledWith({ [STORAGE_KEY]: "New Name" });
  });
});
