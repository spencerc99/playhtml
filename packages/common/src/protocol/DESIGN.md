# Version 2 operation protocol schema

This module defines the data contract shared by the version 2 client and room
server. It does not validate, apply, persist, or transport operations.

## State and addresses

`RoomState` keeps the current user-visible values as plain JSON:

```ts
{
  [capability]: {
    [elementId]: value,
  },
}
```

Every operation includes `capability`, `elementId`, and a path relative to that
element's value. The empty path addresses the entire element value. A string
path segment addresses an object property. An `{ itemId }` segment addresses
an array item.

Paths do not contain array indices. An index changes when another operation
inserts or removes an earlier item. A delayed operation that used an index
could therefore update or remove the wrong value. Stable item IDs keep the
same target as the array moves.

`RoomSnapshot.arrays` stores the item IDs for every array in the state. Each
entry identifies an array by its capability, element ID, and stable path, then
lists IDs in the same order as the visible array values. This sidecar keeps
protocol metadata out of application data. The server must persist it with
the state and return it in every full snapshot. Conversion can assign IDs to
existing array values once, but later loads must retain those IDs.

`set` and `insert` can introduce arrays anywhere inside their values. Their
`arrays` field carries identities for every introduced array, using paths
relative to the operation value. Requiring this metadata on the operation lets
the optimistic client and server install the same identities without deriving
them independently. The list is empty when the value contains no arrays.

Rejected alternatives:

- JSON Pointer strings require escaping and do not distinguish object keys
  from array positions. Structured segments are unambiguous on the wire.
- Numeric array path segments are compact but can retarget delayed operations.
- Encoding arrays as keyed objects would expose protocol metadata through the
  existing `setData` API and break array methods used by current sites.
- Keeping array IDs only in server memory would make paths invalid after a
  restart or reconnect.
- Deriving IDs independently from array indices would couple identity to an
  algorithm outside the wire contract and could make optimistic paths differ
  from server paths.

## Operations

`set` replaces the value at its path. An empty path replaces the element's
whole value. Concurrent sets to the same path use server order, so the last
accepted set wins.

`increment` adds `delta` to the number at its path. The apply engine must reject
non-finite deltas and non-numeric targets. Keeping increment distinct from set
lets every accepted increment survive concurrency.

`insert` addresses a container with `path`, then identifies the entry to add:

- Object inserts carry a `key`. The apply engine must reject an occupied key,
  except when it recognizes an idempotent retry of the same operation. Callers
  that need additive map entries must choose globally unique keys.
- Array inserts carry a requested `index` and a globally unique `itemId`. The
  index controls placement, while the ID controls identity. Two clients can
  append at the same index without colliding because their item IDs differ.
  The server applies both in sequence order. If concurrent removals shorten
  the array below the requested index, the apply engine should place the item
  at the end so an accepted additive insert is not lost. Negative,
  non-integer, and unsafe integer indices are invalid.

Using only an array index was rejected because indices are not identities.
Using fractional position strings was also rejected. They require allocation,
normalization, and tie-breaking rules while the server already provides a
total order. A stable ID plus server-ordered numeric placement preserves every
insert with less protocol machinery.

`remove` addresses a container with `path`. It removes an object property by
key or an array entry by stable item ID. It does not remove whatever value
happens to occupy a numeric position. Removing a missing target should be an
idempotent no-op so redelivery is safe.

The future apply engine should reject traversal through a missing path or a
value of the wrong container type. It should not create implicit objects or
arrays because a malformed operation could otherwise produce valid-looking
state with an unintended shape.

## Ordering, retries, and resets

Each client generates a random `clientId` and numbers its operations with a
per-client sequential `mutationId`, following Replicache's lastMutationID
design. The server tracks the highest applied mutation number per client and
ignores anything at or below it, which makes retries and reconnect replays
exactly-once and in-order per client. The `lastMutationIds` map is persisted
with the room state (a restart cannot double-apply a replay) and returned in
every snapshot (a reconnecting client discards confirmed pending operations).
The map is bounded by pruning entries for clients not seen for a retention
window, not by operation count. The broadcast echo carries the same
`clientId` and `mutationId` so the sender can retire the matching optimistic
operation.

On reconnect the client rebases, also per the Replicache model: it replaces
its authoritative copy with the server snapshot, discards pending operations
confirmed by `lastMutationIds`, and replays the remainder on top. The replay
is invisible to application code.

Adopted from Replicache with modification: Replicache replays named mutator
functions server-side, which lets application code arbitrate conflicts. That
does not transfer here because the room server is generic infrastructure that
cannot run per-site application code. Low-level operations keep the server
generic; the `increment` operation preserves intent for the one case where
replaying a recorded write would lose information. Replicache's cookie-based
minimal diffs were considered and skipped: room snapshots are small (median
room state is under a kilobyte), so full snapshots on reconnect are cheaper
than diff bookkeeping. Its cross-tab pending-mutation persistence is deferred
to a future offline tier.

The server assigns each accepted operation a monotonically increasing
`sequence`. `SequencedOperation` is the broadcast envelope sent to every
connection, including the sender. This is the only conflict order. Client
timestamps, arrival timestamps, and vector clocks are not part of the schema.

Every operation and snapshot also carries a room `generation`. A hard reset
increments the generation. The server rejects pending operations from an
earlier generation so a stale client cannot restore data removed by the reset.

Rejected alternatives:

- Client timestamps can disagree and are not an authority for room order.
- Vector clocks solve peer-to-peer merge ordering that this single-threaded
  room server does not need.
- A protocol without operation IDs cannot distinguish a retry from a second
  intentional operation, which breaks idempotent reconnect replay.

## Messages and reconnects

Every wire message carries `protocolVersion: 2`. A client submits one operation
per `operation` message. Keeping operations separate makes each acceptance,
sequence assignment, rejection, echo, and retry independently observable.

The server sends a full `snapshot` on initial connection and in response to a
`snapshot-request`. The snapshot includes visible state, array identities,
the current sequence, and the room generation. After reconnect,
the client replaces its authoritative copy with this snapshot and resubmits
still-pending operation IDs against that generation. Reconciliation behavior
belongs to the client store, not this schema module.

The server can reject malformed, unauthorized, oversized, stale-generation,
or unsupported-version writes with `operation-rejected`. The optional
`operationId` is absent when a malformed message cannot be associated with an
operation. The human-readable message is for diagnostics; client behavior
should branch on `code`.

Presence remains on its existing message contract. Combining durable room
operations and ephemeral presence in one union was rejected because they have
different ordering, persistence, size, and failure semantics.
