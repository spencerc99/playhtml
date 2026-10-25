---
"@playhtml/common": patch
"playhtml": patch
---

Fix the `PlayEvent.onEvent` type so listeners receive the dispatched `eventPayload` directly, matching what playhtml already passes at runtime. Typed listeners such as `onEvent: ({ emoji }: { emoji: string }) => ...` now type-check without casts.
