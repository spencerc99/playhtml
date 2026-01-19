# R2 Archival Migration Guide

This document describes the process for migrating collection event data from Supabase to Cloudflare R2 for long-term archival.

## When to Archive

Consider archiving when:
- Supabase storage exceeds ~2GB
- Closing an edition for permanent archival
- Need to reduce database costs
- Want to create immutable snapshot editions

## Architecture

```
┌─────────────┐     ┌──────────────┐     ┌─────────────┐
│   Supabase  │────▶│  CF Worker   │────▶│  R2 Bucket  │
│  (hot data) │     │  (export)    │     │ (cold data) │
└─────────────┘     └──────────────┘     └─────────────┘
```

## Prerequisites

1. Cloudflare R2 bucket created
2. R2 API token with write permissions
3. Worker has R2 bindings configured

## Implementation Steps

### 1. Configure R2 in Worker

Add R2 binding to `wrangler.toml`:

```toml
[[r2_buckets]]
binding = "ARCHIVE_BUCKET"
bucket_name = "collection-archives"
```

### 2. Create Export Function

Add to `worker/src/routes/export.ts`:

```typescript
import { Env } from '../lib/supabase';

export async function archiveToR2(
  edition: EditionExport,
  env: Env
): Promise<string> {
  // Compress JSON data
  const jsonData = JSON.stringify(edition);
  const compressed = await compress(jsonData); // Use pako or similar
  
  // Generate filename
  const filename = `${edition.edition.type}/${edition.edition.name.replace(/\s+/g, '-')}.json.gz`;
  
  // Upload to R2
  await env.ARCHIVE_BUCKET.put(filename, compressed, {
    httpMetadata: {
      contentType: 'application/json',
      contentEncoding: 'gzip',
    },
    customMetadata: {
      editionName: edition.edition.name,
      exportedAt: edition.edition.exportedAt,
      eventCount: edition.edition.eventCount.toString(),
      participantCount: edition.edition.participantCount.toString(),
    },
  });
  
  return filename;
}
```

### 3. Create Editions Table

Track archived editions in Supabase:

```sql
CREATE TABLE editions (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  type TEXT NOT NULL,
  start_date TIMESTAMPTZ NOT NULL,
  end_date TIMESTAMPTZ NOT NULL,
  participant_count INT NOT NULL,
  event_count INT NOT NULL,
  r2_key TEXT,  -- R2 object key
  r2_url TEXT,  -- Public R2 URL (if public)
  status TEXT DEFAULT 'open',  -- 'open', 'closed', 'archived'
  created_at TIMESTAMPTZ DEFAULT NOW(),
  archived_at TIMESTAMPTZ
);

CREATE INDEX idx_editions_type_status ON editions(type, status);
CREATE INDEX idx_editions_dates ON editions(start_date, end_date);
```

### 4. Update Export Endpoint

Modify `POST /events/export` to optionally archive:

```typescript
// POST /events/export?archive=true
const shouldArchive = url.searchParams.get('archive') === 'true';

const edition = await exportEdition(...);

if (shouldArchive) {
  const r2Key = await archiveToR2(edition, env);
  
  // Save edition record
  await supabase.from('editions').insert({
    id: generateULID(),
    name: edition.edition.name,
    type: edition.edition.type,
    start_date: edition.edition.startDate,
    end_date: edition.edition.endDate,
    participant_count: edition.edition.participantCount,
    event_count: edition.edition.eventCount,
    r2_key: r2Key,
    status: 'archived',
    archived_at: new Date().toISOString(),
  });
  
  // Optionally delete events from Supabase
  if (deleteAfterArchive) {
    await supabase
      .from('collection_events')
      .delete()
      .eq('type', edition.edition.type)
      .gte('ts', edition.edition.startDate)
      .lt('ts', edition.edition.endDate);
  }
}
```

### 5. Create Archive Script

Admin script to archive old data:

```typescript
// scripts/archive-edition.ts

async function archiveEdition(
  type: string,
  startDate: string,
  endDate: string,
  name: string
) {
  const response = await fetch(`${WORKER_URL}/events/export?archive=true`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${API_KEY}`,
    },
    body: JSON.stringify({
      type,
      startDate,
      endDate,
      name,
    }),
  });
  
  const result = await response.json();
  console.log('Archived:', result);
}
```

## Data Format

Archived files are gzipped JSON with this structure:

```json
{
  "edition": {
    "name": "Internet Movement May 2025",
    "type": "cursor",
    "startDate": "2025-05-01T00:00:00Z",
    "endDate": "2025-06-01T00:00:00Z",
    "participantCount": 1234,
    "eventCount": 567890,
    "exportedAt": "2025-06-02T12:00:00Z"
  },
  "events": [
    {
      "id": "...",
      "type": "cursor",
      "ts": 1714521600000,
      "data": { "x": 0.5, "y": 0.3 },
      "meta": { ... }
    }
  ]
}
```

## R2 Bucket Structure

```
collection-archives/
├── cursor/
│   ├── internet-movement-may-2025.json.gz
│   ├── internet-movement-june-2025.json.gz
│   └── ...
├── click/
│   └── ...
└── index.json  # List of all archived editions
```

## Cost Considerations

| Storage | Cost |
|---------|------|
| Supabase (8GB) | ~$25/mo |
| R2 (100GB) | ~$1.50/mo |
| R2 egress | Free (first 10GB/mo) |

**Recommendation**: Archive editions older than 3 months to R2.

## Retrieval

To load an archived edition:

```typescript
// From R2
const object = await env.ARCHIVE_BUCKET.get(r2Key);
const decompressed = await decompress(object.body);
const edition = JSON.parse(decompressed);
```

## Migration Checklist

- [ ] Create R2 bucket
- [ ] Configure R2 binding in Worker
- [ ] Create editions table
- [ ] Implement archive function
- [ ] Update export endpoint
- [ ] Create admin archive script
- [ ] Test with small dataset
- [ ] Archive old editions
- [ ] Update artwork sites to load from R2

## Future Enhancements

- Automatic archival cron job (via Cloudflare Cron Triggers)
- Versioning for editions
- Public CDN URLs for archived editions
- Compression optimization (brotli vs gzip)
