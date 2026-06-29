# playhtml / we-were-online ATProto lexicons (draft)

Exploratory [ATProto lexicon](https://atproto.com/specs/lexicon) schemas for letting
individual website owners and visitors **own their playhtml data**, and for giving the
"we were online" extension a **personal PDS** for browsing traces.

> ⚠️ **Draft / forward-looking.** These track the still-draft
> [Permissioned data proposal (PR #94)](https://github.com/bluesky-social/proposals/pull/94),
> whose terminology and behavior are explicitly expected to change. Do not build
> production storage against these yet — they exist to make the data-model decisions
> concrete. Background and rationale: `internal-docs/specs/2026-06-28-atproto-permissioned-data.md`.

## Namespaces

- `fun.playhtml.*` — playhtml shared/interactive state (domain: playhtml.fun)
- `online.wewere.*` — "we were online" extension data (domain: wewere.online)

## Records

| NSID | Owner | Purpose |
| --- | --- | --- |
| `fun.playhtml.element` | each writer | One participant's last-write-wins state for a single element in a room. Fits discrete capabilities (`can-move`/`can-toggle`/`can-spin`/`can-grow`). rkey = stable hash of (room + elementId). |
| `fun.playhtml.roomSnapshot` | site owner | Materialized checkpoint of a whole room's state, held in the owner's repo for ownership/export (Option B). rkey = stable hash of room id. |
| `online.wewere.traceSummary` | each user | Privacy-preserving per-window (e.g. daily) aggregate of browsing activity. Raw high-frequency events stay local; only summaries reach the PDS. rkey = window start date. |
| `online.wewere.presence` | each user | Shareable identity/presence for the social "we were online" views, shared within a permissioned Space rather than broadcast publicly. Singleton (`self`). |

## Design notes

- **CRDT vs records.** playhtml's live state is a single merged Yjs document per room;
  ATProto wants discrete per-DID records. `fun.playhtml.element` targets the
  last-write-ish capabilities that map cleanly to records; values that need genuine
  concurrent merge stay in the live CRDT layer. `fun.playhtml.roomSnapshot` is the
  lower-risk "keep Yjs, checkpoint to PDS" path (Option B).
- **Access control, not encryption.** Per PR #94 this layer is access-controlled but not
  E2E encrypted — the sync service can still read/merge, which is what playhtml needs.
- **Anonymity preserved.** Writing to a PDS requires a DID (OAuth sign-in). This is
  strictly opt-in; anonymous, no-login interaction remains the default and these records
  are only produced for signed-in users.
- **Volume.** Extension raw cursor/event streams are far too high-frequency for
  per-event records; only aggregates (`traceSummary`) are persisted to the PDS.
