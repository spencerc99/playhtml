---
"playhtml": minor
"@playhtml/common": minor
---

Add page-level shared data and presence API

- `playhtml.createPageData(name, default)` for named persistent data channels not tied to DOM elements
- `playhtml.presence` for unified per-user presence with named channels, `isMe` flag, and channel-scoped `onPresenceChange`
- Deprecate `playhtml.cursorClient` in favor of `playhtml.presence`
