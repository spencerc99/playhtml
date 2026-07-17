---
"playhtml": patch
---

Publish a root-level `init.js` so the friendly drop-in URL `https://unpkg.com/playhtml/init.js` resolves (it previously 404'd). The file boots `playhtml.init({})` with default options, matching the existing `dist/init.es.js`. Also adds a `./init.js` entry to the package `exports` map so bundler imports of `playhtml/init.js` resolve.
