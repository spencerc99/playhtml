---
"@playhtml/common": patch
"playhtml": patch
---

Person names are now trimmed and capped at 32 characters, and a blank name clears it. This applies when you set `people.me.name` and when reading names from other people or older saved identities. Setting `people.me.color` to something that isn't a CSS color (like `"banana"` or `"inherit"`) now throws an error and keeps the old color, and a saved color that isn't valid is replaced with a new default on load. Adds `normalizePersonName` and `isValidPersonColor` helpers to `@playhtml/common`.
