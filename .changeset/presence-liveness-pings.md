---
"playhtml": patch
"@playhtml/common": patch
---

Idle pages no longer keep the presence server awake. Instead of republishing element awareness and page presence every 10 seconds to stay visible, each page now sends a small liveness ping that the server answers without running any room code, and the server refreshes the timestamps of pages whose pings keep arriving. An idle room with three open pages goes from about 18 server wakeups a minute to 4. Against an older server that does not answer pings, pages keep republishing as before. A page that disappears without closing its connection (a killed tab or a dropped network) now fades from other people's views within about 50 seconds instead of about 30.
