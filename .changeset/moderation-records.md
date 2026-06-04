---
"@playhtml/common": patch
---

Add moderation helpers (`extractRecords`, `removeRecordsByTargets`, `hashRecord`)
for extracting reviewable text records from playhtml room data and removing them
by content-hashed key. Used by the admin console's content-moderation flow.
