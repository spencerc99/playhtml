# Database migrations

This directory contains the ordered migration history for the Supabase project shared by the
extension and PartyKit. Supabase applies every SQL file here to local, preview, and production
databases in timestamp order.

The initial migration must come from `supabase db pull` against production. Do not copy the files
from `extension/db/migrations/` into this directory: some of them backfill data or remove indexes,
and the production database may already contain those changes.

Create later migrations from the repository root:

```sh
bun run db:new -- extension_describe_the_change
bun run db:new -- partykit_describe_the_change
```
