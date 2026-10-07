// Live event sources for The playhtml Machine diagram.
// Opens read-only connections to the three real pipelines (Yjs data, presence,
// extension live stream) and reports each observed event through a callback so
// the diagram can spawn a real dot instead of a synthetic one. Every pipeline
// falls back to simulation independently when its socket cannot be reached.

import * as Y from "yjs";
import YProvider from "y-partyserver/provider";
import PartySocket from "partysocket";

/** Pipelines the diagram can drive from live traffic, plus the inferred one. */
export type PipelineId = "data" | "presence" | "save" | "extension";

export type PipelineStatus = "connecting" | "live" | "inferred" | "sim";

export interface PipelineState {
  id: PipelineId;
  label: string;
  status: PipelineStatus;
  /** Real events observed, including ones dropped by the spawn rate cap. */
  count: number;
  /** EventDef ids this pipeline owns; the simulator skips them while live. */
  eventIds: string[];
}

export interface LiveHooks {
  /** Put a dot on the stage. `payload` is the real message, pretty-printed. */
  spawn: (eventId: string, payload: string) => void;
  /** Status/counter changed — repaint the topbar chips. */
  onStatus: (pipelines: PipelineState[], room: string) => void;
}

const DEFAULT_PLAYHTML_HOST = "api.playhtml.fun";
const LOCAL_PLAYHTML_HOST = "localhost:1999";
const STREAM_URL = "wss://playhtml-game-api.spencerc99.workers.dev/stream";

/** Ceiling on dots per pipeline per second. Real cursor traffic runs far above
 * this; observed events past the cap still increment the counter. */
const MAX_SPAWNS_PER_SECOND = 3;
/** No successful connect within this window means fall back to simulation. */
const CONNECT_DEADLINE_MS = 8_000;
const BACKOFF_MIN_MS = 2_000;
const BACKOFF_MAX_MS = 30_000;
/** Reconnects allowed in response to room-reset, per page load. */
const MAX_RESET_RECONNECTS = 3;
/** Mirrors the party server's autosave debounce, which the client cannot see. */
const AUTOSAVE_IDLE_MS = 3_000;
/** Every Nth presence message also stands in for the presence-changes hop. */
const PRESENCE_CHANGES_EVERY = 4;
const MAX_PAYLOAD_CHARS = 400;
/** Element awareness rides these channels; see presence-transport.ts. */
const ELEMENT_SHARD_CHANNELS = Array.from(
  { length: 8 },
  (_, i) => `el:shard:${i}`,
);

/* ============================================================
   room + host resolution (mirrors packages/playhtml/src/index.ts)
============================================================ */

function normalizeHost(host: string): string {
  if (!host) return "local";
  return host.replace(/^www\./i, "");
}

/** Same shape as normalizeRoomId in the core library: encoded host, or
 * `host-<roomString>` when a path is given. */
function normalizeRoomId(host: string, roomString: string): string {
  const h = normalizeHost(host);
  return encodeURIComponent(roomString === "" ? h : `${h}-${roomString}`);
}

export interface LiveConfig {
  host: string;
  room: string;
  /** The decoded `host-/path` form, for display. */
  roomLabel: string;
}

export function resolveLiveConfig(): LiveConfig {
  const params = new URLSearchParams(window.location.search);
  const onLocalhost =
    window.location.hostname === "localhost" ||
    window.location.hostname === "127.0.0.1";
  // Default to production even in local dev so the diagram shows real traffic;
  // ?local opts into a locally running partykit server.
  const host =
    params.get("playhtmlHost") ||
    (onLocalhost && params.has("local")
      ? LOCAL_PLAYHTML_HOST
      : DEFAULT_PLAYHTML_HOST);
  const roomPath = params.get("room") || "/";
  const roomHost =
    host === LOCAL_PLAYHTML_HOST ? window.location.host : "playhtml.fun";
  return {
    host,
    room: normalizeRoomId(roomHost, roomPath),
    roomLabel: `${normalizeHost(roomHost)}-${roomPath}`,
  };
}

/* ============================================================
   payload formatting + per-pipeline rate control
============================================================ */

function formatPayload(value: unknown): string {
  let text: string;
  try {
    text = typeof value === "string" ? value : JSON.stringify(value, null, 2);
  } catch {
    text = String(value);
  }
  if (text === undefined || text === null) return "";
  return text.length > MAX_PAYLOAD_CHARS
    ? `${text.slice(0, MAX_PAYLOAD_CHARS)}…`
    : text;
}

/** One pipeline's live wiring: status, counters, spawn throttle, backoff. */
class Pipeline {
  readonly state: PipelineState;
  private spawnsThisSecond = 0;
  private windowStart = 0;
  private backoff = BACKOFF_MIN_MS;
  private deadline: ReturnType<typeof setTimeout> | null = null;

  constructor(
    id: PipelineId,
    label: string,
    eventIds: string[],
    private hooks: LiveHooks,
    private notify: () => void,
  ) {
    this.state = { id, label, status: "connecting", count: 0, eventIds };
  }

  /** Start the connect deadline; if nothing opens by then, drop to simulation.
   * Also returns a pipeline that already fell back to "connecting", so a
   * reconnect attempt gets a fair window rather than being stuck on SIM. */
  armConnectDeadline(): void {
    if (this.state.status !== "live") this.setStatus("connecting");
    if (this.deadline !== null) return;
    this.deadline = setTimeout(() => {
      this.deadline = null;
      if (this.state.status === "connecting") this.setStatus("sim");
    }, CONNECT_DEADLINE_MS);
  }

  markOpen(status: PipelineStatus = "live"): void {
    if (this.deadline !== null) {
      clearTimeout(this.deadline);
      this.deadline = null;
    }
    this.backoff = BACKOFF_MIN_MS;
    this.setStatus(status);
  }

  markDown(): void {
    this.setStatus("sim");
  }

  setStatus(status: PipelineStatus): void {
    if (this.state.status === status) return;
    this.state.status = status;
    this.notify();
  }

  /** Capped backoff for reconnects we drive ourselves. */
  nextBackoff(): number {
    const wait = this.backoff;
    this.backoff = Math.min(BACKOFF_MAX_MS, this.backoff * 2);
    return wait;
  }

  /** Record one real event. Spawns a dot unless the per-second cap is hit —
   * the counter advances either way so the readout reflects real traffic. */
  observe(eventId: string, payload: unknown): void {
    this.state.count += 1;
    this.notify();
    const now = Date.now();
    if (now - this.windowStart >= 1000) {
      this.windowStart = now;
      this.spawnsThisSecond = 0;
    }
    if (this.spawnsThisSecond >= MAX_SPAWNS_PER_SECOND) return;
    this.spawnsThisSecond += 1;
    this.hooks.spawn(eventId, formatPayload(payload));
  }

  destroy(): void {
    if (this.deadline !== null) {
      clearTimeout(this.deadline);
      this.deadline = null;
    }
  }
}

/* ============================================================
   the live wiring
============================================================ */

export class LiveDiagramSources {
  private pipelines: Pipeline[] = [];
  private config = resolveLiveConfig();
  private provider: YProvider | null = null;
  private doc: Y.Doc | null = null;
  private presenceSocket: PartySocket | null = null;
  private streamSocket: WebSocket | null = null;
  private presenceMessageCount = 0;
  private streamFrameCount = 0;
  private autosaveTimer: ReturnType<typeof setTimeout> | null = null;
  private resetReconnects = 0;
  private stopped = false;

  constructor(private hooks: LiveHooks) {
    const notify = () => this.hooks.onStatus(this.snapshot(), this.roomLabel);
    this.pipelines = [
      // "setdata" stays simulated: this page is a read-only observer, so the
      // only shared-data traffic it can see is other people's updates arriving.
      new Pipeline("data", "DATA", ["remote"], hooks, notify),
      new Pipeline(
        "presence",
        "PRESENCE",
        ["cursor", "pchanges", "elaw"],
        hooks,
        notify,
      ),
      new Pipeline("save", "SAVE", ["autosave"], hooks, notify),
      new Pipeline(
        "extension",
        "EXTENSION",
        ["extbatch", "livefan"],
        hooks,
        notify,
      ),
    ];
  }

  get roomLabel(): string {
    return this.config.roomLabel;
  }

  snapshot(): PipelineState[] {
    return this.pipelines.map((p) => ({ ...p.state }));
  }

  private pipeline(id: PipelineId): Pipeline {
    const found = this.pipelines.find((p) => p.state.id === id);
    if (!found) throw new Error(`unknown pipeline ${id}`);
    return found;
  }

  start(): void {
    // The autosave is a server-side debounce with no client-visible message, so
    // its badge says INFERRED rather than LIVE from the start.
    this.pipeline("save").setStatus("sim");
    this.connectData();
    this.connectPresence();
    this.connectStream();
    this.hooks.onStatus(this.snapshot(), this.roomLabel);
  }

  stop(): void {
    this.stopped = true;
    if (this.autosaveTimer !== null) clearTimeout(this.autosaveTimer);
    for (const p of this.pipelines) p.destroy();
    try {
      this.provider?.destroy();
    } catch {
      // provider may already be torn down
    }
    try {
      this.presenceSocket?.close();
    } catch {
      // socket may already be closed
    }
    try {
      this.streamSocket?.close();
    } catch {
      // socket may already be closed
    }
  }

  /* ---------- teal: Yjs data ---------- */

  /** localStorage key the core client uses for a room's reset epoch. Shared
   * with real playhtml pages on the same origin, so an epoch this observer
   * learns also spares the next page a reset round-trip, and vice versa. */
  private resetEpochKey(): string {
    return `playhtml_resetEpoch_${this.config.room}`;
  }

  private storedResetEpoch(): string | null {
    try {
      return localStorage.getItem(this.resetEpochKey());
    } catch {
      // storage can be unavailable (private mode, blocked cookies)
      return null;
    }
  }

  private connectData(): void {
    const pipe = this.pipeline("data");
    pipe.armConnectDeadline();
    let synced = false;
    try {
      const doc = new Y.Doc();
      this.doc = doc;
      // The main party rejects a connection whose clientResetEpoch is missing
      // while the room has a server epoch (isResetEpochStale treats null as
      // stale), closing the socket before sync. Send the stored epoch exactly
      // as the core client does; a room-reset below teaches us the current one.
      const provider = new YProvider(this.config.host, this.config.room, doc, {
        params: { clientResetEpoch: this.storedResetEpoch() },
      });
      this.provider = provider;
      provider.on("sync", (isSynced: boolean) => {
        if (!isSynced) return;
        // Initial sync arrives as one large update; don't burst dots for it.
        synced = true;
        pipe.markOpen("live");
      });
      provider.on("error", () => {
        pipe.markDown();
      });
      provider.on("custom-message", (data: string) => {
        this.handleRoomMessage(data);
      });
      doc.on("update", (update: Uint8Array, origin: unknown) => {
        if (!synced || this.stopped) return;
        // Only remote traffic exists on this doc, but guard anyway.
        if (origin === null || origin === undefined) return;
        this.noteDataActivity();
        pipe.observe(
          "remote",
          `Y.Doc update  ${update.byteLength} bytes\nroom ${decodeURIComponent(
            this.config.room,
          )}`,
        );
      });
    } catch (err) {
      console.warn("[diagram] data pipeline unavailable", err);
      pipe.markDown();
    }
  }

  /** The room tells stale clients to reconnect with a newer epoch, then closes
   * the socket. Store the epoch under the shared key and rebuild the provider,
   * capped so a server stuck re-issuing resets can't spin forever. */
  private handleRoomMessage(data: string): void {
    if (typeof data !== "string") return;
    let message: unknown;
    try {
      message = JSON.parse(data);
    } catch {
      return;
    }
    if (message === null || typeof message !== "object") return;
    const record = message as Record<string, unknown>;
    if (record.type !== "room-reset") return;

    const resetEpoch = Number(record.resetEpoch);
    if (!Number.isFinite(resetEpoch)) {
      console.warn("[diagram] room-reset without a usable resetEpoch");
      this.pipeline("data").markDown();
      return;
    }
    if (this.resetReconnects >= MAX_RESET_RECONNECTS) {
      console.warn("[diagram] room-reset retry cap reached, staying simulated");
      this.pipeline("data").markDown();
      return;
    }
    this.resetReconnects += 1;

    try {
      localStorage.setItem(this.resetEpochKey(), String(resetEpoch));
    } catch {
      // without storage the reconnect still carries the epoch in memory below
    }
    try {
      this.provider?.destroy();
    } catch {
      // provider may already be closing after the reset
    }
    this.provider = null;
    this.doc = null;
    if (this.stopped) return;
    // Re-arms the 8s connect deadline, so a reconnect that never syncs still
    // falls back to simulation.
    this.connectData();
  }

  /* ---------- gold: inferred autosave ---------- */

  /** The room saves after 3s of quiet (15s max). We cannot observe the write,
   * so we infer one after the same quiet window following teal activity. */
  private noteDataActivity(): void {
    const save = this.pipeline("save");
    save.setStatus("inferred");
    if (this.autosaveTimer !== null) clearTimeout(this.autosaveTimer);
    this.autosaveTimer = setTimeout(() => {
      this.autosaveTimer = null;
      if (this.stopped) return;
      save.observe(
        "autosave",
        "inferred: 3s of quiet after a shared-data update\n" +
          "the room's onSave debounce (3s / 15s max) fires around here",
      );
    }, AUTOSAVE_IDLE_MS);
  }

  /* ---------- cobalt: presence ---------- */

  private connectPresence(): void {
    const pipe = this.pipeline("presence");
    pipe.armConnectDeadline();
    let socket: PartySocket;
    try {
      socket = new PartySocket({
        host: this.config.host,
        room: this.config.room,
        party: "presence",
        maxEnqueuedMessages: 0,
      });
    } catch (err) {
      console.warn("[diagram] presence pipeline unavailable", err);
      pipe.markDown();
      return;
    }
    this.presenceSocket = socket;

    socket.addEventListener("open", () => {
      pipe.markOpen("live");
      // presence-join carries no identity: the protocol makes it optional, and
      // this observer must not appear as a player in the room.
      try {
        socket.send(JSON.stringify({ type: "presence-join" }));
      } catch {
        // send races a close; the reconnect path re-joins
      }
    });
    socket.addEventListener("close", () => {
      if (!this.stopped) pipe.markDown();
    });
    socket.addEventListener("error", () => {
      if (!this.stopped) pipe.markDown();
    });
    socket.addEventListener("message", (event: MessageEvent) => {
      this.handlePresenceMessage(pipe, event.data);
    });
  }

  private handlePresenceMessage(pipe: Pipeline, data: unknown): void {
    if (typeof data !== "string") return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(data);
    } catch {
      return;
    }
    if (parsed === null || typeof parsed !== "object") return;
    const message = parsed as Record<string, unknown>;
    if (message.type !== "presence-changes" && message.type !== "presence-sync")
      return;

    // Server messages fold every channel into one snapshot keyed by peer, so
    // read the channel names out of the snapshot to decide which hop to draw.
    const snapshot =
      message.type === "presence-sync" ? message.peers : message.updates;
    const channels = collectChannels(snapshot);

    if (channels.has("cursor")) {
      pipe.observe("cursor", message);
    }
    if (ELEMENT_SHARD_CHANNELS.some((c) => channels.has(c))) {
      pipe.observe("elaw", message);
    }
    this.presenceMessageCount += 1;
    if (this.presenceMessageCount % PRESENCE_CHANGES_EVERY === 0) {
      pipe.observe("pchanges", message);
    }
  }

  /* ---------- rust: extension live stream ---------- */

  private connectStream(): void {
    const pipe = this.pipeline("extension");
    pipe.armConnectDeadline();
    let socket: WebSocket;
    try {
      socket = new WebSocket(STREAM_URL);
    } catch (err) {
      console.warn("[diagram] extension pipeline unavailable", err);
      pipe.markDown();
      return;
    }
    this.streamSocket = socket;

    socket.addEventListener("open", () => pipe.markOpen("live"));
    socket.addEventListener("error", () => {
      if (!this.stopped) pipe.markDown();
    });
    socket.addEventListener("close", () => {
      if (this.stopped) return;
      pipe.markDown();
      // The hub is the only pipeline we reconnect ourselves; PartySocket and
      // YProvider retry on their own.
      setTimeout(() => {
        if (!this.stopped) this.connectStream();
      }, pipe.nextBackoff());
    });
    socket.addEventListener("message", (event: MessageEvent) => {
      if (typeof event.data !== "string") return;
      let frame: unknown;
      try {
        frame = JSON.parse(event.data);
      } catch {
        return;
      }
      if (frame === null || typeof frame !== "object") return;
      const events = (frame as { events?: unknown }).events;
      if (!Array.isArray(events) || events.length === 0) return;
      pipe.observe("extbatch", {
        events: events.length,
        sample: events[0],
      });
      this.streamFrameCount += 1;
      if (this.streamFrameCount % PRESENCE_CHANGES_EVERY === 0) {
        pipe.observe("livefan", {
          broadcast: events.length,
          note: "same batch, fanned out to every /stream subscriber",
        });
      }
    });
  }
}

/** Pull the set of channel names out of a presence snapshot
 * (`{ peerId: { channel: value } }`). Defensive: server shape is trusted but
 * this page must never throw on unexpected data. */
function collectChannels(snapshot: unknown): Set<string> {
  const channels = new Set<string>();
  if (snapshot === null || typeof snapshot !== "object") return channels;
  for (const peer of Object.values(snapshot as Record<string, unknown>)) {
    if (peer === null || typeof peer !== "object") continue;
    for (const channel of Object.keys(peer as Record<string, unknown>)) {
      channels.add(channel);
    }
  }
  return channels;
}
