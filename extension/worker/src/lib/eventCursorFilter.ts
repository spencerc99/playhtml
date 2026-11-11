// ABOUTME: Builds PostgREST `or` filters for keyset pagination over collection_events.
// ABOUTME: Orders by (ts, id) so rows inserted between pages never shift or duplicate a page.

function quoteEventCursorValue(value: string): string {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

/** Rows strictly before (ts, id), for newest-first pagination. */
export function getEarlierEventFilter(ts: string, id: string): string {
  const quotedTs = quoteEventCursorValue(ts);
  const quotedId = quoteEventCursorValue(id);
  return `ts.lt.${quotedTs},and(ts.eq.${quotedTs},id.lt.${quotedId})`;
}

/** Rows strictly after (ts, id), for oldest-first pagination. */
export function getLaterEventFilter(ts: string, id: string): string {
  const quotedTs = quoteEventCursorValue(ts);
  const quotedId = quoteEventCursorValue(id);
  return `ts.gt.${quotedTs},and(ts.eq.${quotedTs},id.gt.${quotedId})`;
}
