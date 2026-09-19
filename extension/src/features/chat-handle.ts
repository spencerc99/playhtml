// ABOUTME: Reads and changes the background-owned Wikipedia chat article-name.
// ABOUTME: Relays storage changes so every open Wikipedia tab stays in sync.

import browser from "webextension-polyfill";

const STORAGE_KEY = "wiki_chat_handle";

function readHandleResponse(response: unknown): string {
  if (
    response &&
    typeof response === "object" &&
    typeof (response as { error?: unknown }).error === "string"
  ) {
    throw new Error((response as { error: string }).error);
  }
  if (
    !response ||
    typeof response !== "object" ||
    typeof (response as { handle?: unknown }).handle !== "string"
  ) {
    throw new Error("Wikipedia article-name response is missing a handle.");
  }
  return (response as { handle: string }).handle;
}

export async function getOrCreateHandle(): Promise<string> {
  return readHandleResponse(
    await browser.runtime.sendMessage({
      type: "GET_OR_CREATE_WIKIPEDIA_HANDLE",
    }),
  );
}

export async function rerollHandle(): Promise<string> {
  return readHandleResponse(
    await browser.runtime.sendMessage({ type: "REROLL_WIKIPEDIA_HANDLE" }),
  );
}

export async function setHandle(title: string): Promise<string> {
  return readHandleResponse(
    await browser.runtime.sendMessage({
      type: "SET_WIKIPEDIA_HANDLE",
      title,
    }),
  );
}

export function onHandleChange(listener: (handle: string) => void): () => void {
  const handleStorageChange = (
    changes: Record<string, { newValue?: unknown }>,
    areaName: string,
  ) => {
    if (areaName !== "local") return;
    const next = changes[STORAGE_KEY]?.newValue;
    if (typeof next === "string" && next.length > 0) listener(next);
  };
  browser.storage.onChanged.addListener(handleStorageChange);
  return () => browser.storage.onChanged.removeListener(handleStorageChange);
}
