---
"playhtml": patch
---

Internal: consolidate the receive-side peer bookkeeping shared by cursors, element awareness, and page presence into a single per-socket peer-folding layer. When these features share one realtime socket, incoming presence updates are now folded once and dispatched per namespace, so frame-rate cursor traffic no longer wakes element/presence consumers. Shared presence helpers (channel-name constants, byte-capped publish, JSON byte length, peer public-key resolution) now live in one internal module instead of being duplicated across the presence files. No public API, wire-format, or behavior changes — old and new clients interoperate unchanged.
