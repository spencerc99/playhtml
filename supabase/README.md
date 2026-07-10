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
changes that predate the native Supabase project and must be reconciled against the production
schema before production deployment is enabled.

## Local development

The local stack requires Docker or another Docker-compatible container runtime.

```sh
bun run db:start
bun run db:reset
bun run db:lint
bun run db:stop
```

`db:reset` recreates the local database from `supabase/migrations/` and then loads `seed.sql`.
`db:verify` runs the reset and database lint together.

Use the values printed by `bun run db:status` for local Worker configuration. Keep secret keys in
ignored local environment files.

## Production baseline

Before enabling automatic production deployment, pull the complete production schema into this
directory and reconcile its migration history:

```sh
bunx supabase login
bunx supabase link --project-ref <project-ref>
bunx supabase db pull
bunx supabase migration list
bun run db:verify
```

Review the generated baseline against the SQL under `extension/db/migrations/` and every table
used by PartyKit. If the production schema is already present but its migration history is empty,
mark the baseline as applied with `supabase migration repair` instead of applying the schema again.

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
