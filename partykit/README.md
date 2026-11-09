# playhtml real-time server

Real-time sync for playhtml rooms, built on PartyKit and Yjs. Run it locally with `bun dev-server` (see the root `CLAUDE.md` for variants).

## Production logs

Production Worker logs belong to the Cloudflare Worker named `playhtml`, configured by `partykit/wrangler.jsonc`.

- `wrangler tail --config partykit/wrangler.jsonc` is live-only and can be noisy for Durable Object WebSocket traffic.
- Historical searches need Workers Observability Query Builder in the Cloudflare dashboard, or a dedicated Cloudflare API token with Workers Observability read access. The Wrangler OAuth token in `~/.wrangler/config/default.toml` can tail but cannot read the stored Workers Observability telemetry API.

Useful search terms:

- Room ids, such as `class.playhtml.fun-%2Fweek%2F1`
- `SUPABASE PERSISTENCE UNAVAILABLE`, `SUPABASE AUTOSAVE FAILED`, `Autosave skipped`
- `Hard Reset`, `Restore Snapshot`
- `Emergency compacted connected room`, `Empty-room compacted`
