# Load Testing: Performance Findings and Remaining Work

**Date:** 2026-03-11

## Current State

We built a load testing suite (`load-test/`) and ran it against staging. The suite
simulates real playhtml users via the actual SyncedStore + YPartyKitProvider stack.

### Baseline Results (staging, pre-optimization)

| Scenario | What it tests | Degradation | Hard limit (p95>2s) |
|----------|--------------|-------------|---------------------|
| cursor-storm | Pure awareness/presence | None at 2000 users | None |
| fridge | High-freq position writes (5Hz/user) | ~51 users | ~105 users |
| mirror | All users write same key (CRDT contention) | ~50 users | ~123 users |
| live-chat | Append to growing array | ~50 users | ~134 users |

**Key finding:** Awareness scales to 2000+ users. Writes hit a wall at ~50 users.

---

## Root Cause Analysis

The write bottleneck comes from three things compounding in `partykit/party.ts`:

### 1. Supabase autosave encodes and persists the full Y.Doc on every change batch
- `party.ts:83-155` (callback handler)
- Calls `Y.encodeStateAsUpdate(doc)`, base64-encodes it, upserts to Supabase
- At 50+ users writing, this creates constant Supabase pressure
- Staging is worse than local due to higher network latency to Supabase

### 2. Bridge observers fire on every Y.Doc update
- `party.ts:1238-1301` (attachImmediateBridgeObservers)
- Two `yDoc.on("update")` handlers loop through all subscribers/references
- Each calls `getSubscribers()` and `getSharedReferences()` which hit `room.storage.get()`
- Even rooms with NO shared elements pay the async storage read cost per update

### 3. `extractPlaySubtrees` is expensive per subscriber
- `party.ts:451-475`
- Creates a new SyncedStore binding, iterates all tags, filters, calls `.toJSON()`
- Cost is O(tags x subscribers x writes/sec)

### Why cursor-storm survives
No Y.Doc writes = no Supabase calls = no bridge fan-out. Awareness is handled
natively by Y.js's efficient protocol.

---

## Performance Optimizations

### Implemented (in PR wip/load-testing, but reverted from party.ts — needs re-applying)

These were implemented and tested but the party.ts changes were reverted. They need
to be re-applied:

1. **In-memory cache for subscribers/refs/perms** -- Cache `getSubscribers()`,
   `getSharedReferences()`, `getSharedPermissions()` results in instance variables.
   Invalidate on `set*()` calls. Eliminates async storage reads on every update for
   rooms with no shared elements (the common case). This alone moved fridge
   degradation from 51 to 88 users.

2. **Explicit autosave debounce** -- y-partykit supports `debounceWait` and
   `debounceMaxWait` on the callback config. Set to 3s/15s (up from defaults of
   2s/10s). Reduces Supabase upsert frequency under sustained writes.

3. **Debounced bridge fan-out** -- Instead of firing HTTP calls to subscriber rooms
   on every Y.Doc update, accumulate changes and flush every 500ms. Uses a single
   `setTimeout` timer that resets on each update.

### Not yet implemented

4. **Replace SyncedStore with raw Y.js on the server** -- SyncedStore's proxy layer
   adds overhead and has bugs (the `.push()` crash we hit in live-chat). The server
   only uses it in `extractPlaySubtrees` and `assignPlaySubtrees`. Replacing with
   direct Y.Map/Y.Array operations would be straightforward and eliminate the proxy
   overhead.

5. **Batch Supabase writes with a dirty flag** -- Instead of encoding the full doc
   on every callback invocation, set a dirty flag on updates and only persist when
   the flag is set + a minimum interval has passed. Could also skip persistence
   entirely for load-test rooms (they use unique room IDs starting with `load-test-`).

6. **Consider replacing Yjs entirely** -- For most playhtml use cases the data model
   is last-writer-wins, not concurrent editing. Yjs CRDT overhead (tombstones,
   growing doc size, full-doc encoding) may not be justified. The main value Yjs
   provides is the awareness protocol and delta sync. A simpler WebSocket + JSON
   patches + server-authoritative approach could work, but this is a major rewrite.
   The awareness protocol could potentially be kept even without the CRDT doc sync.

---

## Remaining Load Testing Tasks

### Infrastructure

- [ ] **Fix GitHub Actions workflow** -- Workflow is on `wip/load-testing` branch but
  needs to be on `main` to appear in the Actions UI. Merge the PR.
- [ ] **Run clean A/B comparison** -- After re-applying server optimizations, run each
  scenario in isolation (not all 4 simultaneously) from GitHub Actions runners for
  a clean before/after comparison.

### Test improvements

- [ ] **Awareness throughput is choppy** -- The cursor-storm results show awareness/s
  fluctuating wildly (0 to 1389 between snapshots). This may be a measurement
  artifact from how we collect events. Investigate whether this is real server
  behavior or a client-side timing issue.
- [ ] **Error categorization** -- Currently "errors" = disconnects + error events.
  We should distinguish between client-side resource exhaustion (local bottleneck)
  and genuine server errors (connection refused, timeouts).
- [ ] **Cold-join latency** -- The live-chat scenario is designed to test cold-join
  cost as the doc grows, but we don't separately measure join latency for users
  connecting mid-test vs during ramp-up.

### Future scenarios

- [ ] **Mixed workload** -- Real pages have some users dragging, some just watching.
  A scenario with e.g. 20% active writers and 80% passive observers would be more
  realistic than everyone writing.
- [ ] **Doc size growth** -- A scenario that measures how performance degrades as the
  Y.Doc accumulates history (relevant for long-lived pages like the fridge).
