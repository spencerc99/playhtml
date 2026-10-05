// ABOUTME: Console snippet that saves recent scraps and their local image copies to one JSON file.
// ABOUTME: Paste it into DevTools on the extension's scraps page; the quest lab reads the file it downloads.

(async (days = 14) => {
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
  const send = (message) =>
    new Promise((resolve, reject) =>
      chrome.runtime.sendMessage(message, (reply) =>
        chrome.runtime.lastError ? reject(chrome.runtime.lastError) : resolve(reply),
      ),
    );

  // Scraps come back newest first, so paging stops at the first one past the cutoff.
  const scraps = [];
  let cursor;
  for (;;) {
    const page = await send({ type: "GET_SCRAPS", options: { limit: 500, cursor } });
    if (page.error) throw new Error(`GET_SCRAPS failed: ${page.error}`);
    const recent = page.scraps.filter((scrap) => scrap.ts >= cutoff);
    scraps.push(...recent);
    if (!page.nextCursor || recent.length < page.scraps.length) break;
    cursor = page.nextCursor;
  }

  const db = await new Promise((resolve, reject) => {
    const request = indexedDB.open("scrap_image_copies_db");
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  const get = (store, key) =>
    new Promise((resolve, reject) => {
      const request = db.transaction(store, "readonly").objectStore(store).get(key);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  const toDataUrl = (blob) =>
    new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(blob);
    });

  const images = {};
  let missing = 0;
  for (const scrap of scraps) {
    if (scrap.kind !== "image" || images[scrap.src]) continue;
    const source = await get("sources", scrap.src);
    const row = source && (await get("blobs", source.hash));
    if (row) images[scrap.src] = await toDataUrl(row.blob);
    else missing += 1;
  }

  const file = {
    format: "wwo-scraps-export",
    version: 1,
    exportedAt: Date.now(),
    days,
    scraps,
    images,
  };
  const link = document.createElement("a");
  link.href = URL.createObjectURL(new Blob([JSON.stringify(file)], { type: "application/json" }));
  link.download = "wwo-scraps-export.json";
  link.click();
  console.log(
    `Saved ${scraps.length} scraps from the last ${days} days, ${Object.keys(images).length} image copies (${missing} images had no local copy).`,
  );
})();
