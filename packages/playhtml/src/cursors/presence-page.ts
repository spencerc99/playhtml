// ABOUTME: Reports the page path a client shares in presence messages.
// ABOUTME: Kept apart from the cursor client so pages without cursors don't load it.
import { MAX_PRESENCE_PAGE_LENGTH } from "@playhtml/common";

export function getPresencePage(): string | undefined {
  const page = window.location.pathname;
  return page.length <= MAX_PRESENCE_PAGE_LENGTH ? page : undefined;
}
