---
"playhtml": minor
---

Add `playhtml.configure(options)` to declare init options separately from connecting, and make config first-declaration-wins uniformly across all options.

Previously `init(options)` both declared config and connected, first-call-wins — so on a page with no single top-level init (Astro islands, multi-page apps, multiple React roots), an option-less `init()` from one place could win the race and silently drop the config another place intended (e.g. cursors never turning on). Now you can call `configure({ cursors: { enabled: true }, ... })` once, up front, from wherever owns the config; later `init()` / component mounts just ensure playhtml is running and pick up the declared config regardless of order. `init(options)` still works exactly as before when you only have one call site. A later call that passes genuinely conflicting options warns and is ignored (config is locked to the first declaration); passing the same options again, or none, is quiet.
