### Shared Elements

Shared elements are a way to share data between different pages on the same site and even across different domains. Effectively, this allows for cross-origin data sharing that can be rendered with custom markup and styles. These are defined by a source page and can be referenced on the consumer page by their domain and path (the playhtml room that they are assigned to).

```html
<!-- on thissite.com -->
<div id="couch" can-move shared style="font-size: 80px">🛋</div>

<!-- on anothersite.com -->
<div id="chair" data-source="thissite.com#couch" can-move>🪑</div>
```

- Required on consumer elements:
  - `data-source="domain/path#elementId"` (ID is the part after `#`)
  - A matching capability attribute (e.g., `can-move`, `can-toggle`, `can-grow`)
- Optional on consumer elements:
  - HTML tag type, classes, inline styles, layout
  - Local-only behaviors (e.g., additional non-shared capabilities)
- Not required:
  - Matching DOM `id` (the consumer’s DOM `id` can differ; the shared ID comes from `data-source`)

The capability tag declares the data contract and render semantics. Markup and styles can differ; the capability handler will render from the shared data.

### Capability Contracts (data shape and semantics)

- `can-toggle`
  - Data: `{ on: boolean }` (raw boolean also supported for migration)
  - Rendering: toggles the `clicked` class; consumer can style freely
- `can-move`
  - Data: `{ x: number, y: number }`
  - Rendering: applies translate transform; consumer can layout freely
- `can-grow`
  - Data: `{ scale: number }` (with localData for limits)
  - Rendering: applies scale; consumer may ignore hover/keyboard extras
- `can-mirror` (experimental)
  - Data: DOM-like state snapshot; consumer applies it to render

Rule: the capability tag must match the shared element’s behavior. If a consumer uses an incompatible tag for the same `elementId`, the runtime will warn and ignore writes.

### Finding and parsing `data-source`

Format: `data-source="domain/<optional path>#elementId"`

- Examples:
  - `data-source="jzhao.xyz/blog/post#counter"` → domain `jzhao.xyz`, path `/blog/post`, id `counter`
  - `data-source="jzhao.xyz#global-counter"` → domain `jzhao.xyz`, path `/`, id `global-counter`
  - Implementation: split on `#` to get `elementId`; split domain/path at first `/`; default path is `/`.

### Modular capability combinations on consumers

Consumers may attach additional local-only capabilities to the referenced element (e.g., a source `can-move` element can also have `can-toggle` on the consumer). Only the capabilities that are shared will be synchronized; extra consumer-only capabilities operate locally and won’t be sent back to the source unless explicitly shared.

Best practice: keep consumer-only capabilities orthogonal to the shared data shape to avoid accidental conflicts.

### Errors and resilience

- Missing source: the consumer element renders locally and logs a warning after a short timeout if no shared data arrives (dev mode).
- Capability mismatch: warn and ignore writes for the mismatched tag; continue rendering the capabilities that do match.
- Latency: when using a server bridge, immediate observe/apply removes save-callback delays. Direct client subscriptions to a shared room provide the best real-time UX.
