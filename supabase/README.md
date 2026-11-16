# Supabase database

This directory is the source of truth for the Supabase project shared by the extension and
PartyKit. It gives local development, pull requests, and production one ordered migration
history.

## Migration ownership

All schema changes go in `supabase/migrations/`, even when only one application uses the affected
tables. Prefix migration names with the owning area so the shared history stays easy to scan:

```sh
bun run db:new -- extension_add_event_archive
bun run db:new -- partykit_add_room_redirects
```

Do not add migrations under `extension/db/migrations/`. Those files record extension database
changes outside the native Supabase migration history.

## Local development

The local stack requires Docker or another Docker-compatible container runtime.

```sh
bun run db:start
bun run db:reset
bun run db:lint
bun run db:stop
```

`db:start` preserves data in the local Docker volume between runs. `db:reset` recreates the
database from `supabase/migrations/` and then loads `seed.sql`, which is empty in this repository.
`db:verify` runs the reset and database lint together.

To run PartyKit against the local database:

```sh
cp partykit/.dev.vars.example partykit/.dev.vars
bun run dev-server:local-db
```

To run the extension Worker against the local database:

```sh
cp extension/worker/.dev.vars.example extension/worker/.dev.vars
bun run dev-extension-worker:local-db
```

Both commands create `.dev.vars.supabase` from the running local stack. Wrangler loads that file
after the Worker's `.dev.vars`, so the local Supabase URL and key override any hosted database
credentials. Other Worker secrets still come from the Worker's `.dev.vars`.

The generated file contains local development credentials and is ignored by Git. Existing
`dev-server` and extension development commands keep their current database configuration.

## Production project

The production project uses PostgreSQL 15 and is linked locally by project reference:

```sh
bunx supabase login
bunx supabase link --project-ref ptirehwbzcdbzomsxmji
bunx supabase migration list
```

The migration history includes the production schema baseline and the earlier recorded extension
index removal. `migration list` must show the same timestamps locally and remotely before enabling
production deployment or running `db push`.

Create and test every schema change locally. Do not change production through the Dashboard SQL or
Table editors because those changes bypass the repository migration history.

## Pull request previews

After the production baseline is verified:

1. Connect this repository under Supabase **Project Settings → Integrations → GitHub**.
2. Set the working directory to `.`.
3. Enable automatic branching and **Supabase changes only**.
4. Require the `Supabase Preview` check in the GitHub ruleset for `main`.
5. Enable production deployment from `main`.

Supabase creates an isolated database for pull requests that change `supabase/**`. It runs the
migrations and seed file there. Merging the pull request applies new migrations to production and
deletes the preview database.

The preview database has its own URL and keys. The Cloudflare Workers do not use those credentials
automatically; integration tests or a Worker preview deployment must receive them explicitly.

## Internet map rollups

The `internet_map` schema aggregates navigation and metadata inside PostgreSQL. The private
internet-map fork downloads these aggregates with `internet_map_reader` and builds the map.
The reader cannot read source tables, write aggregates, or run the rollup. The schema is not
exposed through the Data API.

The migrations create functions, tables, and source-change triggers. They do **not** create a
login, enable an extension, schedule cron, or configure GitHub. Those are separate approval
steps below. No production commands were run during implementation.

### Process history and new events

`internet_map.rollup(until_ts, chunk)` processes one half-open timestamp range and commits
with its caller. The cutoff must be at least one hour old. Each chunk spans at most one day
and at most 5,000 navigation rows plus 5,000 metadata rows. Rows with the same timestamp stay
together; more than 5,000 rows at the starting timestamp stops the run for operator review.
The default chunk is one hour. `rollup_state.watermark` advances only when the transaction
succeeds. Retrying a committed range does no work.

`internet_map.refresh(max_chunks, chunk)` calls the function repeatedly and commits each
chunk. Call the procedure outside a transaction. It defaults to 48 chunks, sufficient for an
ordinary day at current volume; the bake refuses snapshots more than 30 hours behind. A
backfill can repeat the procedure until the watermark reaches one hour ago.

Session state preserves the last event timestamp for jumps and the first timestamp of each
collapsed page run for triples. Repeated A → B → C occurrences count separately, including
within one session, matching `07_paths.py`. Jump weights count distinct sessions. Audience
membership tables provide page, host, and domain co-visitation without exporting visit rows.
Metadata uses a separate timestamp predicate in the same transaction, so metadata-only
chunks also advance correctly.

Inserts, edits, or deletes behind the watermark set `invalid_since`. The next rollup and bake
then fail. Updates to metadata validity or observation timestamps alone do not invalidate it.
This intentionally detects late data instead of silently omitting it. Source writes briefly
wait for the current chunk's state lock; measure this latency locally before rollout. Source
history must remain available until initial backfill and any approved rebuild finish. Changing
the normalization rules also requires an approved rebuild of the aggregates.

### Verify locally

Use a fresh local stack. `db:reset` deletes the local database contents.

```sh
bun run db:start
bun run db:verify
psql -X -v ON_ERROR_STOP=1 postgresql://postgres:postgres@127.0.0.1:54322/postgres \
  -f supabase/operators/internet_map_reader.sql
psql -X -q -v ON_ERROR_STOP=1 postgresql://postgres:postgres@127.0.0.1:54322/postgres \
  -f supabase/tests/internet_map.sql
```

The SQL test rolls back its synthetic records. It checks chunk parity, retries, the two
session timestamp rules, rejected URLs, metadata votes, access restrictions, and late-event
invalidation. Run two concurrent `rollup` calls against the synthetic fixture before rollout
and confirm that committed totals match one call. Also insert a backdated row while a chunk
holds the state lock; after both transactions commit, `invalid_since` must be set. The nightly
`CALL` needs a local cron integration check because it commits between chunks.

The private parity harness requires the fork's `requirements-bake.txt`. It rejects database
endpoints other than loopback port 54322 and refuses nonempty source tables. It retains the
sample and diagnostics outside both repositories; exceptions never print source values.

```sh
python supabase/tests/internet_map_parity.py \
  --fork "$HOME/Data/playhtml-private/tools/internet-map-rollups" \
  --raw "$HOME/Data/playhtml-private/builds/20261010T053743Z/raw" \
  --full-intermediates "$HOME/Data/playhtml-private/builds/20261010T053743Z/g" \
  --scratch "$HOME/Data/playhtml-private/scratch-rollups/parity"
```

Use `--reuse --incremental` to reuse a prepared sample after starting the local database.
The incremental check loads two chronological batches, reconnects during backfill and between
batches, and requires a session to continue across their boundary within 30 minutes. The
default sample
contains 100,000 events, 25,000 metadata rows, and 125,000 URL/title cases. The report separates
Python membership-file parity from SQL parity. A successful Python comparison does not prove
the migration or database loader works. SQL mismatches produce a failing status and private
examples in `url-mismatches.json`; investigate every mismatch before production approval.
`rollup_parity` compares Python visits in timestamp/id order; `legacy_order_parity` separately
reports differences against the old millisecond/text sorter. `rollup-progress.json` records
chunk and reconnect counts.

The local loader closes duplicate open metadata versions in older exports to satisfy the
current-row constraint. It changes only `valid_to_ts`, which neither pipeline reads, and
records the count in `sample-adaptations.json`. It also grants the local connection owner
membership in `internet_map_reader` for the export check; this is test setup, not a
production grant.

Known semantic choices to review during parity:

- Events use timestamp then event-id order. The old TSV sorter uses millisecond timestamps
  and a final text comparison of its integer visit fields for ties. Same-millisecond events
  can therefore produce different jumps or triples. Page numbering follows the canonical
  timestamp/id input; numeric ids from a differently ordered full dump are not comparable.
- Equal title/favicon vote counts choose earliest source timestamp then source id. The old
  Python counter chooses whichever tied value appeared first in the input dump. The parity
  sample sorts metadata by timestamp/id to make that order explicit.
- SQL uses ICU for normalization case conversion, identifier character classes, and metadata
  whitespace. Python uses its own Unicode database. SQL also removes decoded NUL because
  PostgreSQL text cannot contain it.
  These differences are not waived by the harness; real mismatches require review.
- Invalidation detects late history but does not automatically repair it. The readonly Action
  deliberately cannot trigger a privileged repair or fallback refresh.

Local verification (2026-10-11): all six migrations apply and schema lint has no findings.
The 125,000-case sample matches Python on all eight URL/privacy transforms (1,000,000 field
comparisons). The 100,000-event, 25,000-metadata sample matches all 299,446 aggregate file
rows/JSON entries against the timestamp/id Python reference. Three invalid URLs are rejected
by both pipelines. Backfill and incremental loading use 254 committed chunks, two reconnects,
and two 50,000-event batches with one session continuing across the boundary within 30 minutes.
The fixture closes 767 duplicate current metadata versions without changing rollup inputs.

The old millisecond/text sorter differs on node statistics (90.8415%), edges (90.8546%), page
paths (60.0515%), domain paths (83.7011%), and junctions (77.5785%). Reordering only the Python
visit stream to timestamp/id order produces exact matches for every aggregate; these are
ordering differences, not missing rollup rows.

The real reader login and full fork bake pass. The bundle has 9,117 displayed pages, passes
structural validation, and has a CLEAN PII audit. The bake omits 71 unsafe favicon entries.
The local pg_cron schedule SQL passes in a rolled-back transaction; no job is retained.

**Reader isolation is not yet complete.** All 13 aggregate relations are readable, raw source
reads and aggregate writes are denied, but stock local Supabase grants PUBLIC writes on
`net.http_request_queue` and `net._http_response`. Zero-row updates as the reader succeed even
with no grants directly assigned on those tables. `NOINHERIT` does not remove PUBLIC grants,
and the read-only transaction setting is a default the login can disable. Shared pg_net
privilege changes require a separate scope decision; do not treat this reader as write-free.
No shared grants or production permissions were changed.

### Approve production setup

Complete local execution and parity first. Each following operation requires Spencer's
approval; none is performed by a migration or by the implementation task.

1. **Apply migrations.** Review and apply
   `20261010060148_extension_internet_map_functions.sql` and
   `20261010060159_extension_internet_map_rollups.sql` through the established Supabase
   migration deployment process. Confirm function ownership is `postgres`. Review source
   trigger latency before enabling the scheduled bake.
2. **Create the reader.** Run `supabase/operators/internet_map_reader.sql` as the database
   owner, then run `\password internet_map_reader` in an interactive psql session. Confirm
   that the login can SELECT `internet_map.pages` and cannot SELECT
   `public.collection_events` or `public.page_metadata_history`, INSERT aggregates, or
   execute `internet_map.rollup`. Use a direct or session-pooler connection with TLS;
   `sslmode=verify-full` is preferred when the provider certificate chain is available.
3. **Backfill.** From an owner connection, run this command repeatedly, outside an explicit
   transaction, until the watermark is within one hour of the current time:
   `CALL internet_map.refresh(1000, interval '1 hour');`
   Each call processes at most 1,000 independently committed chunks. Query only the aggregate
   checkpoint: `SELECT watermark, invalid_since, processed_events, rejected_events,
   processed_metadata FROM internet_map.rollup_state;`. Any non-null invalidation or rejected
   rows require review. Do not clear an invalidation flag without rebuilding affected data.
4. **Enable scheduling.** Verify `pg_cron` in the project's enabled extensions. If absent,
   approve enabling it through Supabase first. Then run
   `supabase/operators/internet_map_cron.sql` as `postgres`; it schedules the owner procedure
   at 03:00 UTC. Inspect `cron.job_run_details` after the first run. Without cron or an
   independently approved owner scheduler, leave the Action disabled; it has no write role.
5. **Configure the private fork.** After separately approving a GitHub push and workflow
   enablement, add `INTERNET_MAP_DATABASE_URL` (reader connection string),
   `INTERNET_MAP_R2_TOKEN` (object-write access restricted to `wwo-internet-map`), and
   `CLOUDFLARE_ACCOUNT_ID`. The workflow runs at 05:30 UTC and can be dispatched manually.
   Audit and validation must pass before it uploads `auto-YYYYMMDD`, followed by `latest`.
6. **Switch the viewer default.** Coordinate `?data=latest` with the separate viewer job.
   This work does not edit viewer code. Explicit `?data=` overrides remain that job's concern.

R2 replacement spans several objects and is not atomic. The uploader writes `map.json` last
and uses `no-cache`, but readers may briefly see mixed generations while `latest` changes.
The Worker may impose its own cache policy; verify it during approved publication. Keep the
dated bundle available for recovery. If an upload fails midway, retry the same verified bundle
or restore the previous dated bundle through a separately approved operation.
