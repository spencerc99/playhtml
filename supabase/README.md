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

Create and test every schema change locally. Do not change production through the Dashboard SQL or
Table editors because those changes bypass the repository migration history.

## Deploying migrations

Supabase's GitHub integration deploys to production from `main`: merging a pull request that adds a
migration applies it to production as written, unattended. Automatic preview branching is off, so
pull requests do not get their own database.

Large production tables (`collection_events`, `page_metadata_history`) need migrations that are safe
to run unattended: build indexes `CONCURRENTLY`, batch data changes with commits, add `NOT NULL`
through a `NOT VALID` check and a later `VALIDATE`, and keep lock-taking DDL behind a short
`lock_timeout`. If a migration cannot be written that way, apply it by hand before merging.

`supabase/scripts/catch-up-production.sh` (`bun run db:prod:catch-up`) applied the migrations that
were merged before production deployment was turned on. It checks what is recorded first and is
safe to rerun.

## Database tests

`supabase/tests/*.test.sh` load a single migration into a throwaway `postgres:15-alpine` Docker
container and check its behavior against real PostgreSQL. They need Docker but not the Supabase
stack:

```sh
bun run --cwd extension/worker test:db
```
