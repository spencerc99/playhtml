// ABOUTME: Matches keyboard shortcuts that open the cursor emote wheel.
// ABOUTME: Keeps extension and embedded-site shortcut behavior testable.

export type EmoteShortcut = "modifier-e" | "bare-e";

interface EmoteShortcutEvent {
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
}

export function matchesEmoteShortcut(
  event: EmoteShortcutEvent,
  shortcut: EmoteShortcut,
  isMac: boolean,
  isTyping: boolean,
): boolean {
  if (isTyping || (event.key !== "e" && event.key !== "E")) return false;
  if (shortcut === "bare-e") {
    return !event.metaKey && !event.ctrlKey && !event.altKey;
  }
  const commandKey = isMac ? event.metaKey : event.ctrlKey;
  return commandKey && event.shiftKey;
}
