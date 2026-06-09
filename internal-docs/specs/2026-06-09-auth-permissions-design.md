# playhtml Identity, Auth & Permissions — Design

**Status:** draft for review
**Date:** 2026-06-09
**Prior art:** PR #43 (`identity` branch), `partykit/sharing.ts` (element-level read-only),
`website/events/walking-together/admin.ts` (name+color admin hack), extension ECDSA identity
(`extension/src/entrypoints/background.ts`), `website/components/Permissions.tsx` (keys/locks
marketing mockup).

---

## 1. Goals

1. **One stable identity per person** across playhtml sites:
   - Extension users: the extension's existing ECDSA P-256 keypair (`pk_…` public key) is the
     canonical identity.
   - Anonymous users (no extension): a library-generated keypair persisted in the browser, same
     format, same verification path. No accounts, no emails, no OAuth.
2. **A developer API for permission-gated behaviors** that feels like playhtml: declarative
   first (HTML attributes / init config), imperative escape hatches, React hooks.
3. **Actually secure when it claims to be** — a key-exchange (challenge–response) handshake so
   the server can verify "this connection really holds the key for `pk_X`", and server-side
   enforcement for gated writes. Clearly separate "UX gating" (client-only, spoofable) from
   "enforced" (server-verified).
4. **Near-zero performance impact**: no per-message crypto, no extra round trips for sites that
   don't opt in, and costs proportional to the number of *gated* elements, not all elements.
5. **Seamless**: zero-config for anonymous identity; extension integration "just works" via the
   existing `playhtml:configure-identity` bridge, upgraded to support signing.

### Non-goals (v1)

- Account recovery / multi-device identity sync (extension backup covers extension users;
  anonymous identity is per-browser and lossy by design).
- Encrypting room data, private rooms, or read-permissions on the Yjs doc (everyone in a room
  can still *read* everything; we gate *writes*). Read-gating a CRDT requires
  encryption-at-rest per subtree and is a much bigger project.
- Federated/DNS-verified display names.

---

## 2. What exists today (and what we learned)

### Current state (main)

| Piece | State |
|---|---|
| Extension identity | Real ECDSA P-256 keypair; public key `pk_` + 130 hex; private key stored in `browser.storage.local` but **never used** — nothing is signed anywhere |
| Library identity | `generatePersistentPlayerIdentity()` makes a **fake** publicKey (random hex, no actual key) in `localStorage["playhtml_player_identity"]` |
| Extension → page | `playhtml:configure-identity` CustomEvent injects `{ publicKey, playerStyle }`; page trusts it blindly |
| Awareness | `getStableIdForAwareness()` uses the claimed publicKey; unvalidated |
| Permissions | Element-level `shared="read-only"` (client-enforced only); walking-together's `isAdmin(name, color)` (trivially spoofable, self-described as "not a security boundary") |
| Server | No identity on connections; one global `ADMIN_TOKEN` for admin endpoints; rate limit per connection |

### Lessons from PR #43 (`identity` branch)

The prior attempt got several things right (challenge-signing over the existing Yjs WebSocket,
session-based auth instead of per-action signing, roles in init config, HTML attribute
shorthand) and we keep those ideas. It failed on:

1. **No actual enforcement.** Session actions were validated and broadcast, but raw Yjs sync
   updates bypassed the entire path — any client could still mutate anything. Enforcement of a
   CRDT doc is *the* hard problem; the design below addresses it head-on (§6).
2. **Client-generated challenge.** The client invented its own challenge and signed it; a
   recorded signature was replayable within the timestamp window. Challenges must be
   server-issued, single-use, and bound to room + origin.
3. **Sessions in an in-memory `Map` + `setInterval`.** Durable Objects hibernate; sessions and
   nonces evaporated. State must live in DO storage (and `setInterval` in a DO constructor is
   wasted anyway).
4. **Every write became async.** `checkPermission()` was awaited inside `onChange` for *all*
   elements, gated or not. Permission checks must be synchronous against a resolved cache, and
   only gated elements should pay any extra cost.
5. **Private keys as extractable base64 in localStorage.** Any XSS exfiltrates the identity
   forever. Use non-extractable `CryptoKey`s in IndexedDB.
6. **Permission *logic* lived in spoofable places** (DOM attributes, client functions) with no
   story for how the server learns the rules. §7 fixes this with domain-bound config.

---

## 3. Identity model

One type, one verification path, two provenances:

```ts
interface PlayerIdentity {
  publicKey: string;        // "pk_" + hex(P-256 raw public key) — same format as extension
  name?: string;
  playerStyle: { colorPalette: string[]; cursorStyle?: string };
  source: "extension" | "local";   // NEW: where the key lives
  createdAt: number;
}
```

- **Algorithm: ECDSA P-256 everywhere.** The extension already uses it, WebCrypto supports it
  in every browser (unlike Ed25519, which is still inconsistent), and verify cost is fine
  because we verify once per connection, not per message.
- **Anonymous users get a real keypair**, generated lazily at init:
  - Private key: generated `extractable: false`, stored as a `CryptoKey` object in IndexedDB
    (`playhtml-identity` DB). XSS can *use* it while the page is open but can never exfiltrate
    it. This is strictly better than PR #43's base64-in-localStorage.
  - Public key + display fields: localStorage (sync access at startup, same as today).
  - Keygen is ~1ms, one-time. No network involved.
- **Extension users:** the extension keeps its private key in the background script — it
  *never* crosses into page context. The existing `playhtml:configure-identity` event keeps
  injecting the public identity; signing happens via a new request/response bridge (§5).
- **Precedence:** extension identity overrides local identity when present (current behavior).
  The local keypair is kept around (not deleted) so removing the extension falls back to the
  same local identity.

### Migration note (flagging per repo policy)

Existing anonymous users have fake random-hex publicKeys persisted in localStorage. Those
can't be verified (there's no key behind them). On upgrade the library generates a real
keypair, which **changes the pid for existing anonymous users**. Anything keyed by pid in live
rooms (walking-together rosters, presence history) will see these users as new people. This is
a one-time, per-anonymous-user discontinuity. Options: (a) accept it (recommended — these pids
are mostly ephemeral presence, and extension users are unaffected); (b) keep the legacy pid as
a `legacyPid` field and let sites that care do their own remapping. Either way: **do not**
reuse the fake pid as a real one — the formats should be distinguishable (`pk_` prefix +
valid-curve check already distinguishes them).

### Privacy consideration

A single stable pid across all playhtml sites is a cross-site identifier. This matches the
extension's existing model (one pid across sites is what makes "follow someone across pages"
work), so it's an accepted product decision — but we should (a) document it, (b) make
`playhtml.identity.reset()` a real API (new keypair on demand), and (c) leave room for
per-origin derived subkeys as future privacy work (the handshake in §5 already binds
signatures to origin, so derived keys would be a drop-in change later).

---

## 4. Developer API

The principle: **permissions are data, not code, wherever possible** — because data (key
lists, rules) can be mirrored to the server and enforced, while arbitrary client functions
cannot. Client functions remain available as explicitly-advisory conditions.

### 4.1 Declaring rules — init config

```ts
playhtml.init({
  permissions: {
    // Roles: name -> list of public keys, or a client-side condition fn (advisory only)
    roles: {
      admin: ["pk_04a1…"],                       // enforceable
      regular: ({ visitCount }) => visitCount > 3, // client-only, marked in types
    },

    // Rules: element selector -> action -> who
    rules: [
      { match: "#site-title",      write: "admin" },
      { match: "[data-note]",      create: "anyone", update: "creator", delete: ["creator", "admin"] },
      { match: "#guestbook",       write: "verified" },   // any verified identity (did handshake)
    ],
  },
});
```

- **Actions** are `read` (reserved, see non-goals), `write` (any `setData`), and for keyed-map
  collection data: `create` / `update` / `delete` keyed-entry granularity (§6.3).
- **Built-in roles:** `anyone` (default), `verified` (completed the handshake — i.e. "is a real
  keyholder, not necessarily a known one"), `creator` (the pid recorded on a collection entry
  at create time), `admin`-style roles are user-defined.
- **HTML shorthand** for the common case, merged with init rules:

```html
<h1 id="site-title" can-play permissions="write:admin">…</h1>
```

### 4.2 Reading permissions — imperative + React

```ts
playhtml.me.pid                 // stable id (string)
playhtml.me.source              // "extension" | "local"
playhtml.me.verified            // boolean — handshake completed this connection
playhtml.me.roles               // string[] — resolved for this room, cached
playhtml.can("write", "#site-title")   // boolean, SYNCHRONOUS (resolved-cache lookup)
playhtml.on("identitychange", cb)      // fires on extension inject, reset, verify
```

React (extends the existing `usePlayerIdentity()`):

```tsx
const { pid, name, color, verified, roles } = usePlayerIdentity();
const canEdit = useCan("write", "#site-title");   // re-renders on identitychange

<CanToggle permissions={{ write: "admin" }}>…</CanToggle>
```

`can()` must be synchronous so it's usable in render paths and `updateElement` without making
writes async (PR #43's mistake). Role resolution happens once at init / identitychange and is
cached; condition functions are evaluated then, not per-check.

### 4.3 Gated behavior in custom elements (`can-play` / `withSharedState`)

```tsx
withSharedState(
  {
    defaultData: { entries: {} },
    permissions: { write: "verified", delete: "creator" },
  },
  ({ data, setData, can }, ref) => (
    <button
      disabled={!can("write")}
      onClick={() => setData(/* … */)}
    />
  )
);
```

- `setData` on a gated element from an unauthorized user: **no-op + console warning + a
  `permissiondenied` event** on the element (so UIs can shake/toast). It must not throw —
  graceful degradation is the playhtml way.
- The render callback gets `can()` scoped to the element so disabling affordances is one-liner.

### 4.4 What replaces the walking-together hack

```ts
playhtml.init({
  permissions: {
    roles: { admin: [SPENCER_PK] },
    rules: [{ match: "[data-wt-admin]", write: "admin" }],
  },
});
// in component:  const isAdmin = usePlayerIdentity().roles.includes("admin");
```

Same ergonomics as `isAdmin(name, color)`, actually bound to a key, and server-enforceable.

---

## 5. Key exchange: the verification handshake

Goal: the server learns, once per connection, "this WebSocket is held by the owner of
`pk_X`" — with no per-message overhead and no replay.

### Protocol (over the existing Yjs WebSocket — no extra connection)

```
1. connect      client ──── ws connect (normal yjs sync starts immediately) ───▶ server
2. challenge    client ◀─── { type:"auth_challenge", nonce, roomId, ts } ─────── server
                              (only sent if the room has enforceable rules OR
                               the client requested verification)
3. response     client ──── { type:"auth_response", pid,
                              sig = Sign(privKey, nonce|roomId|origin|ts|"playhtml-auth-v1") } ─▶
4. verified     client ◀─── { type:"auth_ok", pid, sessionToken, expiresAt } ─── server
                              connection state tagged verifiedPid = pid
```

- **Server-issued, single-use nonce** (fixes PR #43's client-generated challenge). Signature
  binds `roomId` + `origin` + a protocol label, so it can't be replayed against another room,
  site, or protocol.
- **Sync is never blocked.** The handshake runs in parallel with Yjs sync; until it completes
  the connection simply has `anyone`-level write access. Gated UI shows in its "locked" state
  and unlocks on `auth_ok` (an `identitychange` fires client-side).
- **Session resumption:** `auth_ok` includes an opaque random `sessionToken` (stored
  sessionStorage, sent as a query param or first message on reconnect). Server keeps
  `token → pid` in **DO storage** with TTL (~24h), so reconnects skip the signature — and,
  crucially for extension users, skip the extension round trip. Survives DO hibernation
  (fixes PR #43). Tokens are bearer secrets over WSS only; scoped per room.

### Who signs

- **Local identity:** the page signs directly with the IndexedDB `CryptoKey`. ~0.5ms.
- **Extension identity:** the page can't touch the extension's private key (good). New bridge,
  symmetric with the existing configure-identity event:

```
page ── CustomEvent "playhtml:sign-challenge" {challengeId, payload} ──▶ content script
content script ── runtime.sendMessage ──▶ background (holds the key)
background: validates payload SHAPE — must be a playhtml-auth-v1 challenge whose
            origin field === sender tab's actual origin; signs; returns
page ◀── CustomEvent "playhtml:sign-response" {challengeId, signature} ──
```

  **Why shape validation matters:** any page script can fire this event. The extension must
  only ever sign structured `playhtml-auth-v1` challenges where it independently verifies the
  origin binding (from the sender tab, not the payload) — never arbitrary bytes. Then the worst
  a malicious page can do is obtain a signature valid only for a playhtml session *on that
  page's own origin*, which it could get anyway by being the page.
- This finally gives the extension's stored-but-never-used private key a job.

### What verification does NOT claim

`verified` ≠ trusted/known. It means "stable keyholder", which is what gating logic needs
(`creator`, key-listed roles). Sybil resistance is out of scope: anyone can mint infinite
fresh keys. Rules like `write: "verified"` are about *attributable* writes, not scarcity.

---

## 6. Server-side enforcement (the hard part)

The fundamental problem with permissions over Yjs: the sync protocol is "apply this opaque
update", and clients can send any update. PR #43 ignored this. Three honest options:

| Approach | How | Verdict |
|---|---|---|
| A. Inspect & reject updates | Decode every incoming Yjs update server-side, find touched keys, drop unauthorized updates | Per-message decode cost on the hot path for *everyone*; dropping updates desyncs the sender's client (their local doc applied it) — needs forced resync. Rejected. |
| B. Server-mediated writes for gated elements | Gated `setData` goes as an explicit action message; **server is the only writer** of gated keys into the doc | Clean authority story; cost only on gated writes; sync path untouched. **Chosen** for the write path. |
| C. Observe & correct | Server observes doc; transactions touching gated keys that didn't originate from the server get overwritten with the authoritative value | Can't *prevent*, only repair (brief flicker for cheaters); but cheap (O(gated keys) map lookups per transaction) and catches clients that bypass the library. **Chosen** as the backstop for B. |

### 6.1 Write path for gated elements (B)

```
client setData("#site-title", data)
  └─ library knows #site-title is gated (resolved rules cache)
  └─ sends { type:"gated_write", elementId, data, opId } over ws
  └─ OPTIMISTIC: applies locally to a local-only overlay (not the shared doc)
server:
  └─ rule lookup: write on #site-title requires "admin"
  └─ connection.verifiedPid in roles.admin?  → write data into the Y.Doc (server origin),
                                               persist authoritative copy in DO storage
  └─ else → { type:"gated_write_rejected", opId, reason } ; client reverts overlay,
             fires `permissiondenied`
```

- Latency: one RTT to a server you're already connected to — the same RTT every normal write
  already takes to *propagate*; authorized users won't perceive a difference thanks to the
  optimistic overlay.
- Non-gated elements: **completely untouched code path.** This is the key perf property.

### 6.2 Backstop (C)

Server keeps `gatedSnapshot: { [elementId]: lastAuthoritativeValue }` in DO storage. A doc
observer checks each transaction: if origin ≠ server and the transaction touched a gated key,
re-apply the snapshot value (server write wins because it's causally later). Cost per
transaction: one Set intersection between changed top-level keys and gated keys — nanoseconds
when the gated set is empty.

### 6.3 `creator`-scoped rules on collections

For keyed-map collections (the pattern CLAUDE.md already mandates), entries get
`createdBy: pid` stamped server-side at create time (client-supplied `createdBy` is ignored).
`update: "creator"` then checks the *target entry key*'s recorded creator against the
connection's verifiedPid. This only works through the gated-write path (B) — which is fine,
because that's the only path gated elements use. This rules out array-shaped gated
collections; docs should say so explicitly (arrays are already discouraged).

### 6.4 How the server learns the rules (config authority)

Rules sent by a connecting client can't be trusted (an attacker connects directly with
permissive rules). We need domain-bound authority without accounts:

**The server fetches `https://<domain>/.well-known/playhtml.json`** (room ids already derive
from domain+path, so the domain is known). Whoever controls the domain's content controls the
rules — the same trust model as the site itself. Works on Neocities/GitHub Pages/etc. (it's
just a static file).

```json
{
  "roles": { "admin": ["pk_04a1…"] },
  "rules": [
    { "path": "/wall", "match": "#site-title", "write": "admin" }
  ]
}
```

- Fetched lazily on first connection to a room, cached in DO storage,
  stale-while-revalidate (TTL ~5 min). One subrequest per room per TTL — negligible.
- **No file → no server enforcement** for that domain; client-declared rules still run as UX
  gating, and `playhtml.can()`/types surface `enforced: false` so developers know which mode
  they're in. This makes the whole feature progressively-enhancing: copy-paste users get UX
  gating with zero setup; one static file upgrades it to real enforcement.
- Client init rules and well-known rules can disagree; well-known wins server-side, and the
  library warns loudly in dev mode when it detects drift.

---

## 7. Performance budget

| Cost | When | Magnitude |
|---|---|---|
| Keypair generation | once per browser, first visit | ~1ms, async |
| Challenge sign (local key) | once per connection | ~0.5ms |
| Challenge sign (extension bridge) | once per connection (skipped on token resume) | one event round trip + sendMessage, ~5–20ms, off critical path |
| Server verify | once per connection | ~0.5ms |
| Session resume | reconnects within TTL | string compare, no crypto |
| `can()` checks | per call | sync Map lookup |
| Gated write | per gated `setData` | 1 RTT (optimistic-masked) + one storage put |
| Backstop observer | per server transaction | Set intersection; ~0 when no gated keys |
| Config fetch | per room per 5 min | one subrequest |
| Sites not using any of this | — | **zero**: no challenge sent, no observer keys, no fetch, code lazy-loaded behind the `permissions` config flag |

No per-message signing or verification anywhere — that's the line we must hold.

---

## 8. Phasing

**Phase 1 — Identity foundation** *(packages/common, packages/playhtml, extension)*
Real P-256 keypair for anonymous users (IndexedDB non-extractable); unify `PlayerIdentity`
with `source`; `playhtml.me` / `identitychange`; extension sign-challenge bridge (background
handler + content relay); changesets + migration note for the pid discontinuity.
*Shippable alone: gives every site verified-capable identities; nothing visible breaks.*

**Phase 2 — Client-side permissions API** *(packages/playhtml, packages/react, docs)*
`permissions` init config, `permissions` attribute, resolved-role cache, sync `can()`,
`useCan()`, `permissiondenied` events, gating inside `setData` (local check), walking-together
migrated to it as the dogfood. Documented honestly as UX gating, not security.
*Shippable alone: replaces the admin hack and unlocks the API for site builders.*

**Phase 3 — Handshake + server enforcement** *(partykit, packages/playhtml)*
Server-issued challenge, verify, DO-storage sessions; `.well-known/playhtml.json` fetch +
cache; gated-write action path with optimistic overlay; snapshot backstop observer; load-test
scenario (note: per CLAUDE.md, soak tests won't catch data-shape issues — test gated rooms
against pre-seeded legacy data).
*This is the phase where `verified`/`enforced` become true.*

**Phase 4 — Niceties** *(later, separate designs)*
Identity linking (old key signs new key) for extension-install upgrades; audit log of gated
writes (who/when — the data's already flowing through the server); revocation (delete a pid
from a role and kill its sessions); per-origin derived subkeys for privacy; read-gating via
encrypted subtrees (big).

---

## 9. Open questions for Spencer

1. **pid discontinuity for anonymous users** (§3 migration note) — accept the one-time break,
   or carry `legacyPid`? Recommend: accept.
2. **`.well-known/playhtml.json`** as the config authority — happy with "control the domain =
   control the rules"? Alternative is a hosted dashboard/registry (accounts, more infra).
   Recommend: well-known file; a registry can layer on later for apex-domain-less users.
3. **Optimistic overlay vs. wait-for-server on gated writes** — overlay adds client complexity
   (a local shadow that reverts); waiting adds ~RTT of perceived lag for authorized users.
   Recommend: ship Phase 3 with wait-for-server (simpler, gated writes are rare), add the
   overlay if it feels sluggish.
4. **Should `verified` require the handshake even on sites with no rules?** (i.e. always
   challenge when an identity exists) — costs one signature per connection everywhere.
   Recommend: no; challenge only when rules exist or the page calls
   `playhtml.identity.verify()` explicitly.
5. Naming: `permissions`/`can()`/`me` vs. leaning into the keys-and-locks metaphor from the
   marketing mockup (`keys`, `locks`, `holdsKey()`). The metaphor is charming and very
   playhtml; the plain names are clearer in code. Recommend: plain names in API, metaphor in
   docs/marketing.
