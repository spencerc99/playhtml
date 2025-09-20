### Shared Elements

Shared elements are a way to share data between different pages on the same site and even across different domains. Effectively, this allows for cross-origin data sharing that can be rendered with custom markup and styles. These are defined by a source page and can be referenced on the consumer page by their domain and path (the playhtml room that they are assigned to).

```html
<!-- Source page (thissite.com) -->
<div id="couch" shared can-move style="font-size: 80px">🛋</div>

<!-- Consumer page (anothersite.com) -->
<div data-source="thissite.com#couch" can-move>🪑</div>
```

- **Required on consumers**
  - `data-source="domain/path#elementId"` (the part after `#` is the shared id)
  - A matching capability (e.g., `can-move`, `can-toggle`, `can-grow`)
- **Optional on consumers**
  - HTML tag, classes, styles, layout
  - Additional local-only capabilities (not synchronized)
- **Not required**
  - Matching DOM `id` (the shared id is derived from `data-source`)

The capability tag defines the data contract and how it renders. Your consumer’s markup/styles can differ; capabilities read and render from shared data.

#### Permissions

- On the source element:
  - `shared` or `shared="read-write"` → read-write (default)
  - `shared="read-only"` or `shared="ro"` → read-only
- On consumers:
  - Add `data-source-read-only` to force local read-only behavior even if the source is read-write.
  - Read-only consumers can’t write, but still receive and render updates from the source.

```html
<!-- Source declares read-only -->
<div id="status" shared="read-only" can-toggle>🔒</div>

<!-- Consumer: auto-read-only based on source; local writes are blocked -->
<div data-source="thissite.com#status" can-toggle></div>

<!-- Consumer: force local read-only even if source is read-write -->
<div data-source="thissite.com#couch" data-source-read-only can-move>🪑</div>
```

UX hint: PlayHTML adds a not-allowed cursor for `[data-source][data-source-read-only]`.

#### Referencing syntax

- Format: `data-source="domain/<optional path>#elementId"`
- Examples:
  - `data-source="jzhao.xyz/blog/post#counter"` → domain `jzhao.xyz`, path `/blog/post`, id `counter`
  - `data-source="jzhao.xyz#global-counter"` → domain `jzhao.xyz`, path `/`, id `global-counter`

#### Combining capabilities on consumers

You can add extra, local-only capabilities on the consumer. Only the capabilities declared on the source participate in sharing.

```html
<!-- Source shares movement -->
<div id="lamp" shared can-move>💡</div>

<!-- Consumer adds local toggle; only movement is synchronized -->
<div data-source="thissite.com#lamp" can-move can-toggle class="rounded"></div>
```

Best practice: keep consumer-only capabilities orthogonal to the shared data shape.

#### React usage

```tsx
import { CanMoveElement, CanToggleElement } from "@playhtml/react";

// Source
<CanMoveElement id="couch" shared>
  <div style={{ fontSize: 80 }}>🛋</div>
</CanMoveElement>

// Consumer (matching capability + dataSource)
<CanMoveElement dataSource="thissite.com#couch">
  <div>🪑</div>
</CanMoveElement>

// Force local read-only on consumer
<CanToggleElement dataSource="thissite.com#status" readOnly>
  <div>🔒</div>
</CanToggleElement>

// Use with `withSharedState`
export const Status = withSharedState(
  { defaultData: { on: false }, dataSource: "thissite.com#status" },
  ({ data, setData }, props: Props) => {
    return <div>{data.on ? "🔒" : "🔓"}</div>;
  }
);
```

#### Troubleshooting

- **Nothing shows up / stays local only**: ensure `data-source` is correct and the capability matches the source element’s capability.
- **Consumer doesn’t update the source**: check if the source is `shared="read-only"` or the consumer has `data-source-read-only`.
- **Styling looks off**: capabilities only manage behavior/data; bring your own CSS/layout on consumers.
- **Multiple consumers**: all consumers receive updates from the source; local-only capabilities remain local.
