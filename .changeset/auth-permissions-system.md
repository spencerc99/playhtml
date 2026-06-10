---
"playhtml": minor
"@playhtml/common": minor
"@playhtml/react": minor
---

Add an identity, authentication, and permissions system. Anonymous users now get a real ECDSA P-256 keypair (non-extractable private key in IndexedDB) whose public key becomes their stable pid, in the same `pk_…` format the "we were online" extension uses — extension identities take precedence via the existing `playhtml:configure-identity` bridge. A new `permissions` init option declares roles (public-key lists or client-side condition functions) and rules gating element writes; checks are synchronous via `playhtml.can()` / the new `useCan()` React hook, `usePlayerIdentity()` now reports `verified` and `roles`, and denied writes fire a `permissiondenied` event instead of writing. When a site publishes `/.well-known/playhtml.json`, the partykit server enforces those rules for real: connections prove key ownership through a challenge–response handshake over the existing WebSocket (one signature per connection, session-token resume on reconnect, zero per-message crypto), and writes to gated elements are server-mediated — including keyed-collection entry rules (`create`/`update`/`delete` with a built-in `creator` role, server-stamped `createdBy`). Sites that don't opt in pay no cost. Note: existing anonymous users' pids change once when the fake random-hex publicKey is upgraded to a real key.
