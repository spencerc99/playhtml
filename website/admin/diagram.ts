// The playhtml Machine — an isometric systems diagram of the playhtml architecture.
// Pan/zoom stage, sidebar, detail panel, trace mode, and zoom-inside sub-scenes.
// The event dots are driven by real traffic where a pipeline is reachable
// (see diagramLive.ts) and simulated per-pipeline where it is not.

import { LiveDiagramSources, type PipelineState } from "./diagramLive";

/* ============================================================
   iso geometry
============================================================ */
const T = 26,
  KX = 0.92,
  KY = 0.5,
  ZS = 23;
function iso(x: number, y: number, z = 0): [number, number] {
  return [(x - y) * T * KX, (x + y) * T * KY - z * ZS];
}
const SVGNS = "http://www.w3.org/2000/svg";
function el<K extends keyof SVGElementTagNameMap>(
  name: K,
  attrs: Record<string, string | number>,
  parent?: Node
): SVGElementTagNameMap[K] {
  const e = document.createElementNS(SVGNS, name) as SVGElementTagNameMap[K];
  for (const k in attrs) e.setAttribute(k, String(attrs[k]));
  if (parent) parent.appendChild(e);
  return e;
}
function pts(list: Array<[number, number]>): string {
  return list.map((p) => p[0].toFixed(1) + "," + p[1].toFixed(1)).join(" ");
}

/* ============================================================
   colors per pipeline
============================================================ */
const C_TEAL = "#0e8f86"; // shared data (Yjs) pipeline
const C_COBALT = "#3e6fc1"; // presence pipeline
const C_RUST = "#c4633e"; // extension pipeline
const C_GOLD = "#b08a2e"; // persistence writes

/* ============================================================
   scene data types
============================================================ */
interface HowSection {
  files: string[];
  syms: string[];
  facts: Array<[string, string]>;
}

interface SceneNode {
  id: string;
  code: string;
  name: string;
  group?: string;
  n?: string;
  /** [gx, gy, w, d, h] — grid position, width, depth, height */
  g: [number, number, number, number, number];
  what: string;
  how: HowSection | null;
  stack?: number;
  inside?: string;
  step?: number;
  total?: number;
}

type Edge = [string, string];

interface Zone {
  label: string;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

interface EventChainStep extends Array<string> {
  0: string;
  1: string;
  2: string;
}

interface EventDef {
  id: string;
  name: string;
  color: string;
  weight: number;
  speed: number;
  /** [fromId, toId] or [fromId, toId, reverseFlag] */
  hops: Array<[string, string] | [string, string, number]>;
  title?: string;
  sub?: string;
  payload?: string;
  chain?: EventChainStep[];
  facts?: Array<[string, string]>;
}

interface InsideScene {
  title: string;
  sub: string;
  nodes: SceneNode[];
  edges: Edge[];
  zones: Zone[];
  loopColor: string;
  events: EventDef[];
}

/* ============================================================
   scene data: THE MAIN MAP
   every node/edge/event maps to real code (see `built` blocks)
============================================================ */
const NODES: SceneNode[] = [
  // ---- consumers
  {
    id: "web", code: "W", name: "WEBSITE", group: "CONSUMERS", n: "", g: [0, 2.6, 2, 2, 1.4],
    what: `<p><b>playhtml.fun</b> &#8212; the demo site. A Vite multi-page app of hand-built playgrounds (<code>fridge.html</code>, <code>candles.html</code>, <code>story.html</code>, experiments) that consumes the library as a real first-party app, plus <code>admin.tsx</code>, the operator console that drives the server's 15 admin routes.</p>`,
    how: {
      files: ["website/index.html", "website/admin.tsx (3,570 lines)", "website/vite.config.site.mts"],
      syms: ["PlayProvider", "?playhtmlHost= / ?playhtmlRoom= overrides"],
      facts: [["admin routes it drives", "15"], ["dev command", "bun dev"]],
    },
  },
  {
    id: "docs", code: "DC", name: "DOCS SITE", group: "CONSUMERS", n: "", g: [0, 6.2, 2, 2, 1.4],
    what: `<p>The Astro + Starlight docs at <b>playhtml.fun/docs</b>. It embeds live CodeMirror playgrounds that run the real library in-page, so every code sample on the site is executing against a real room.</p>`,
    how: {
      files: ["apps/docs/astro.config.mjs", "apps/docs/src/content/docs/"],
      syms: ["@codemirror/* playgrounds", "lz-string shareable URLs", "HeadOverride.astro global init"],
      facts: [["served under", "/docs/"], ["port", "4321"]],
    },
  },

  // ---- library
  {
    id: "init", code: "I", name: "INIT &amp; BOOTSTRAP", group: "THE LIBRARY", n: "1", g: [4.2, 4.6, 2.2, 2.2, 1.2],
    what: `<p>The one-time boot sequence. It freezes config, resolves the room id from the page URL (<code>host + path</code>, encoded), opens the main WebSocket provider, builds the users/cursors/presence clients, waits for first sync, then scans the DOM for capability attributes and marks everything ready.</p>`,
    how: {
      files: ["packages/playhtml/src/index.ts (3,342 lines)"],
      syms: ["initPlayHTMLOnce()", "normalizeRoomId()", "getPartykitHost()", "waitForMainProviderSync()", "setupElements()", "playhtml.ready"],
      facts: [["prod host", "api.playhtml.fun"], ["local host", "localhost:1999"], ["DOM marker", "data-playhtml=true"]],
    },
  },
  {
    id: "caps", code: "CP", name: "CAPABILITIES", group: "THE LIBRARY", n: "8", g: [3.6, 9.2, 3.2, 3.2, 0], stack: 8,
    what: `<p>The archive of built-in behaviors, one plate per tag: <mark>can-move</mark>, <mark>can-spin</mark>, <mark>can-toggle</mark>, <mark>can-grow</mark>, <mark>can-duplicate</mark>, <mark>can-hover</mark>, <mark>can-mirror</mark>, and the fully custom <mark>can-play</mark>. Each plate defines a default data shape (<code>can-move</code> is <code>{ x, y }</code>, <code>can-spin</code> is <code>{ rotation }</code>) and how to paint it. ~35 more tags sit commented out in the enum, waiting.</p>`,
    how: {
      files: ["packages/common/src/index.ts (TagType enum + TagTypeToElement)", "packages/common/src/canMirror.ts (779 lines)"],
      syms: ["TagType", "TagTypeToElement", "ElementInitializer", "can-move-bounds attrs"],
      facts: [["active tags", "8"], ["reserved tags", "~35"], ["can-mirror data", "recursive ElementState"]],
    },
  },
  {
    id: "react", code: "R", name: "REACT WRAPPER", group: "THE LIBRARY", n: "6", g: [0, 10.2, 2.4, 2.4, 1.6],
    what: `<p><b>@playhtml/react</b>. <code>PlayProvider</code> boots the singleton and re-scans on route change; <code>CanPlayElement</code> renders a real DOM node, hands it to core, then mirrors <code>data</code> / <code>awareness</code> back into React state with deep-equal bail-outs so the render loop can't feed itself. Six prebuilt components and seven hooks sit on top.</p>`,
    how: {
      files: ["packages/react/src/PlayProvider.tsx", "packages/react/src/index.tsx", "packages/react/src/elements.tsx", "packages/react/src/hooks.ts"],
      syms: ["withSharedState()", "CanPlayElement", "usePageData", "useCursorPresences", "usePresence"],
      facts: [["prebuilt components", "6"], ["hooks", "7"], ["version", "2.1.0"]],
    },
  },
  {
    id: "common", code: "CM", name: "COMMON TYPES", group: "THE LIBRARY", n: "", g: [0, 14, 2.6, 2.6, 0.7],
    what: `<p><b>@playhtml/common</b> &#8212; the framework-free floor everything stands on. The capability implementations, the presence wire protocol, cursor and identity types, and the object utilities (<code>clonePlain</code>, <code>deepReplaceIntoProxy</code>) that keep CRDT proxies and plain snapshots apart. Imported by core, React, and the server alike.</p>`,
    how: {
      files: ["packages/common/src/index.ts (801 lines)", "packages/common/src/presence-protocol.ts", "packages/common/src/cursor-types.ts"],
      syms: ["validatePresenceClientMessage()", "generatePlayerIdentity()", "PROXIMITY_THRESHOLD = 150"],
      facts: [["presence msg types", "7"], ["max presence value", "4,096 B"], ["version", "0.9.0"]],
    },
  },

  // ---- sync loop
  {
    id: "handler", code: "E", name: "ELEMENT HANDLER", group: "THE SYNC LOOP", n: "1/el", g: [8, 6, 3, 3, 2.4], inside: "in-handler",
    what: `<p>One of these exists per interactive element on the page. It owns the element's data snapshot, wires up mouse/touch drag handling, and exposes the three writes: <mark>setData</mark> (synced, persistent), <mark>setLocalData</mark> (this tab only), <mark>setMyAwareness</mark> (ephemeral presence). It also enforces the big safety rule: a write attempted <i>during</i> render is rejected, because that's how infinite CRDT loops start.</p>`,
    how: {
      files: ["packages/playhtml/src/elements.ts (610 lines)"],
      syms: ["ElementHandler", "setData()", "setDataDebounced (300ms)", "rejectWriteDuringRender", "observeDescendants()", "destroy()"],
      facts: [["render paths", "view (lit-html) or updateElement"], ["default debounce", "300 ms"], ["reset shortcut", "modifier + click"]],
    },
  },
  {
    id: "store", code: "Y", name: "SYNCED STORE / Y.DOC", group: "THE SYNC LOOP", n: "", g: [12.6, 6.4, 3.6, 3.6, 1],
    what: `<p>The shared truth. One CRDT document per room, keyed <code>play &#8594; tag &#8594; elementId</code> &#8212; so a couch you can drag lives at <code>play["can-move"]["#couch"]</code>. Writes go through a transaction; remote changes surface through a deep observer that's coalesced to one apply per microtask. Page-scoped data hides under the reserved tag <code>__page__</code>.</p>`,
    how: {
      files: ["packages/playhtml/src/index.ts (store wiring)", "packages/playhtml/src/page-data.ts"],
      syms: ["syncedStore({ play: {} })", "getYjsDoc()", "ensureElementProxy()", "attachSyncedStoreObserver()", "recreateStore()"],
      facts: [["keying", "play[tag][elementId]"], ["page data tag", "__page__"], ["observer coalescing", "queueMicrotask"]],
    },
  },
  {
    id: "provider", code: "P", name: "Y-PROVIDER", group: "THE SYNC LOOP", n: "", g: [17, 6.8, 2, 2, 1.4],
    what: `<p>The client end of the wire. Encodes Y.Doc updates into y-protocols sync messages and ships them over a WebSocket to the room's Durable Object; applies inbound updates from everyone else. Carries the room id, shared-element params, and a reset epoch in its connect URL.</p>`,
    how: {
      files: ["packages/playhtml/src/index.ts (buildMainProvider)"],
      syms: ["YProvider (y-partyserver/provider)", "params: sharedElements, clientResetEpoch", "custom-message listener"],
      facts: [["transport", "wss:// &#8594; /parties/main/&lt;room&gt;"], ["events", "error, sync, custom-message"]],
    },
  },
  {
    id: "party", code: "M", name: "PARTY SERVER", group: "THE SYNC LOOP", n: "DO", g: [21.6, 5.4, 4, 4, 3.4], inside: "in-party",
    what: `<p>The room itself &#8212; a Cloudflare Durable Object, one per room, hibernating between visits. It merges every client's updates into the server copy of the doc, fans them back out to everyone else connected, rate-limits noisy sockets, and schedules the save. It also carries the sharp tools: quarantine, compaction, hard reset, room-to-room bridging, and 15 admin routes.</p>`,
    how: {
      files: ["partykit/party.ts (3,032 lines)", "partykit/admin.ts (1,302 lines)", "partykit/const.ts", "partykit/roomCircuitBreaker.ts"],
      syms: ["PartyServer extends YServer", "onConnect / onMessage / onLoad / onSave", "hibernate: true", "room states: quarantined | loading | transient | save-paused | ready"],
      facts: [["rate limit", "1,000 msg / s"], ["autosave debounce", "3 s / 15 s max"], ["emergency compaction", "16 MB"], ["admin routes", "15"]],
    },
  },
  {
    id: "supa", code: "D", name: "SUPABASE", group: "THE SYNC LOOP", n: "5", g: [28.6, 6.2, 4.6, 4.6, 1.2],
    what: `<p>Cold storage. Rooms persist as one row each in <code>documents</code> &#8212; the whole Y.Doc, base64. The extension's pipeline lands in its own tables: <code>collection_events</code>, <code>daily_counts</code>, <code>page_metadata_history</code>, <code>participants</code>. When a room wakes up, the server reads its row back and replays it into a fresh doc.</p>`,
    how: {
      files: ["partykit/db.ts", "supabase/migrations/20260710201355_production_schema.sql"],
      syms: ["documents (name, document b64)", "retryWithTimeout (3 tries, 5s)", "transient mode on load failure"],
      facts: [["tables", "5"], ["playhtml table", "documents"], ["extension tables", "4"]],
    },
  },

  // ---- presence
  {
    id: "cursors", code: "C", name: "CURSOR CLIENT", group: "PRESENCE", n: "", g: [9.6, 0, 3, 3, 2.2], inside: "in-cursors",
    what: `<p>Everything about other people's pointers. Captures your pointer, throttles it to the server's advertised Hz cap, and sends it down the presence channel <code>cursor</code>. Inbound cursors are animated with a spring so they glide instead of teleporting. Also owns chat bubbles, proximity, and cursor animations.</p>`,
    how: {
      files: ["packages/playhtml/src/cursors/cursor-client.ts (2,456 lines)"],
      syms: ["SpringAnimator", "rAF-throttled sender", "serverCursorMaxHz", "triggerCursorAnimation()"],
      facts: [["channel", "cursor"], ["proximity threshold", "150 px"], ["send throttle", "rAF + server Hz cap"]],
    },
  },
  {
    id: "transport", code: "T", name: "PRESENCE TRANSPORT", group: "PRESENCE", n: "7", g: [14.6, 1, 2, 2, 1.2],
    what: `<p>A second, separate WebSocket &#8212; presence never rides the data socket. One refcounted transport per room, shared by cursors, element awareness, and page presence. The whole wire protocol is seven message types: three up (<code>presence-join</code>, <code>presence-update</code>, <code>presence-clear</code>), four down (<code>presence-sync</code>, <code>presence-changes</code>, <code>presence-rate</code>, <code>presence-error</code>).</p>`,
    how: {
      files: ["packages/playhtml/src/presence-transport.ts", "packages/common/src/presence-protocol.ts (324 lines)"],
      syms: ["RealtimePresenceTransport", "partysocket, party: 'presence'", "presenceTransportsByRoom", "el:shard:0..7"],
      facts: [["message types", "3 up / 4 down"], ["awareness shards", "8 &#215; 4,096 B"], ["value cap", "4,096 B"]],
    },
  },
  {
    id: "presence", code: "PS", name: "PRESENCE SERVER", group: "PRESENCE", n: "DO", g: [21, 0, 3, 3, 2.8], inside: "in-presence",
    what: `<p>The ephemeral room &#8212; a second Durable Object with no Yjs and no database. It validates every message against the protocol, applies it to in-memory room state, and coalesces the fan-out to ~60 broadcasts a second. Each channel bucket has its own speed limit: frames at 90 Hz, interactions at 45, events at 20, control at 10. Close the tab and your presence simply evaporates.</p>`,
    how: {
      files: ["partykit/presenceServer.ts", "partykit/presencePolicy.ts"],
      syms: ["PresenceServer extends Server", "validatePresenceClientMessage()", "PresenceRoomState", "coalesce @ 1000/60 ms"],
      facts: [["Hz budget", "90 / 45 / 20 / 10"], ["channels per conn", "32 max"], ["persistence", "none, by design"]],
    },
  },

  // ---- extension
  {
    id: "collect", code: "X", name: "COLLECTORS", group: "THE EXTENSION", n: "5", g: [6.4, 13.6, 3, 3, 1.8],
    what: `<p>The browser extension's senses &#8212; five collectors watching cursor movement, navigation, viewport, keyboard rhythm, and scrapped elements. Each one can be <code>off</code>, <code>local</code> (stays on your machine), or <code>shared</code>. This is the "we were online" side of the repo: browsing traces, not page state.</p>`,
    how: {
      files: ["extension/src/collectors/CollectorManager.ts", "extension/entrypoints/content.ts (1,625 lines)"],
      syms: ["CursorCollector", "NavigationCollector", "ViewportCollector", "KeyboardCollector", "ScrapCollector"],
      facts: [["collectors", "5"], ["modes", "off / local / shared"], ["extension version", "0.1.22"]],
    },
  },
  {
    id: "buffer", code: "B", name: "EVENT BUFFER", group: "THE EXTENSION", n: "", g: [11.4, 14.2, 2.6, 2.6, 1.6], inside: "in-buffer",
    what: `<p>The staging area between your browser and the network. Events land in IndexedDB first (batched every second, 25 at a time), then upload in 3-second batches with exponential retry backoff from 1s to 30s. Nothing leaves until it's safely written locally &#8212; local-first, upload-second.</p>`,
    how: {
      files: ["extension/src/EventBuffer.ts", "extension/src/LocalEventStore.ts"],
      syms: ["BATCH_INTERVAL_MS = 3000", "STORE_BATCH: 1s / 25 events", "IndexedDB collection_events_db v11", "uploadState: pending | uploaded"],
      facts: [["upload batch", "3 s"], ["local write batch", "1 s / 25"], ["retry backoff", "1 s &#8594; 30 s"]],
    },
  },
  {
    id: "worker", code: "WK", name: "GAME API WORKER", group: "THE EXTENSION", n: "~11", g: [19.4, 14.2, 3, 3, 2.2],
    what: `<p>The extension's own Cloudflare Worker, <code>playhtml-game-api</code>. Ingests event batches at <code>POST /events</code> (max 500 per request), validates them against the shared type contract, splits page metadata into its own deduped table, writes rows to Supabase, and fans live cursor events out to the stream hub.</p>`,
    how: {
      files: ["extension/worker/src/index.ts", "extension/worker/src/routes/ingest.ts", "packages/extension-types/"],
      syms: ["getValidEventTypes()", "MAX_EVENTS_PER_REQUEST = 500", "broadcastLiveEvents()"],
      facts: [["routes", "~11"], ["event types", "5"], ["metadata dedupe", "metadata_hash"]],
    },
  },
  {
    id: "hub", code: "LH", name: "LIVE EVENTS HUB", group: "THE EXTENSION", n: "DO", g: [24.4, 16, 2, 2, 1.6],
    what: `<p>The third Durable Object &#8212; a live stream of cursor events from everyone running the extension, consumed by the wewere.online visualizations over <code>GET /stream</code>. Ephemeral fan-out only; the permanent record is already in Supabase by the time an event reaches here.</p>`,
    how: {
      files: ["extension/worker/src/ (LiveEventsHub DO)"],
      syms: ["LIVE_EVENTS_HUB binding", "GET /stream", "GET /events/recent"],
      facts: [["role", "live fan-out"], ["storage", "none"]],
    },
  },
];

/* edges: L-shaped routes on the floor between node centers */
function center(n: SceneNode): [number, number] {
  return [n.g[0] + n.g[2] / 2, n.g[1] + n.g[3] / 2];
}
const EDGES_DEF: Edge[] = [
  ["web", "init"], ["docs", "init"], ["init", "handler"], ["caps", "handler"], ["react", "handler"],
  ["common", "caps"],
  ["handler", "store"], ["store", "provider"], ["provider", "party"], ["party", "supa"],
  ["cursors", "transport"], ["transport", "presence"], ["handler", "transport"],
  ["collect", "buffer"], ["buffer", "worker"], ["worker", "supa"], ["worker", "hub"],
];

/* zones: dashed floor boundaries */
const ZONES: Zone[] = [
  { label: "THE BROWSER", x0: -1.5, y0: -1.5, x1: 19.6, y1: 18 },
  { label: "CLOUDFLARE EDGE", x0: 20.2, y0: -1.5, x1: 27.4, y1: 18.6 },
  { label: "STORAGE", x0: 28, y0: 4.6, x1: 34, y1: 12 },
];

/* ============================================================
   events — the moving dots. each is a REAL flow.

   `simulate` (on `state`, below) drives the random auto-spawner block in
   tickInner(). A later change can flip simulation off per-pipeline (via
   `state.livePipelines`) and call spawnEvent() directly from network
   callbacks instead — spawnEvent() is the single entry point for putting
   a dot on the stage, whether it's fake or real.
============================================================ */
const EVENTS: EventDef[] = [
  {
    id: "setdata", name: "setData write", color: C_TEAL, weight: 5, speed: 150,
    hops: [["handler", "store"], ["store", "provider"], ["provider", "party"]],
    title: "A setData write",
    sub: "shared, persistent state &#183; teal pipeline",
    payload: `handler.setData({ x: 412.5, y: 118 })\n// lands at play["can-move"]["#couch"]`,
    chain: [
      ["ElementHandler", "setData(value)", "elements.ts &#183; render-loop guard first"],
      ["core", "doc.transact(() =&gt; applyElementDataChange(...))", "one CRDT transaction"],
      ["SyncedStore", "play[\"can-move\"][\"#couch\"] mutates", "Y.Map underneath"],
      ["YProvider", "encodes y-protocols sync msg", "binary update"],
      ["WebSocket", "wss://api.playhtml.fun/parties/main/&lt;room&gt;", ""],
      ["PartyServer", "onMessage &#8594; merge &#8594; broadcast", "rate limit 1,000/s"],
    ],
    facts: [["debounced variant", "setDataDebounced, 300 ms"], ["write gate", "canWriteElementData()"], ["blocked during", "render (loop defense)"]],
  },
  {
    id: "remote", name: "remote update in", color: C_TEAL, weight: 4, speed: 150,
    hops: [["party", "provider", 1], ["provider", "store", 1], ["store", "handler", 1]],
    title: "A remote update arriving",
    sub: "someone else moved something &#183; teal pipeline, inbound",
    payload: `observeDeep fires for "can-move:#couch"\nhandler.__data = clonePlain(proxy)  &#8594; render()`,
    chain: [
      ["PartyServer", "broadcasts peer's update", "to every other socket in the room"],
      ["YProvider", "applies update to local Y.Doc", ""],
      ["observer", "observeDeep &#8594; queueMicrotask", "coalesced: one apply per microtask"],
      ["ElementHandler", "__data setter &#8594; render()", "view (lit-html) or updateElement"],
    ],
    facts: [["loop defense", "remoteApplyingKeys distinguishes remote writes"], ["paint", "same frame as microtask"]],
  },
  {
    id: "cursor", name: "cursor ping", color: C_COBALT, weight: 8, speed: 210,
    hops: [["cursors", "transport"], ["transport", "presence"]],
    title: "A cursor ping",
    sub: "ephemeral presence &#183; cobalt pipeline",
    payload: `{ type: "presence-update", channel: "cursor",\n  value: { x: 0.42, y: 0.31, pointer: "mouse" } }`,
    chain: [
      ["CursorClient", "pointermove &#8594; rAF throttle", "capped at serverCursorMaxHz"],
      ["PresenceTransport", "presence-update on channel \"cursor\"", "separate socket from data"],
      ["PresenceServer", "validate &#8594; PresenceRoomState", "frame bucket: 90 Hz budget"],
      ["fan-out", "presence-changes to peers", "coalesced ~60/s"],
    ],
    facts: [["persistence", "none &#8212; evaporates on disconnect"], ["spring render", "SpringAnimator, rAF"]],
  },
  {
    id: "pchanges", name: "presence-changes", color: C_COBALT, weight: 5, speed: 210,
    hops: [["presence", "transport", 1], ["transport", "cursors", 1]],
    title: "presence-changes fan-out",
    sub: "the room telling you where everyone is &#183; cobalt, inbound",
    payload: `{ type: "presence-changes",\n  updates: { "p:9f2c...": { cursor: {...} } },\n  removes: { "p:41ab...": ["cursor"] } }`,
    chain: [
      ["PresenceServer", "coalesce window closes", "1000/60 ms tick"],
      ["PresenceTransport", "one message, all changed peers", ""],
      ["CursorClient", "spring-animate each cursor", "glide, not teleport"],
    ],
    facts: [["broadcast rate", "~60/s max"], ["join snapshot", "presence-sync on connect"]],
  },
  {
    id: "elaw", name: "element awareness", color: C_COBALT, weight: 2, speed: 190,
    hops: [["handler", "transport"], ["transport", "presence"]],
    title: "setMyAwareness",
    sub: "per-element presence (hover, focus) &#183; cobalt pipeline",
    payload: `handler.setMyAwareness({ hover: true })\n// rides channel el:shard:3`,
    chain: [
      ["ElementHandler", "setMyAwareness(v)", "dedupes identical refs"],
      ["ElementAwarenessClient", "shard by element id", "el:shard:0..7"],
      ["PresenceTransport", "presence-update", "4,096 B value cap"],
      ["PresenceServer", "interactive bucket", "45 Hz budget"],
    ],
    facts: [["shards", "8 &#215; 4 KB &#8776; 32 KB budget"], ["overflow", "dropped with a warning"]],
  },
  {
    id: "autosave", name: "autosave upsert", color: C_GOLD, weight: 2, speed: 110,
    hops: [["party", "supa"]],
    title: "The autosave",
    sub: "room &#8594; cold storage &#183; gold pipeline",
    payload: `supabase.from("documents").upsert({\n  name: room, document: base64(Y.encodeStateAsUpdate(doc)) })`,
    chain: [
      ["PartyServer", "onSave fires", "debounce 3 s, max wait 15 s"],
      ["compaction", "pre-persist check at 8 MB", "emergency at 16 MB"],
      ["Supabase", "one row per room in documents", "whole doc, base64"],
    ],
    facts: [["debounce", "3,000 / 15,000 ms"], ["load-back", "onLoad &#8594; Y.applyUpdate"], ["failure mode", "transient: awareness-only"]],
  },
  {
    id: "extbatch", name: "extension batch", color: C_RUST, weight: 3, speed: 130,
    hops: [["collect", "buffer"], ["buffer", "worker"], ["worker", "supa"]],
    title: "An extension event batch",
    sub: "browsing traces &#183; rust pipeline",
    payload: `POST /events  (&#8804; 500 events)\n[{ type: "cursor", domain: "are.na", t: ... }, ...]`,
    chain: [
      ["Collector", "cursor / navigation / viewport / keyboard / element", "5 collectors"],
      ["EventBuffer", "IndexedDB first, then batch", "local-first: 1 s store, 3 s upload"],
      ["Worker", "validate against extension-types", "cap 500 per request"],
      ["Supabase", "collection_events + daily_counts", "metadata deduped by hash"],
    ],
    facts: [["retry backoff", "1 s &#8594; 30 s"], ["consent", "per-collector: off / local / shared"]],
  },
  {
    id: "livefan", name: "live stream fan-out", color: C_RUST, weight: 1, speed: 170,
    hops: [["worker", "hub"]],
    title: "Live stream fan-out",
    sub: "same events, second life &#183; rust pipeline",
    payload: `broadcastLiveEvents(batch)\n// &#8594; every GET /stream subscriber`,
    chain: [
      ["Worker", "after the Supabase write", "permanence first"],
      ["LiveEventsHub", "Durable Object fan-out", "wewere.online visualizations listen"],
    ],
    facts: [["storage here", "none"], ["consumer", "GET /stream"]],
  },
];

/* ============================================================
   inside scenes — zoomed step diagrams
============================================================ */
function chainScene(
  title: string,
  sub: string,
  steps: Array<[string, string, string]>,
  color: string
): InsideScene {
  const nodes: SceneNode[] = steps.map((s, i) => ({
    id: "s" + i, code: s[0], name: s[1], g: [i * 5.6, i * 2.3, 2.6, 2.6, 1.5],
    what: `<p>${s[2]}</p>`, how: null, step: i + 1, total: steps.length,
  }));
  const edges: Edge[] = [];
  for (let i = 0; i < steps.length - 1; i++) edges.push(["s" + i, "s" + (i + 1)]);
  return {
    title, sub, nodes, edges, zones: [], loopColor: color,
    events: [{
      id: "loop", name: title, color, weight: 1, speed: 120,
      hops: edges.map((e) => [e[0], e[1]]),
    }],
  };
}
const INSIDE: Record<string, InsideScene> = {
  "in-handler": chainScene("Inside the Element Handler", "one setData, start to paint", [
    ["1", "WRITE GUARD", "<code>rejectWriteDuringRender</code> &#8212; if this write was made synchronously during a render, it is refused. This is the defense against the classic footgun: a write that re-triggers the render that made it, forever, appending CRDT ops each time."],
    ["2", "ONCHANGE", "<code>elementData.onChange(value)</code> &#8212; first checks <code>canWriteElementData()</code> (shared read-only consumers are refused), then opens a single Yjs transaction."],
    ["3", "TRANSACT", "<code>doc.transact(() =&gt; applyElementDataChange(...))</code> &#8212; a mutator function runs against the live CRDT proxy; a plain value goes through <code>deepReplaceIntoProxy</code> instead."],
    ["4", "OBSERVE", "<code>observeDeep</code> fires for the key <code>tag:elementId</code>, coalesced with <code>queueMicrotask</code> so a burst of changes becomes one apply."],
    ["5", "SNAPSHOT", "<code>handler.__data = clonePlain(proxy)</code> &#8212; the handler never hands you a live proxy, always a plain copy."],
    ["6", "RENDER", "view mode renders the lit-html template; imperative mode calls your <code>updateElement</code>. Same path whether the change was yours or a stranger's."],
  ], C_TEAL),
  "in-party": chainScene("Inside the Party Server", "one message through the room", [
    ["1", "GATES", "<code>onConnect</code> refuses while load-deferred (close 1013), waits out empty-room compaction, and checks your <code>clientResetEpoch</code> &#8212; stale clients get a <code>room-reset</code> and a goodbye."],
    ["2", "RATE LIMIT", "<code>onMessage</code> counts per connection: 1,000 messages per rolling second. Beyond that, the socket is closed. Stale-epoch sockets are rejected here too."],
    ["3", "MERGE", "<code>super.onMessage</code> (YServer) applies the update to the server's own Y.Doc &#8212; the same CRDT merge that runs on every client."],
    ["4", "BROADCAST", "The update fans out to every other connection held by this Durable Object. Peers apply it and their elements repaint."],
    ["5", "SCHEDULE SAVE", "<code>onSave</code> is debounced: 3 s of quiet, or 15 s max under constant writes. Pre-persist compaction kicks in at 8 MB; emergency compaction at 16 MB."],
    ["6", "PERSIST", "<code>persistLiveDocument</code> &#8594; <code>supabase.from(\"documents\").upsert(...)</code>. If Supabase is unreachable, the room drops to <i>transient</i> mode: awareness still flows, shared writes stop."],
  ], C_TEAL),
  "in-presence": chainScene("Inside the Presence Server", "a ping through the ephemeral room", [
    ["1", "VALIDATE", "<code>validatePresenceClientMessage</code> &#8212; shape-checked against the 7-type protocol. Ten invalid messages in a second closes the socket."],
    ["2", "POLICY", "<code>presencePolicy</code> buckets the channel and meters it: frame 90 Hz, interactive 45, event 20, control 10. Over budget gets a <code>presence-rate</code> reply, not silence."],
    ["3", "APPLY", "The value lands in <code>PresenceRoomState</code> &#8212; plain in-memory state. No Yjs, no rows, nothing to compact."],
    ["4", "COALESCE", "Changes buffer for one tick (1000/60 ms) so sixty people wiggling cursors becomes one <code>presence-changes</code> per frame, not sixty."],
    ["5", "FAN OUT", "<code>presence-changes</code> goes to every subscriber of that channel. Disconnect and your entry just disappears from the next sync."],
  ], C_COBALT),
  "in-cursors": chainScene("Inside the Cursor Client", "your pointer, everyone's screens", [
    ["1", "CAPTURE", "<code>pointermove</code> on the page. Coordinates are normalized so they land sensibly on other people's viewport sizes."],
    ["2", "THROTTLE", "A rAF gate clamped to the server-advertised <code>serverCursorMaxHz</code> &#8212; the server tells clients how fast it wants to hear from them."],
    ["3", "SEND", "<code>presence-update</code> on channel <code>cursor</code> over the shared presence transport &#8212; never the data socket."],
    ["4", "RECEIVE", "Peer positions arrive in <code>presence-changes</code>; each remote cursor gets a <code>SpringAnimator</code> so 20 Hz of network becomes 60 Hz of glide."],
    ["5", "RENDER", "DOM cursors, chat bubbles, proximity checks (150 px threshold), and one rAF loop driving all the springs."],
  ], C_COBALT),
  "in-buffer": chainScene("Inside the Event Buffer", "local-first, upload-second", [
    ["1", "INGEST", "A collector emits an event &#8212; cursor, navigation, viewport, keyboard, or element scrap."],
    ["2", "LOCAL WRITE", "Batched into IndexedDB (<code>collection_events_db</code> v11) every second, 25 events at a time, marked <code>uploadState: pending</code>. Your machine has it before the network does."],
    ["3", "UPLOAD BATCH", "Every 3 seconds, pending events go to <code>POST /events</code> &#8212; up to 500 per request."],
    ["4", "RETRY", "Failures back off exponentially, 1 s to 30 s. The service worker also answers a <code>FLUSH_PENDING_UPLOADS</code> message to push stragglers."],
    ["5", "MARK", "Acknowledged events flip to <code>uploaded</code>. The local copy stays &#8212; it powers the extension's own local views."],
  ], C_RUST),
};

/* ============================================================
   overview panel (default)
============================================================ */
const OVERVIEW = {
  what: `
    <div class="eyebrow">playhtml</div>
    <h1>The playhtml Machine</h1>
    <div class="sub">how a data attribute becomes a shared, living thing</div>
    <h2>What this is</h2>
    <p>This repository makes HTML elements <mark>collaboratively alive</mark>. You write
    <code>&lt;div id="couch" can-move&gt;</code>; the library gives that div shared state,
    syncs it to everyone on the page in real time, and remembers it forever.</p>
    <p>The map is a pipeline because the system is one: a page boots &#8594; elements declare
    capabilities &#8594; every interaction becomes a CRDT write &#8594; a Durable Object per room
    merges and re-broadcasts &#8594; Supabase keeps the permanent copy. Presence (cursors, hover)
    rides a <mark>second, separate socket</mark> that never persists anything. The bottom lane
    is a different animal entirely: the browser extension collecting browsing traces into its
    own worker and tables.</p>
    <h2>The moving dots are real</h2>
    <div class="legend">
      <div class="row"><span class="dotchip" style="background:${C_TEAL}"></span>shared data &#8212; setData writes and remote updates</div>
      <div class="row"><span class="dotchip" style="background:${C_COBALT}"></span>presence &#8212; cursor pings, hover awareness, fan-out</div>
      <div class="row"><span class="dotchip" style="background:${C_GOLD}"></span>persistence &#8212; the debounced autosave</div>
      <div class="row"><span class="dotchip" style="background:${C_RUST}"></span>extension &#8212; browsing-trace batches</div>
    </div>
    <p>Each dot is one concrete event with its real payload shape and its real code path.
    <mark>Click a dot</mark> to see its hop-by-hop chain. <mark>Trace one event</mark> (top right)
    freezes the flow and walks a single event through, hop by hop.</p>
    <h2>How to read it</h2>
    <p>Hover anything for a plain description; the <mark>How it's built</mark> tab gives files,
    symbols, and the load-bearing numbers. Blocks with <mark>&#8594; go inside</mark> zoom into
    their steps in execution. Tall blocks are the stateful parts; flat slabs are storage.</p>`,
  how: `
    <div class="eyebrow">playhtml</div>
    <h1>The repository</h1>
    <div class="sub">4 published packages, 9 workspaces, 3 Durable Objects</div>
    <h2>Packages</h2>
    <ul>
      <li><b>playhtml</b> 2.14.1 &#8212; the core runtime (~8,400 lines, 22 modules, 33 test files)</li>
      <li><b>@playhtml/react</b> 2.1.0 &#8212; provider, 6 components, 7 hooks</li>
      <li><b>@playhtml/common</b> 0.9.0 &#8212; types, capabilities, wire protocol</li>
      <li><b>@playhtml/extension-types</b> &#8212; the extension &#8596; worker event contract</li>
    </ul>
    <h2>Servers</h2>
    <ul>
      <li><b>PartyServer</b> &#8212; one Durable Object per room, Yjs + persistence + admin</li>
      <li><b>PresenceServer</b> &#8212; ephemeral presence, no storage at all</li>
      <li><b>LiveEventsHub</b> &#8212; live stream for the extension's events</li>
    </ul>
    <h2>The load-bearing numbers</h2>
    <div class="factgrid">
      <div class="fk">message rate limit</div><div class="fv">1,000 / s</div>
      <div class="fk">autosave debounce</div><div class="fv">3 s / 15 s max</div>
      <div class="fk">setData default debounce</div><div class="fv">300 ms</div>
      <div class="fk">presence Hz budget</div><div class="fv">90 / 45 / 20 / 10</div>
      <div class="fk">presence value cap</div><div class="fv">4,096 B</div>
      <div class="fk">compaction: pre-persist / emergency</div><div class="fv">8 MB / 16 MB</div>
      <div class="fk">extension upload batch</div><div class="fv">3 s, &#8804;500 events</div>
      <div class="fk">largest file</div><div class="fv">admin.tsx, 3,570 lines</div>
    </div>
    <h2>Where things live</h2>
    <div class="filerow"><b>packages/</b> &#8212; the libraries</div>
    <div class="filerow"><b>partykit/</b> &#8212; the room servers</div>
    <div class="filerow"><b>extension/</b> + <b>extension/worker/</b> &#8212; "we were online"</div>
    <div class="filerow"><b>website/</b>, <b>apps/docs/</b> &#8212; playhtml.fun and /docs</div>
    <div class="filerow"><b>supabase/migrations/</b> &#8212; one project, five tables</div>`,
};

/* ============================================================
   renderer
============================================================ */
const svg = document.getElementById("stage") as unknown as SVGSVGElement;
const world = el("g", {}, svg);
const layerFloor = el("g", {}, world);
const layerEdges = el("g", {}, world);
const layerBlocks = el("g", {}, world);
const layerDots = el("g", {}, world);

const defs = el("defs", {}, svg);
function makeHatch(id: string, angle: number, gap: number, color: string, w: number): void {
  const p = el("pattern", { id, width: gap, height: gap, patternUnits: "userSpaceOnUse", patternTransform: `rotate(${angle})` }, defs);
  el("line", { x1: 0, y1: 0, x2: 0, y2: gap, stroke: color, "stroke-width": w }, p);
}
makeHatch("hatchR", 45, 4.2, "rgba(32,48,59,0.5)", 1);
makeHatch("hatchL", -45, 5.2, "rgba(32,48,59,0.35)", 1);
makeHatch("hatchT", 45, 3.2, "rgba(32,48,59,0.16)", 0.8);

/* ============================================================
   particle (moving dot) — one live instance of an EventDef
   traveling along the current scene's edges
============================================================ */
interface Particle {
  evt: EventDef;
  hopIdx: number;
  dist: number;
  speed: number;
  traced: boolean;
  el: SVGGElement | null;
  done: boolean;
  wx?: number;
  wy?: number;
  /** The real message this dot came from, when it was spawned by live traffic.
   * Shown in place of the canned sample payload in the detail panel. */
  livePayload?: string;
}

interface Selection {
  type: "node" | "event";
  id: string;
}

interface AppState {
  scene: string; // "main" or an INSIDE key
  paused: boolean;
  tracing: Particle | null;
  selected: Selection | null;
  tab: "what" | "how";
  cam: { x: number; y: number; k: number };
  particles: Particle[];
  spawnTimer: number;
  edgePaths: Record<string, EdgePath>;
  nodeEls: Record<string, { g: SVGGElement; sel: SVGPolygonElement }>;
  reduced: boolean;
  /**
   * When true (default), the auto-spawner in tickInner() manufactures
   * synthetic particles for every event id whose pipeline is not live.
   */
  simulate: boolean;
  /**
   * Which event ids are currently fed by real traffic. Keyed by EventDef id;
   * true suppresses that event's synthetic spawns because diagramLive.ts is
   * spawning real ones. Flipped back to false when a socket drops, so the
   * simulator resumes for that pipeline only.
   */
  livePipelines: Record<string, boolean>;
}

const state: AppState = {
  scene: "main",
  paused: false,
  tracing: null,
  selected: null,
  tab: "what",
  cam: { x: 0, y: 0, k: 1 },
  particles: [],
  spawnTimer: 0,
  edgePaths: {},
  nodeEls: {},
  reduced: matchMedia("(prefers-reduced-motion: reduce)").matches,
  simulate: true,
  livePipelines: Object.fromEntries(EVENTS.map((e) => [e.id, false])),
};

function edgeKey(a: string, b: string): string {
  return a + "->" + b;
}

function routePoints(na: SceneNode, nb: SceneNode): Array<[number, number]> {
  const [ax, ay] = center(na),
    [bx, by] = center(nb);
  const p: Array<[number, number]> = [[ax, ay]];
  if (Math.abs(ax - bx) > 0.4 && Math.abs(ay - by) > 0.4) p.push([bx, ay]);
  p.push([bx, by]);
  return p;
}

interface EdgePath {
  proj: Array<[number, number]>;
  cum: number[];
  total: number;
  grid: Array<[number, number]>;
}

function buildEdgeGeometry(nodes: SceneNode[], edges: Edge[]): Record<string, EdgePath> {
  const byId: Record<string, SceneNode> = {};
  nodes.forEach((n) => (byId[n.id] = n));
  const paths: Record<string, EdgePath> = {};
  for (const e of edges) {
    const g = routePoints(byId[e[0]], byId[e[1]]);
    const proj = g.map((p) => iso(p[0], p[1], 0));
    const cum = [0];
    for (let i = 1; i < proj.length; i++) {
      const dx = proj[i][0] - proj[i - 1][0],
        dy = proj[i][1] - proj[i - 1][1];
      cum.push(cum[i - 1] + Math.hypot(dx, dy));
    }
    paths[edgeKey(e[0], e[1])] = { proj, cum, total: cum[cum.length - 1], grid: g };
  }
  return paths;
}

function pointAt(path: EdgePath, dist: number, rev: boolean): [number, number] {
  const d = rev ? path.total - dist : dist;
  const { proj, cum } = path;
  let i = 1;
  while (i < cum.length - 1 && cum[i] < d) i++;
  const seg = cum[i] - cum[i - 1] || 1;
  const t = Math.min(1, Math.max(0, (d - cum[i - 1]) / seg));
  return [
    proj[i - 1][0] + (proj[i][0] - proj[i - 1][0]) * t,
    proj[i - 1][1] + (proj[i][1] - proj[i - 1][1]) * t,
  ];
}

function drawBlock(n: SceneNode, parent: SVGGElement): SVGGElement {
  const [gx, gy, w, d, h] = n.g;
  const g = el("g", { class: "block", "data-id": n.id, cursor: "pointer" }, parent);
  const layers: Array<[number, number]> = n.stack
    ? Array.from({ length: n.stack }, (_, i) => [i * 0.34, 0.22])
    : [[0, h]];
  for (const [z0, hh] of layers) {
    const A = iso(gx, gy, z0 + hh),
      B = iso(gx + w, gy, z0 + hh),
      Cc = iso(gx + w, gy + d, z0 + hh),
      Dd = iso(gx, gy + d, z0 + hh);
    const Bb = iso(gx + w, gy, z0),
      Cb = iso(gx + w, gy + d, z0),
      Db = iso(gx, gy + d, z0);
    el("polygon", { points: pts([B, Cc, Cb, Bb]), fill: "var(--face-right)", stroke: "var(--line)", "stroke-width": 1.2 }, g);
    el("polygon", { points: pts([B, Cc, Cb, Bb]), fill: "url(#hatchR)", stroke: "none" }, g);
    el("polygon", { points: pts([Dd, Cc, Cb, Db]), fill: "var(--face-left)", stroke: "var(--line)", "stroke-width": 1.2 }, g);
    el("polygon", { points: pts([Dd, Cc, Cb, Db]), fill: "url(#hatchL)", stroke: "none" }, g);
    el("polygon", { points: pts([A, B, Cc, Dd]), fill: "var(--face-top)", stroke: "var(--line)", "stroke-width": 1.2 }, g);
    if (h > 1.8 && !n.stack)
      el("polygon", { points: pts([A, B, Cc, Dd]), fill: "url(#hatchT)", stroke: "none" }, g);
  }
  // selection outline (top face of top layer)
  const zTop = n.stack ? (n.stack - 1) * 0.34 + 0.22 : h;
  const A = iso(gx, gy, zTop),
    B = iso(gx + w, gy, zTop),
    Cc = iso(gx + w, gy + d, zTop),
    Dd = iso(gx, gy + d, zTop);
  const sel = el("polygon", { points: pts([A, B, Cc, Dd]), fill: "none", stroke: "var(--hi)", "stroke-width": 2.5, opacity: 0, "pointer-events": "none" }, g);
  // label
  const [cx0, cy0] = iso(gx + w / 2, gy + d / 2, zTop);
  el("text", {
    x: cx0, y: cy0 + 4, "text-anchor": "middle",
    "font-size": 13, "font-weight": 600, fill: "var(--ink)",
    "letter-spacing": "0.05em", "pointer-events": "none",
  }, g).textContent = n.code;
  if (n.inside) {
    el("text", { x: cx0, y: cy0 + 16, "text-anchor": "middle", "font-size": 8, fill: "var(--ink-soft)", "pointer-events": "none" }, g).textContent = "→";
  }
  if (n.step) {
    const [lx, ly] = iso(gx, gy + d + 0.5, 0);
    el("text", {
      x: lx, y: ly + 10, "text-anchor": "middle",
      "font-size": 9, fill: "var(--ink-soft)", "letter-spacing": "0.14em", "pointer-events": "none",
    }, g).textContent = n.name;
  }
  g.addEventListener("pointerenter", () => {
    if (!state.selected || state.selected.id !== n.id) showNode(n);
  });
  g.addEventListener("click", (ev) => { ev.stopPropagation(); selectNode(n); });
  g.addEventListener("dblclick", (ev) => { ev.stopPropagation(); if (n.inside) enterInside(n.inside); });
  state.nodeEls[n.id] = { g, sel };
  return g;
}

function drawEdge(_key: string, path: EdgePath, parent: SVGGElement): void {
  el("polyline", {
    points: pts(path.proj),
    fill: "none", stroke: "var(--line)", "stroke-width": 1.3,
  }, parent);
  // diamonds at bends
  for (let i = 1; i < path.proj.length - 1; i++) {
    const [x, y] = path.proj[i];
    el("rect", { x: x - 3, y: y - 3, width: 6, height: 6, transform: `rotate(45 ${x} ${y})`, fill: "var(--ground)", stroke: "var(--line)", "stroke-width": 1.2 }, parent);
  }
  // arrowhead at end
  const n = path.proj.length;
  const [ex, ey] = path.proj[n - 1],
    [px, py] = path.proj[n - 2];
  const ang = Math.atan2(ey - py, ex - px);
  const a1: [number, number] = [ex - 8 * Math.cos(ang - 0.4), ey - 8 * Math.sin(ang - 0.4)];
  const a2: [number, number] = [ex - 8 * Math.cos(ang + 0.4), ey - 8 * Math.sin(ang + 0.4)];
  el("polygon", { points: pts([[ex, ey], a1, a2]), fill: "var(--line)" }, parent);
}

function drawZone(z: Zone, parent: SVGGElement): void {
  const A = iso(z.x0, z.y0),
    B = iso(z.x1, z.y0),
    Cc = iso(z.x1, z.y1),
    Dd = iso(z.x0, z.y1);
  el("polygon", { points: pts([A, B, Cc, Dd]), fill: "none", stroke: "rgba(32,48,59,0.45)", "stroke-width": 1, "stroke-dasharray": "5 5" }, parent);
  const [lx, ly] = iso(z.x0 + 0.4, z.y0 + 0.4);
  el("text", { x: lx + 8, y: ly + 4, "font-size": 9.5, fill: "var(--ink-faint)", "letter-spacing": "0.2em" }, parent).textContent = z.label;
}

function drawGrid(parent: SVGGElement, x0: number, y0: number, x1: number, y1: number): void {
  for (let x = x0; x <= x1; x += 2) {
    const a = iso(x, y0),
      b = iso(x, y1);
    el("line", { x1: a[0], y1: a[1], x2: b[0], y2: b[1], stroke: "rgba(32,48,59,0.07)", "stroke-width": 1 }, parent);
  }
  for (let y = y0; y <= y1; y += 2) {
    const a = iso(x0, y),
      b = iso(x1, y);
    el("line", { x1: a[0], y1: a[1], x2: b[0], y2: b[1], stroke: "rgba(32,48,59,0.07)", "stroke-width": 1 }, parent);
  }
}

/* ============================================================
   scene management
============================================================ */
let sceneNodes: SceneNode[] = [],
  sceneEdges: Edge[] = [],
  sceneEvents: EventDef[] = [];

function renderScene(): void {
  layerFloor.innerHTML = "";
  layerEdges.innerHTML = "";
  layerBlocks.innerHTML = "";
  layerDots.innerHTML = "";
  state.particles = [];
  state.nodeEls = {};
  state.tracing = null;
  const crumb = document.getElementById("crumb") as HTMLDivElement;
  if (state.scene === "main") {
    sceneNodes = NODES; sceneEdges = EDGES_DEF; sceneEvents = EVENTS;
    drawGrid(layerFloor, -2, -2, 36, 20);
    ZONES.forEach((z) => drawZone(z, layerFloor));
    crumb.style.display = "none";
  } else {
    const sc = INSIDE[state.scene];
    sceneNodes = sc.nodes; sceneEdges = sc.edges; sceneEvents = sc.events;
    drawGrid(layerFloor, -2, -2, 30, 16);
    crumb.style.display = "block";
    (document.querySelector("#crumb .where") as HTMLSpanElement).textContent = sc.title.toUpperCase();
  }
  state.edgePaths = buildEdgeGeometry(sceneNodes, sceneEdges);
  for (const e of sceneEdges) drawEdge(edgeKey(e[0], e[1]), state.edgePaths[edgeKey(e[0], e[1])], layerEdges);
  const sorted = [...sceneNodes].sort((a, b) => (a.g[0] + a.g[1] + a.g[2] + a.g[3]) - (b.g[0] + b.g[1] + b.g[2] + b.g[3]));
  for (const n of sorted) drawBlock(n, layerBlocks);
  fitView();
  refreshSelection();
}

function fitView(): void {
  const bb = world.getBBox();
  const wrap = document.getElementById("stage-wrap") as HTMLDivElement;
  const W = wrap.clientWidth,
    H = wrap.clientHeight;
  if (W < 200 || H < 200 || !bb.width) { setTimeout(fitView, 150); return; }
  const pad = 50;
  const k = Math.max(0.15, Math.min((W - pad * 2) / bb.width, (H - pad * 2) / bb.height, 1.6));
  state.cam.k = k;
  state.cam.x = W / 2 - (bb.x + bb.width / 2) * k;
  state.cam.y = H / 2 - (bb.y + bb.height / 2) * k;
  applyCam();
}
function applyCam(): void {
  world.setAttribute("transform", `translate(${state.cam.x},${state.cam.y}) scale(${state.cam.k})`);
}

function enterInside(key: string): void {
  state.scene = key;
  state.selected = null;
  renderScene();
  const sc = INSIDE[key];
  setPanel(`<div class="eyebrow">inside</div><h1>${sc.title}</h1><div class="sub">${sc.sub}</div>
    <p>Hover each numbered block to read its step. One dot loops the whole path continuously.</p>
    <p><button class="go-inside" onclick="window.__exitInside()">&#8592; Come back out</button></p>`);
}
(window as any).__exitInside = function (): void {
  state.scene = "main";
  state.selected = null;
  renderScene();
  setPanel(state.tab === "what" ? OVERVIEW.what : OVERVIEW.how);
  refreshSidebar();
};

/* ============================================================
   particles

   spawnEvent() is the single entry point for placing a dot on the stage.
   Today only tickInner()'s simulate-guarded block calls it (see below);
   a later live-data wiring can call it directly from network callbacks
   without touching anything else in this file.
============================================================ */
function spawnEvent(evt: EventDef, traced?: boolean, livePayload?: string): Particle {
  const p: Particle = {
    evt, hopIdx: 0, dist: 0,
    speed: (evt.speed || 150) * (traced ? 0.45 : 1),
    traced: !!traced,
    el: null, done: false,
    livePayload,
  };
  const g = el("g", { cursor: "pointer" }, layerDots);
  el("circle", { r: traced ? 7 : 4.5, fill: evt.color, stroke: "var(--line)", "stroke-width": 1.2 }, g);
  el("circle", { r: 13, fill: "transparent" }, g); // hit area
  if (traced) el("circle", { r: 11, fill: "none", stroke: evt.color, "stroke-width": 1.5, opacity: 0.5, class: "pulse" }, g);
  g.addEventListener("click", (ev) => { ev.stopPropagation(); selectEventParticle(p); });
  p.el = g;
  state.particles.push(p);
  return p;
}

function currentHopPath(p: Particle): { path: EdgePath | undefined; rev: boolean } {
  const hop = p.evt.hops[p.hopIdx];
  const key = edgeKey(hop[0], hop[1]);
  let path = state.edgePaths[key],
    rev = false;
  if (!path) { path = state.edgePaths[edgeKey(hop[1], hop[0])]; rev = true; }
  if (hop[2]) {
    // explicit reverse: hop given as [from,to,1] meaning traverse edge to->from... normalize
    const k2 = edgeKey(hop[1], hop[0]);
    if (state.edgePaths[k2]) { path = state.edgePaths[k2]; rev = true; }
  }
  return { path, rev };
}

let lastT = performance.now();
function tick(now: number): void {
  try { tickInner(now); } catch (err) { console.error("tick died:", err); }
  requestAnimationFrame(tick);
}
setInterval(() => {
  if (!document.hidden) return;
  try { tickInner(performance.now()); } catch (err) { console.error("tick died:", err); }
}, 120);
function tickInner(now: number): void {
  const dt = Math.min(0.05, (now - lastT) / 1000);
  lastT = now;
  const flowing = !state.paused && !state.reduced;
  // spawn
  if (state.scene !== "main") {
    // keep exactly one looping particle alive in inside scenes
    if (!state.particles.some((p) => !p.done) && !state.reduced) {
      spawnEvent(sceneEvents[0]);
    }
  } else if (state.simulate && flowing) {
    // ---- synthetic auto-spawner block ----
    // Manufactures particles from the EVENTS pool, weighted by evt.weight, for
    // every event id whose pipeline is NOT live. Live pipelines spawn their own
    // dots from real network callbacks (see diagramLive.ts) and are skipped here.
    state.spawnTimer -= dt;
    if (state.spawnTimer <= 0 && state.particles.filter((p) => !p.done).length < 26) {
      const pool: EventDef[] = [];
      for (const e of sceneEvents) {
        if (state.livePipelines[e.id]) continue;
        for (let i = 0; i < e.weight; i++) pool.push(e);
      }
      if (pool.length) spawnEvent(pool[Math.floor(Math.random() * pool.length)]);
      state.spawnTimer = 0.28 + Math.random() * 0.5;
    }
    // ---- end synthetic auto-spawner block ----
  }
  // move
  for (const p of state.particles) {
    if (p.done) continue;
    const move = p.traced ? !state.reduced : flowing || state.scene !== "main";
    if (move) p.dist += p.speed * dt;
    const { path, rev } = currentHopPath(p);
    if (!path) { p.done = true; p.el?.remove(); continue; }
    if (p.dist >= path.total) {
      p.dist = 0; p.hopIdx++;
      if (p.hopIdx >= p.evt.hops.length) {
        if (state.scene !== "main") { p.hopIdx = 0; } // loop inside scenes
        else {
          p.done = true;
          p.el?.remove();
          if (p.traced) { state.tracing = null; traceArrived(p.evt); }
          continue;
        }
      }
      if (p.traced) updateTracePanel(p);
    }
    const [x, y] = pointAt(path, p.dist, rev);
    p.wx = x; p.wy = y;
    const s = Math.min(2.4, Math.max(1, 0.95 / state.cam.k));
    p.el?.setAttribute("transform", `translate(${x},${y}) scale(${s})`);
  }
  state.particles = state.particles.filter((p) => !p.done);
}
requestAnimationFrame(tick);

/* ============================================================
   panel
============================================================ */
const panelBody = document.getElementById("panel-body") as HTMLDivElement;
function setPanel(html: string): void {
  panelBody.innerHTML = html;
  panelBody.scrollTop = 0;
}

function nodePanelHTML(n: SceneNode, tab: "what" | "how"): string {
  const head = `<div class="eyebrow">${n.group || "structure"}${n.step ? " &#183; step " + n.step + " of " + n.total : ""}</div>
    <h1>${n.name.replace(/&amp;/g, "&")}</h1>`;
  if (tab === "how" && n.how) {
    let h = head + `<div class="sub">files, symbols, numbers</div><h2>Files</h2>`;
    h += n.how.files.map((f) => `<div class="filerow"><b>${f}</b></div>`).join("");
    h += `<h2>Key symbols</h2><ul>` + n.how.syms.map((s) => `<li><code>${s}</code></li>`).join("") + `</ul>`;
    if (n.how.facts.length) {
      h += `<h2>Numbers</h2><div class="factgrid">` +
        n.how.facts.map((f) => `<div class="fk">${f[0]}</div><div class="fv">${f[1]}</div>`).join("") + `</div>`;
    }
    if (n.inside) h += `<button class="go-inside" onclick="window.__goInside('${n.inside}')">&#8594; Go inside</button>`;
    return h;
  }
  let h = head + `<div class="sub">plain description</div>` + n.what;
  if (n.inside) h += `<button class="go-inside" onclick="window.__goInside('${n.inside}')">&#8594; Go inside</button>`;
  return h;
}
(window as any).__goInside = (key: string): void => enterInside(key);

function showNode(n: SceneNode): void {
  setPanel(nodePanelHTML(n, state.tab));
}
function selectNode(n: SceneNode): void {
  state.selected = { type: "node", id: n.id };
  refreshSelection(); refreshSidebar();
  showNode(n);
}
function refreshSelection(): void {
  for (const id in state.nodeEls) {
    state.nodeEls[id].sel.setAttribute("opacity",
      state.selected && state.selected.type === "node" && state.selected.id === id ? "1" : "0");
  }
}

function escapeHTML(s: string): string {
  return s
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function eventPanelHTML(evt: EventDef, activeHop: number, livePayload?: string): string {
  let h = `<div class="eyebrow"><span class="dotchip" style="background:${evt.color}"></span>live event</div>
    <h1>${evt.title}</h1><div class="sub">${evt.sub}</div>`;
  h += livePayload
    ? `<h2>Payload &#183; observed live</h2><div class="payload">${escapeHTML(livePayload)}</div>`
    : `<h2>Payload</h2><div class="payload">${evt.payload}</div>`;
  h += `<h2>The chain</h2><div class="hoplist">`;
  evt.chain?.forEach((c, i) => {
    h += `<div class="hop${i === activeHop ? " active" : ""}"><span class="idx">${i + 1}</span><span class="fn"><b>${c[0]}</b> &#183; ${c[1]}</span><span class="note">${c[2]}</span></div>`;
  });
  h += `</div>`;
  if (evt.facts) {
    h += `<h2>Notes</h2><div class="factgrid">` +
      evt.facts.map((f) => `<div class="fk">${f[0]}</div><div class="fv">${f[1]}</div>`).join("") + `</div>`;
  }
  return h;
}
function selectEventParticle(p: Particle): void {
  state.selected = { type: "event", id: p.evt.id };
  refreshSelection(); refreshSidebar();
  setPanel(eventPanelHTML(p.evt, mapHopToChain(p), p.livePayload));
}
function mapHopToChain(p: Particle): number {
  if (!p.evt.chain) return -1;
  // spread chain steps across hops
  const per = p.evt.chain.length / p.evt.hops.length;
  return Math.min(p.evt.chain.length - 1, Math.floor(p.hopIdx * per));
}
function updateTracePanel(p: Particle): void {
  setPanel(eventPanelHTML(p.evt, mapHopToChain(p), p.livePayload));
}
function traceArrived(evt: EventDef): void {
  setPanel(eventPanelHTML(evt, (evt.chain?.length ?? 1) - 1) +
    `<p><mark>Delivered.</mark> Press RESUME THE FLOW to let everything move again, or TRACE ONE EVENT for another.</p>`);
}

/* ============================================================
   sidebar
============================================================ */
function refreshSidebar(): void {
  const sb = document.getElementById("sidebar") as HTMLDivElement;
  sb.innerHTML = "";
  const groups = ["THE SYNC LOOP", "PRESENCE", "THE LIBRARY", "CONSUMERS", "THE EXTENSION"];
  const mkHead = (t: string) => {
    const d = document.createElement("div");
    d.className = "side-head";
    d.textContent = t;
    sb.appendChild(d);
  };
  mkHead("THE SYSTEM");
  for (const gname of groups) {
    mkHead(gname);
    for (const n of NODES.filter((n) => n.group === gname)) {
      const b = document.createElement("button");
      b.className = "side-item" + (state.selected && state.selected.id === n.id ? " active" : "");
      b.innerHTML = `<span class="code">${n.code}</span><span>${n.name}</span><span class="n">${n.n || ""}</span>`;
      b.addEventListener("click", () => {
        if (state.scene !== "main") (window as any).__exitInside();
        selectNode(n);
      });
      b.addEventListener("mouseenter", () => showNode(n));
      sb.appendChild(b);
    }
  }
}
refreshSidebar();

/* ============================================================
   tabs / controls
============================================================ */
document.querySelectorAll(".tab").forEach((t) => t.addEventListener("click", () => {
  document.querySelectorAll(".tab").forEach((x) => x.classList.remove("active"));
  t.classList.add("active");
  state.tab = (t as HTMLElement).dataset.tab as "what" | "how";
  if (state.selected && state.selected.type === "node") {
    const n = sceneNodes.find((n) => n.id === state.selected!.id) || NODES.find((n) => n.id === state.selected!.id);
    if (n) { showNode(n); return; }
  }
  if (!state.selected) setPanel(state.tab === "what" ? OVERVIEW.what : OVERVIEW.how);
}));

const btnFlow = document.getElementById("btn-flow") as HTMLButtonElement;
function setPaused(v: boolean): void {
  state.paused = v;
  btnFlow.innerHTML = v ? "&#9654; RESUME THE FLOW" : "&#9646;&#9646; PAUSE THE FLOW";
}
btnFlow.addEventListener("click", () => {
  if (state.tracing) { state.tracing.el?.remove(); state.tracing.done = true; state.tracing = null; }
  setPaused(!state.paused);
});
document.getElementById("btn-trace")!.addEventListener("click", () => {
  if (state.scene !== "main") (window as any).__exitInside();
  setPaused(true);
  if (state.tracing) { state.tracing.el?.remove(); state.tracing.done = true; }
  const pool: EventDef[] = [];
  for (const e of EVENTS) for (let i = 0; i < e.weight; i++) pool.push(e);
  const evt = pool[Math.floor(Math.random() * pool.length)];
  state.tracing = spawnEvent(evt, true);
  state.selected = { type: "event", id: evt.id };
  refreshSelection(); refreshSidebar();
  updateTracePanel(state.tracing);
});
document.getElementById("btn-reset")!.addEventListener("click", () => {
  if (state.scene !== "main") { (window as any).__exitInside(); return; }
  state.selected = null;
  refreshSelection(); refreshSidebar();
  fitView();
  setPanel(state.tab === "what" ? OVERVIEW.what : OVERVIEW.how);
});
document.getElementById("btn-out")!.addEventListener("click", () => (window as any).__exitInside());

/* pan / zoom */
const wrap = document.getElementById("stage-wrap") as HTMLDivElement;
interface DragState {
  x: number; y: number; cx: number; cy: number; moved: boolean;
}
let drag: DragState | null = null;
svg.addEventListener("pointerdown", (e) => {
  drag = { x: e.clientX, y: e.clientY, cx: state.cam.x, cy: state.cam.y, moved: false };
  svg.classList.add("dragging");
  svg.setPointerCapture(e.pointerId);
});
svg.addEventListener("pointermove", (e) => {
  if (!drag) return;
  const dx = e.clientX - drag.x,
    dy = e.clientY - drag.y;
  if (Math.abs(dx) + Math.abs(dy) > 3) drag.moved = true;
  state.cam.x = drag.cx + dx; state.cam.y = drag.cy + dy;
  applyCam();
});
svg.addEventListener("pointerup", (e) => {
  if (drag && !drag.moved) {
    // forgiving dot picking: nearest live particle within 28 screen px wins
    const r = wrap.getBoundingClientRect();
    const wx = (e.clientX - r.left - state.cam.x) / state.cam.k;
    const wy = (e.clientY - r.top - state.cam.y) / state.cam.k;
    const maxD = 28 / state.cam.k;
    let best: Particle | null = null,
      bestD = Infinity;
    for (const p of state.particles) {
      if (p.done || p.wx === undefined || p.wy === undefined) continue;
      const d = Math.hypot(p.wx - wx, p.wy - wy);
      if (d < maxD && d < bestD) { best = p; bestD = d; }
    }
    if (best) {
      selectEventParticle(best);
    } else if (!(e.target instanceof Element && e.target.closest(".block"))) {
      state.selected = null;
      refreshSelection(); refreshSidebar();
      if (state.scene === "main") setPanel(state.tab === "what" ? OVERVIEW.what : OVERVIEW.how);
    }
  }
  drag = null;
  svg.classList.remove("dragging");
});
svg.addEventListener("wheel", (e) => {
  e.preventDefault();
  const f = Math.exp(-e.deltaY * 0.0015);
  zoomAt(e.clientX, e.clientY, f);
}, { passive: false });
function zoomAt(cx: number, cy: number, f: number): void {
  const r = wrap.getBoundingClientRect();
  const px = cx - r.left,
    py = cy - r.top;
  const k2 = Math.min(4, Math.max(0.3, state.cam.k * f));
  const real = f === 0 ? 1 : k2 / state.cam.k;
  state.cam.x = px - (px - state.cam.x) * real;
  state.cam.y = py - (py - state.cam.y) * real;
  state.cam.k = k2;
  applyCam();
}
document.getElementById("zin")!.addEventListener("click", () => zoomAt(wrap.clientWidth / 2, wrap.clientHeight / 2, 1.25));
document.getElementById("zout")!.addEventListener("click", () => zoomAt(wrap.clientWidth / 2, wrap.clientHeight / 2, 0.8));
addEventListener("resize", () => { /* keep camera; user can reset */ });

/* ============================================================
   live sources — real traffic drives the dots where it can

   Each pipeline reports LIVE / INFERRED / SIM independently. Anything not LIVE
   keeps its synthetic spawns (see the auto-spawner block in tickInner), so the
   map never goes still just because one server is unreachable.
============================================================ */
const EVENT_BY_ID: Record<string, EventDef> = Object.fromEntries(
  EVENTS.map((e) => [e.id, e])
);
const statusBar = document.getElementById("livebar") as HTMLDivElement | null;

function renderLiveStatus(pipelines: PipelineState[], room: string): void {
  // Live and inferred pipelines both spawn their own dots; only "sim" falls back.
  for (const p of pipelines) {
    const live = p.status === "live" || p.status === "inferred";
    for (const id of p.eventIds) state.livePipelines[id] = live;
  }
  if (!statusBar) return;
  const chips = pipelines
    .map((p) => {
      const label =
        p.status === "live" ? "LIVE"
        : p.status === "inferred" ? "INFERRED"
        : p.status === "connecting" ? "…"
        : "SIM";
      return `<span class="chip ${p.status}"><span class="cname">${p.label}</span>` +
        `<span class="cstate">${label}</span>` +
        `<span class="ccount">${p.count.toLocaleString()}</span></span>`;
    })
    .join("");
  statusBar.innerHTML =
    chips +
    `<span class="chip room" title="append ?room=/path to watch another room">` +
    `<span class="cname">ROOM</span><span class="cstate">${escapeHTML(
      room.length > 32 ? room.slice(0, 31) + "…" : room
    )}</span></span>` +
    `<span class="livehint">?room=/path</span>`;
}

const liveSources = new LiveDiagramSources({
  spawn: (eventId, payload) => {
    // Only the main map carries the real pipelines; inside scenes keep looping.
    if (state.scene !== "main" || state.paused || state.reduced) return;
    if (state.particles.filter((p) => !p.done).length >= 40) return;
    const evt = EVENT_BY_ID[eventId];
    if (!evt) return;
    spawnEvent(evt, false, payload);
  },
  onStatus: renderLiveStatus,
});

/* boot */
renderScene();
setPanel(OVERVIEW.what);
try {
  liveSources.start();
} catch (err) {
  // A failed live boot must never take the diagram down; simulation continues.
  console.warn("[diagram] live sources unavailable, staying simulated", err);
}
addEventListener("beforeunload", () => liveSources.stop());
