---
"@playhtml/extension-types": minor
---

Add `element` to `CollectionEventType` and `getValidEventTypes()`. Element events record distinctive page objects seen while browsing (starting with images: URL plus page provenance, with a `kind` discriminant in the payload for future object kinds like buttons) for the extension's internet-scraps collage. They are collected locally by the extension and are not uploaded to the worker.
