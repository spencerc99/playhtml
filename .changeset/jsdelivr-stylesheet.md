---
"playhtml": patch
---

playhtml now ships a single-file browser build (`dist/playhtml.browser.js`) and points the package's `jsdelivr` and `unpkg` fields at it, so `import { playhtml } from "https://cdn.jsdelivr.net/npm/playhtml"` works directly in a `<script type="module">`. The default stylesheet also loads from jsDelivr instead of unpkg. Bundlers and npm installs keep using the existing code-split build.
