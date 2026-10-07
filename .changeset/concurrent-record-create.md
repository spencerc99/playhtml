---
"playhtml": patch
---

Elements and page data keep syncing when several people create them at the same moment. Before, if a shared element first appeared on multiple pages at once (for example, a React `withSharedState` component that mounts after shared state changes), some pages would stop seeing updates and their own changes would not reach anyone else. The same could happen to a `createPageData` channel opened on several pages at once. Those pages now switch to the shared copy and stay in sync.
