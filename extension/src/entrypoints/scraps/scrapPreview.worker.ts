// ABOUTME: Derives gallery previews away from the extension page's rendering thread.
// ABOUTME: Receives local image bytes and returns a smaller still or an unchanged-format result.

import { makeScrapImagePreview } from "../../storage/scrapImagePreview";

self.onmessage = async (event: MessageEvent<{ id: number; blob: Blob }>) => {
  try {
    const preview = await makeScrapImagePreview(event.data.blob);
    self.postMessage({ id: event.data.id, preview });
  } catch (error) {
    self.postMessage({
      id: event.data.id,
      error: error instanceof Error ? error.message : String(error),
    });
  }
};
