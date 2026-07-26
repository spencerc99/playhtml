---
"playhtml": patch
---

Internal: consolidate the receive-side peer bookkeeping shared by cursors, element awareness, and page presence into a single per-socket peer-folding layer. When these features share one realtime socket, incoming presence updates are now folded once and dispatched per namespace, so frame-rate cursor traffic no longer wakes element/presence consumers. No public API, wire-format, or behavior changes — old and new clients interoperate unchanged.
