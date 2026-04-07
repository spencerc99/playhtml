# Extension: "we were online"

Browser extension that collects anonymous browsing behavior (cursor movements, navigation, viewport, keyboard input) and creates artistic visualizations of internet usage. Built with WXT, React 19, and TypeScript.

## Commands

- `bun run dev`: WXT dev server with hot reload (Chrome)
- `bun run dev:firefox`: WXT dev server (Firefox)
- `bun run build`: Production build (Chrome)
- `bun run build:firefox`: Production build (Firefox)
- `bun run test`: Run Vitest tests
- `bun run zip`: Package for Chrome Web Store

Worker backend (in `worker/`):
- `cd worker && wrangler dev`: Local API server (localhost:8787)
- `cd worker && wrangler deploy`: Deploy to Cloudflare

## Architecture

### Entrypoints (`src/entrypoints/`)

WXT manages multiple entry points:

- **`background.ts`**: Service worker -- extension lifecycle, ECDSA keypair generation for player identity, IndexedDB event store coordination, message routing, stats computation, event upload scheduling.
- **`content.ts`**: Injected into all pages -- initializes collectors, detects playhtml elements, element picker, site discovery, presence detection.
- **`popup/`**: Extension popup UI -- player identity card, collector status, mini cursor trail canvas.
- **`portrait/`**: Main portrait gallery -- domain-level browsing visualization with canvas-textured cards showing 24h activity patterns.
- **`setup/`**: First-time onboarding -- identity init, consent, data collection mode selection.
- **`stats/`**: Detailed analytics -- domain/page breakdowns, screen time, date ranges.
- **`options/`**: Settings -- privacy config, keyboard privacy levels, filter substrings, import/export.

### Collectors (`src/collectors/`)

Event capture system with a dual-layer architecture (real-time streaming + archival storage).

**BaseCollector** (abstract): Lifecycle (`enable`/`disable`/`pause`/`resume`), dual emission (buffered + real-time), configurable sample rate.

**CollectorManager**: Orchestrates collectors, routes events to EventBuffer, supports 3 collection modes (`off`/`local`/`shared`), 3s debounced batch flush.

Individual collectors:

- **CursorCollector**: 60fps real-time to PartyKit, 250ms archival sampling. Tracks moves (normalized 0-1), clicks (2s debounce with quantity), holds (>250ms), cursor style changes. 15px movement threshold for archival.
- **NavigationCollector**: focus/blur/popstate/beforeunload events. 2s dedup window. Captures canonical URL, title, favicon on navigation.
- **ViewportCollector**: Scroll (100ms throttle, normalized 0-1 position), resize (200ms debounce), zoom (via VisualViewport API, 2s debounce).
- **KeyboardCollector**: Privacy levels `abstract` (frequency/length only) or `full` (text with PII redaction). Redacts emails, phones, SSNs with U+2588 block char. Excludes password inputs. 5s debounce for typing sessions.

### Storage (`src/storage/`)

- **EventBuffer**: Creates CollectionEvents with metadata in content-script context, batches for 3s flush, sends to background via `browser.runtime.sendMessage`.
- **LocalEventStore**: IndexedDB v8 with domain-indexed queries. Pre-computes DomainStatsAggregate at insert time (totalTimeMs, hourBuckets[24], sessionCount, eventsByType, uniqueUrls). Screen time from focus/blur session pairing.
- **sync.ts**: Upload to Cloudflare Worker (`POST /events`), retry on failure, participant color sync.

### Identity (`src/storage/participant.ts`)

- **Player ID**: ECDSA P-256 public key (`pk_` + 130 hex chars)
- **Session ID**: Per-browser-session (`sid_` + UUID), resets on close
- **Player style**: cursor color (random HSL), stored in `browser.storage.local`

### Features (`src/features/`)

Domain-specific collaborative features:

- **LinkGlowManager**: Wikipedia link click visualization -- glow intensity from click frequency, recent player colors, decay mechanic.
- **link-glow-renderer**: Canvas/CSS rendering for link glows (inline vs multi-line).
- **FollowManager**: Follow another user's cursor, scroll tethering, cross-page navigation via presence API. `F` to follow nearest, `Q` to unfollow.
- **PresenceCountPill**: Ambient people-count indicator with colored dots.
- **OffscreenIndicator**: Directional arrow at screen edge when followed user is off-screen.

### Custom Sites (`src/custom-sites/`)

Extensible module system for site-specific behavior. Currently:

- **wikipedia.ts**: Detects article URLs (filters Special:/Talk: pages), initializes LinkGlow + Follow + PresenceCountPill, cursor client with proximity detection, domain-wide lobby.
- **index.ts**: Router -- `shouldEnableCursors()` and `initCustomSite()` dispatch.

### Components (`src/components/`)

React UI for extension surfaces:

- **InternetPortraitHome**: Popup home view
- **PortraitCard**: Domain stats card with canvas-textured 24h activity pattern
- **HistoricalOverlay**: Historical data with date range picker
- **ProfilePage**: Player identity display and customization
- **SetupPage**: Onboarding flow
- **Collections**: PlayHTML element inventory
- **PlayerIdentityCard**: Player color, public key display
- **TinyMovementPreview / TrailsHero**: Cursor trail canvas animations
- **DomainPortraitExport**: Export portrait as image/data
- **icons.tsx**: Collector and UI icon components

### Shared Types (`src/shared/types.ts`)

Shared between extension and Cloudflare Worker:

- `CollectionEventType`: `'cursor' | 'navigation' | 'viewport' | 'keyboard'`
- `CollectionEvent`: `{ id, type, ts, data, meta, domain?, normalizedUrl? }`
- `EventMeta`: `{ sid, pid, url, vw, vh, tz, cursor_color? }`
- `PageMetadataSnapshot`: `{ page_ref, canonical_url, title, favicon_url, metadata_hash, observed_at_ts }`

### Worker Backend (`worker/`)

Cloudflare Worker + Supabase PostgreSQL:

- `POST /events`: Public event ingestion (rate limited)
- `GET /events/recent`: Public (for artwork visualizations)
- `GET /events/stats`, `POST /events/export`: Admin key required

## Configuration

- `src/config.ts`: `VERBOSE` debug logging flag
- `src/flags.ts`: Feature flags (`COPRESENCE: true`)
- `wxt.config.ts`: Manifest v3, permissions (storage, tabs, http/https host access), React module, ASCII charset output for Chrome compliance

## Testing

- **Framework:** Vitest with jsdom
- **Setup (`vitest.setup.ts`):** Mocks for window dimensions, devicePixelRatio, visualViewport, getComputedStyle, webextension-polyfill, IndexedDB, browser.storage
- **Test files:** CursorCollector, NavigationCollector, ViewportCollector, collectors integration
- **Test utils:** `src/__tests__/test-utils.ts`

## Key Design Patterns

1. **Dual-layer collection**: High-frequency real-time (PartyKit) + sparse archival (IndexedDB/Supabase)
2. **Message-based architecture**: Content scripts communicate with background via `browser.runtime.sendMessage` -- no direct DOM access from background
3. **Privacy tiers**: Keyboard abstract/full modes, collection off/local/shared modes, PII redaction
4. **Stats pre-computation**: Aggregates computed at insert time for O(1) domain-level queries
5. **Session + identity separation**: Persistent ECDSA identity vs ephemeral browser-session IDs

## Injecting UI into Host Pages

All extension-owned UI injected into third-party pages (toasts, overlays, modals) **must use Shadow DOM** to prevent style bleed in both directions. Host-page CSS cannot penetrate the shadow boundary; our styles cannot accidentally affect the host page.

### Pattern

```ts
const host = document.createElement('div');
host.style.cssText = 'position:fixed;bottom:20px;left:20px;z-index:2147483647;';
const shadow = host.attachShadow({ mode: 'closed' });

const styleEl = document.createElement('style');
styleEl.textContent = MY_COMPONENT_CSS; // CSS string, not a file import
shadow.appendChild(styleEl);

const content = document.createElement('div');
// ... build DOM or mount React here ...
shadow.appendChild(content);

document.body.appendChild(host);
```

### Google Fonts

`@import` and `<link>` in `document.head` do not cross the shadow boundary. Inject font links **inside the shadow root**:

```ts
const fontLink = document.createElement('link');
fontLink.rel = 'stylesheet';
fontLink.href = 'https://fonts.googleapis.com/...';
shadow.appendChild(fontLink);
```

### React inside Shadow DOM

Mount `createRoot()` onto a plain `<div>` appended inside the shadow root — React doesn't need to know about the shadow boundary:

```ts
const reactContainer = document.createElement('div');
shadow.appendChild(reactContainer);
createRoot(reactContainer).render(<MyComponent />);
```

React event delegation (synthetic events) works fine in closed shadow roots in React 18+.

### CSS for injected components

Keep each component's CSS as a `const` string in a companion file (e.g. `content/milestone-toast-styles.ts`). Do **not** rely on `content/style.css` or the manifest `css` array for injected UI — that stylesheet is reserved for styles that must affect the host page directly (e.g. element picker outlines).

### What lives in `content/style.css`

Only styles that must reach the host page's own elements — currently just `.playhtml-extension-element-picker`. Everything else uses Shadow DOM.
