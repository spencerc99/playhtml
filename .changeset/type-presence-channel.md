---
"@playhtml/react": patch
---

Correct `usePresence` types so the channel name and payload match the returned
presence view. Pass the channel literal first and the payload second, such as
`usePresence<"status", StatusPresence>("status")`. Channel values are available
under their channel key, while `setMyPresence` continues to accept the channel
payload.
