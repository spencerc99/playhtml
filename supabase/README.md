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
