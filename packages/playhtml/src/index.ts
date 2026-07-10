// ABOUTME: Initializes playhtml's collaborative DOM runtime and public singleton API.
// ABOUTME: Manages shared state, element handlers, presence, cursors, and navigation.
/// <reference lib="dom"/>
/// <reference types="vite/client" />
import YProvider from "y-partyserver/provider";
import "./style.scss";
import {
  ElementData,
  ElementInitializer,
  TagType,
  getIdForElement,
  TagTypeToElement,
  PlayEvent,
  EventMessage,
  RegisteredPlayEvent,
  generatePersistentPlayerIdentity,
  deepReplaceIntoProxy,
  clonePlain,
} from "@playhtml/common";
import {
  listSharedElements as devListSharedElements,
  teardownDevUI,
  setupDevUI,
} from "./development";
import {
  createNavigationController,
  attachNavigationListeners,
  dispatchNavigated,
} from "./navigation";
import type { PlayerIdentity, CursorPresence } from "@playhtml/common";
import * as Y from "yjs";
import { syncedStore, getYjsDoc, getYjsValue } from "@syncedstore/core";
import { ElementHandler } from "./elements";
import { hashElement } from "./utils";
import {
  getStableIdForAwareness,
  getElementAwarenessFingerprint,
} from "./awareness-utils";
import {
  CursorClientAwareness,
  getPresencePage,
} from "./cursors/cursor-client";
import { createPresenceAPI, ensureAwarenessIdentity } from "./presence";
import type { PresenceAPI, PresenceRoom } from "@playhtml/common";
import {
  findSharedElementsOnPage,
  findSharedReferencesOnPage,
  isSharedReadOnly,
} from "./sharing";
import { parseDataSource, normalizeHost } from "@playhtml/common";
import type { PageDataChannel } from "@playhtml/common";
import {
  createPageDataChannel,
  PAGE_TAG,
  refreshPageDataChannels,
} from "./page-data";
import { createReadOnlyStore, type ReadOnlyStore } from "./readOnlyStore";
import {
  canUseRealtimePresenceTransport,
  RealtimePresenceTransport,
} from "./presence-transport";
import {
  ElementAwarenessClient,
  type ElementAwarenessMap,
} from "./element-awareness";

const DefaultPartykitHost = "playhtml.spencerc99.workers.dev";
const StagingPartykitHost = "playhtml-staging.spencerc99.workers.dev";
const DevPartykitHost = "localhost:1999";

// Environment-specific host resolution
function getPartykitHost(userHost?: string): string {
  // If user explicitly provides a host, use it
  if (userHost) {
    return userHost;
  }

  const hostname = window.location.hostname;

  // Staging domain detection (customize these patterns for your setup)
  if (hostname.includes("staging") || hostname.includes("ngrok-free")) {
    return StagingPartykitHost;
  }

  if (typeof import.meta !== "undefined" && import.meta.env) {
    if (import.meta.env.DEV) {
      return DevPartykitHost;
    }
  }

  // Default to production
  return DefaultPartykitHost;
}

const VERBOSE = 0;

// Root SyncedStore for nested CRDT semantics while keeping plain API
type StoreShape = {
  // tag -> elementId -> data proxy (value typed at usage sites)
  play: Record<string, Record<string, unknown>>;
};
type PlayStore = {
  readonly play: Partial<Record<string, Record<string, unknown>>>;
};
// store/doc/publicSyncedStore are recreated on a room change (recreateStore),
// so they're reassignable. A fresh doc has no op history — discarding the old
// one on a room change resets page + element data to the new room with no
// tombstone synced back (unlike deleting keys from the reused doc, which
// destroys the original room's persisted data on a round trip).
let store: PlayStore = syncedStore<StoreShape>({ play: {} });
let doc = getYjsDoc(store);
let publicSyncedStore = createReadOnlyStore(store.play);

function getDefaultRoom({ includeSearch }: DefaultRoomOptions): string {
  // TODO: Strip filename extension
  const transformedPathname = window.location.pathname.replace(/\.[^/.]+$/, "");

  return includeSearch
    ? transformedPathname + window.location.search
    : transformedPathname;
}

/**
 * Normalizes a pathname by stripping filename extensions, consistent with getDefaultRoom
 */
function normalizePathname(pathname: string): string {
  return pathname.replace(/\.[^/.]+$/, "");
}

/**
 * Resolves cursor room configuration to a room string (without host prefix).
 * The returned string will be normalized with the same logic as the main room
 * (filename extension stripping, etc.)
 */
function resolveCursorRoom(room: CursorRoom): string {
  const context = {
    domain: window.location.host,
    pathname: window.location.pathname,
    search: window.location.search,
  };

  if (typeof room === "function") {
    const result = room(context);
    // If the function returns a pathname-like string, normalize it (strip filename extension)
    // If it returns an empty string (domain-only) or special value, use as-is
    if (result && result.startsWith("/")) {
      return normalizePathname(result);
    }
    return result;
  }

  switch (room) {
    case "page":
      // Match the normalization used by getDefaultRoom (strip filename extension)
      return normalizePathname(context.pathname);
    case "domain":
      // Return empty string to match the domain-only case
      // The host will be prefixed in normalizeRoomId
      return "";
    case "section":
      const firstSegment =
        normalizePathname(context.pathname).split("/").filter(Boolean)[0] || "";
      return `/${firstSegment}`;
    default:
      return normalizePathname(context.pathname);
  }
}

/**
 * Normalizes a room ID by prefixing with host and encoding.
 * This ensures consistent format for both main room and cursor room comparisons.
 *
 * @param host - The hostname (e.g., "example.com")
 * @param roomString - The room string path (e.g., "/test/playground" or "" for domain-only)
 * @returns Encoded room ID in format: host or host-{roomString}
 */
function normalizeRoomId(host: string, roomString: string): string {
  const h = normalizeHost(host);
  // If roomString is empty (domain case), just use host without separator
  // Otherwise use host + "-" + roomString format to match main room construction
  const normalized = roomString === "" ? h : `${h}-${roomString}`;
  return encodeURIComponent(normalized);
}

let yprovider: YProvider;
let cursorProvider: YProvider | null = null;
let cursorClient: CursorClientAwareness | null = null;
let currentCursorRoomId = "";
let presenceAPI: PresenceAPI | null = null;
// @ts-ignore, will be removed
let globalData: Y.Map<any> = doc.getMap<Y.Map<any>>("playhtml-global");
// Internal map for quick access to proxies
const proxyByTagAndId = new Map<string, Map<string, any>>();
const yObserverByKey = new Map<string, (...args: unknown[]) => void>();
// Page data channel tracking, scoped here so init() can clear them
const pageDataRefCounts = new Map<string, number>();
const pageDataListeners = new Map<string, Set<(data: any) => void>>();
// Tracks elements currently being updated due to remote SyncedStore/Yjs updates.
// Allows us to distinguish programmatic remote-applied changes from local user writes.
// moved below (single declaration)
// Dev: track hydration of shared references for warnings
const sharedUpdateSeen: Set<string> = new Set();
const sharedHydrationTimers: Map<string, number> = new Map();

// Shared permissions map for tracking element permissions
export const sharedPermissions = new Map<string, "read-only" | "read-write">();
// Track discovered shared references to avoid duplicates
const discoveredSharedReferences = new Set<string>();

function initializeSharedPermissions(): void {
  // Initialize if not already done
  if (sharedPermissions.size === 0) {
    // Clear any existing entries to ensure clean state
    sharedPermissions.clear();
  }
}

// Handle discovery of a new shared reference element
function handleNewSharedReference(element: HTMLElement): void {
  const dataSource = element.getAttribute("data-source");
  if (!dataSource) return;

  // Parse and normalize using shared helper
  let domain: string, path: string, elementId: string;
  try {
    ({ domain, path, elementId } = parseDataSource(dataSource));
  } catch {
    return;
  }

  // Unified dedupe key shape
  const referenceKey = `${domain}${path}#${elementId}`;
  if (discoveredSharedReferences.has(referenceKey)) return;
  discoveredSharedReferences.add(referenceKey);

  // Send updated shared references to the server if we're connected
  if (yprovider?.wsconnected) {
    try {
      const newReference = { domain, path, elementId };
      // Send individual reference update
      yprovider.sendMessage(
        JSON.stringify({
          type: "add-shared-reference",
          reference: newReference,
        }),
      );

      // Request permissions for this specific element
      yprovider.sendMessage(
        JSON.stringify({
          type: "export-permissions",
          elementIds: [elementId],
        }),
      );
    } catch (error) {
      console.warn(
        "[PLAYHTML] Failed to notify server of new shared reference:",
        error,
      );
    }
  }
}

// Handle registration of a new shared source element
function handleNewSharedElement(element: HTMLElement): void {
  if (!element.id) return;

  const elementId = element.id;
  const permissions = element.getAttribute("shared");
  let permissionMode: "read-only" | "read-write" = "read-write";

  if (permissions && permissions !== "") {
    const val = permissions.toLowerCase();
    if (val.includes("read-only") || val === "ro") {
      permissionMode = "read-only";
    }
  }

  // Update local permissions
  sharedPermissions.set(elementId, permissionMode);

  // Send to server if connected
  if (yprovider?.wsconnected) {
    try {
      // Register this element as shared with the server
      const sharedElement = {
        elementId,
        permissions: permissionMode,
        path: window.location.pathname,
      };

      yprovider.sendMessage(
        JSON.stringify({
          type: "register-shared-element",
          element: sharedElement,
        }),
      );
    } catch (error) {
      console.warn(
        "[PLAYHTML] Failed to notify server of new shared element:",
        error,
      );
    }
  }
}

function ensureElementProxy<TData = unknown>(
  tag: string,
  elementId: string,
  defaultData: TData,
): TData {
  if (!proxyByTagAndId.has(tag)) proxyByTagAndId.set(tag, new Map());
  const tagMap = proxyByTagAndId.get(tag)!;
  if (!tagMap.has(elementId)) {
    store.play[tag] ??= {};
    const tagRecord = store.play[tag]!;
    if (tagRecord[elementId] === undefined) {
      // Always clone to avoid reusing the same object reference across multiple elements,
      // which SyncedStore forbids ("reassigning object that already occurs in the tree").
      const initial = clonePlain(defaultData);
      tagRecord[elementId] = initial;
    }
    tagMap.set(elementId, tagRecord[elementId]);
  }
  return tagMap.get(elementId)! as TData;
}
let elementHandlers: Map<string, Map<string, ElementHandler>> = new Map<
  string,
  Map<string, ElementHandler>
>();
const mirrorDescendantElementsByRoot = new WeakMap<
  HTMLElement,
  Map<string, HTMLElement>
>();
let eventHandlers: Map<string, Array<RegisteredPlayEvent>> = new Map<
  string,
  Array<RegisteredPlayEvent>
>();
// Tracks elements currently being updated due to remote SyncedStore/Yjs updates.
// Allows us to distinguish programmatic remote-applied changes from local user writes.
const remoteApplyingKeys: Set<string> = new Set();
const selectorIdsToAvailableIdx = new Map<string, number>();
let eventCount = 0;
export type CursorRoom =
  | "page"
  | "domain"
  | "section"
  | ((context: { domain: string; pathname: string; search: string }) => string);

export type CursorCoordinateMode = "relative" | "absolute";

export interface CursorZoneOptions {
  onCustomCursorRender?: (connectionId: string, element: HTMLElement) => HTMLElement | null;
  getCursorStyle?: (presence: CursorPresence) => Partial<CSSStyleDeclaration> | Record<string, string>;
}

export type CursorContainer =
  | HTMLElement
  | string
  | (() => HTMLElement | null);

export interface CursorOptions {
  enabled?: boolean;
  playerIdentity?: PlayerIdentity;
  proximityThreshold?: number;
  visibilityThreshold?: number;
  cursorStyle?: string;
  coordinateMode?: CursorCoordinateMode; // "relative" (viewport %) or "absolute" (document px)
  onProximityEntered?: (
    playerIdentity?: PlayerIdentity,
    positions?: {
      ours: { x: number; y: number };
      theirs: { x: number; y: number };
    },
    angle?: number,
  ) => void;
  onProximityLeft?: (connectionId: string) => void;
  onCustomCursorRender?: (
    connectionId: string,
    element: HTMLElement,
  ) => HTMLElement | null;
  enableChat?: boolean;
  room?: CursorRoom;
  shouldRenderCursor?: (presence: CursorPresence) => boolean;
  getCursorStyle?: (
    presence: CursorPresence,
  ) => Partial<CSSStyleDeclaration> | Record<string, string>;
  /**
   * Where to mount cursor DOM and the cursor style tag. Defaults to
   * document.body / document.head. Pass a container you control (and mark
   * with transition:persist or equivalent) to survive SPA body-swaps.
   *
   * If the container has its own CSS transform (e.g. a pannable canvas
   * applies `transform: translate(...) scale(...)`), cursors are stored
   * AND rendered in the container's local coordinate space. The library
   * reads the live transform matrix from getComputedStyle, so two clients
   * with different pan/zoom agree on a cursor's content position; the
   * container's CSS transform then maps that position into each viewer's
   * own pixels — anchoring cursors to content rather than to the viewport.
   */
  container?: CursorContainer;
}

interface DefaultRoomOptions {
  includeSearch?: boolean;
}

export interface InitOptions<T = unknown> {
  /**
   * The room to connect users to (this should be a string that matches the other users
   * that you want a given user to connect with).
   *
   * All rooms are automatically prefixed with their host (`window.location.hostname`) to prevent
   * conflicting with other people's sites.
   * Defaults to `window.location.pathname + window.location.search. You can customize this by
   * passing in your own room dynamically.
   *
   * Pass a function to make the room recompute on SPA navigation: it is called
   * at init and again on each route change, so a path-derived room follows the
   * URL the same way the default room does. A static string stays fixed for the
   * page's lifetime.
   */
  room?: string | (() => string);

  /**
   * Provide your own partykit host if you'd like to run your own server and customize the logic.
   */
  host?: string;

  /**
   * Optionally provide your own map of capabilities
   */
  extraCapabilities?: Record<string, ElementInitializer>;

  /**
   * A mapping of event types to PlayEvents. Allows specifying of imperative logic to trigger when a
   * client triggers some event. Automatically listens to native DOM events to trigger these.
   *
   */
  events?: Record<string, PlayEvent<T>>;
  /**
   * configuration for the default room which is based on the window's url
   */
  defaultRoomOptions?: DefaultRoomOptions;
  /**
   * Runs if playhtml fails to connect. Useful to show error messages and debugging.
   */
  onError?: () => void;

  /**
   * If true, will render some helpful development UI.
   */
  developmentMode?: boolean;

  /**
   * Cursor tracking and proximity detection configuration
   */
  cursors?: CursorOptions;
}

let capabilitiesToInitializer: Record<TagType | string, ElementInitializer> =
  TagTypeToElement;

function getTagTypes(): (TagType | string)[] {
  return [TagType.CanPlay, ...Object.keys(capabilitiesToInitializer)];
}

function sendPlayEvent(eventMessage: EventMessage) {
  yprovider.sendMessage(JSON.stringify(eventMessage));
}

function onMessage(data: string) {
  let message: any;
  try {
    message = JSON.parse(data);
  } catch (err) {
    return;
  }

  // Handle system messages
  if (message.type === "room-reset") {
    const resetEpoch = Number(message.resetEpoch);
    if (!Number.isFinite(resetEpoch)) {
      console.error("[PLAYHTML] Received room-reset without a resetEpoch");
      window.location.reload();
      return;
    }

    queueServerRoomReset(resetEpoch);
    return;
  }

  // Handle regular PlayHTML events
  const { type, eventPayload } = message as EventMessage;
  const maybeHandlers = eventHandlers.get(type);
  if (!maybeHandlers) {
    // Handle internal bridge replies
    if ((message as any).permissions) {
      try {
        const perms = (message as any).permissions as Record<
          string,
          "read-only" | "read-write"
        >;
        Object.entries(perms).forEach(([elementId, mode]) => {
          sharedPermissions.set(elementId, mode);
          if (mode === "read-only") {
            // Add not-allowed affordance to any matching referenced element
            const el = document.querySelector(
              `[data-source$="#${CSS.escape(elementId)}"]`,
            ) as HTMLElement | null;
            if (el) el.setAttribute("data-source-read-only", "");
          }
        });
      } catch {}
    }
    return;
  }

  for (const handler of maybeHandlers) {
    handler.onEvent(eventPayload);
  }
}

let hasSynced = false;
let firstSetup = true;
let isLoading = true;
let initStarted = false;
let readyResolve: () => void = () => {};
let readyReject: (error: unknown) => void = () => {};

function createReadyPromise(): Promise<void> {
  const promise = new Promise<void>((resolve, reject) => {
    readyResolve = resolve;
    readyReject = reject;
  });
  promise.catch(() => {});
  return promise;
}

let readyPromise: Promise<void> = createReadyPromise();

function isPromiseLike(value: unknown): value is Promise<void> {
  return (
    typeof value === "object" &&
    value !== null &&
    "then" in value &&
    typeof (value as { then?: unknown }).then === "function"
  );
}
/** Last fingerprint of element-awareness only; skip handler updates when unchanged (e.g. cursor-only moves). */
let lastElementAwarenessFingerprint: string | null = null;
let trackedElementAwarenessKeys = new Set<string>();
// NOTE: Potential optimization: allowlist/blocklist collaborative paths
// In complex nested data scenarios, SyncedStore CRDT proxies on every nested object can add overhead.
// Idea: expose an opt-in config to restrict which properties are collaborative (proxied) vs. local-only.
// Example API (future):
// <CanPlayElement
//   defaultData={...}
//   crdtPaths={{ allow: ["lists.todos", "nested.a.b.c.values"], block: ["profile", "counters"] }}
// >
// This would proxy only specified paths in synced mode, keeping others as plain local React state.
// This aligns with the common case where nested arrays need collaboration more than nested objects.

let __currentRoomId = "";
let __currentHost = "";

let navigationController: ReturnType<typeof createNavigationController> | null =
  null;
let detachNavListeners: (() => void) | null = null;
let configureIdentityListener: EventListener | null = null;

// Awareness change listener — must be rebound whenever the element awareness
// provider is rebuilt during navigation.
let awarenessChangeHandler: (() => void) | null = null;
let awarenessChangeTarget: {
  awareness: { off: (event: string, cb: () => void) => void };
} | null = null;

// If the first init() receives an explicit `room`, we store it for future
// navigation checks. A string stays fixed across navigation; a function is
// re-invoked on each nav so a path-derived room switches correctly. If no
// explicit room was given, we store the default-room options and re-derive on
// each nav so pathname-based rooms switch correctly.
let explicitRoomOption: string | (() => string) | undefined = undefined;

/** Resolve the explicit room option to a string, calling it if it's a function
 * (so a path-derived room recomputes on each nav). undefined if none was set. */
function resolveExplicitRoom(): string | undefined {
  return typeof explicitRoomOption === "function"
    ? explicitRoomOption()
    : explicitRoomOption;
}
let cachedDefaultRoomOptions: DefaultRoomOptions = { includeSearch: false };
let cursorOptionsCache: CursorOptions | undefined = undefined;
let cachedOnError: (() => void) | undefined = undefined;

type AcquiredPresenceTransport = {
  transport: RealtimePresenceTransport;
  refCount: number;
};
// One presence socket per room, shared between the cursor client and element
// awareness when their rooms coincide. Refcounted so a cursor-room change
// never tears down a socket element awareness still uses (and vice versa).
const presenceTransportsByRoom = new Map<string, AcquiredPresenceTransport>();
let cursorPresenceTransportRoom: string | null = null;
let elementAwarenessClient: ElementAwarenessClient | null = null;
let elementAwarenessRoom: string | null = null;

function acquirePresenceTransport(
  room: string,
): RealtimePresenceTransport | null {
  if (!canUseRealtimePresenceTransport()) return null;
  const existing = presenceTransportsByRoom.get(room);
  if (existing) {
    existing.refCount++;
    return existing.transport;
  }
  const transport = new RealtimePresenceTransport({
    host: __currentHost,
    room,
  });
  presenceTransportsByRoom.set(room, { transport, refCount: 1 });
  return transport;
}

function releasePresenceTransport(room: string): void {
  const entry = presenceTransportsByRoom.get(room);
  if (!entry) return;
  entry.refCount--;
  if (entry.refCount > 0) return;
  presenceTransportsByRoom.delete(room);
  try {
    entry.transport.destroy();
  } catch {}
}
let roomResetPromise: Promise<void> | null = null;
let pendingRoomResetEpoch: number | null = null;
const SERVER_ROOM_RESET_SYNC_TIMEOUT_MS = 5000;
const mainProviderSyncWaiters = new Set<(error?: Error) => void>();
let isDevelopmentMode = false;

// The config declared for this playhtml instance. Captured by the first call
// that supplies config — whether configure() or a config-bearing init() — and
// locked from then on. Later differing config warns and is ignored (see
// applyConfig). Bootstrap reads everything it needs from here, so config has a
// single source of truth regardless of which call site declared it.
let configuredOptions: InitOptions | null = null;
// True once bootstrap has read config and started connecting. Config is frozen
// from this point — a later configure()/init(options) warns instead of applying.
let hasBootstrapped = false;

/**
 * Normalize a config value into a stable, comparable form that captures only
 * what it actually declares:
 *  - function-valued options (`room` as a function, `events`, `onError`, cursor
 *    callbacks) become undefined — closures never compare equal across call
 *    sites, so comparing them yields false conflicts; the first declaration's
 *    functions win,
 *  - object keys are sorted so key order is ignored,
 *  - a key whose value normalizes to undefined OR to an empty object/array is
 *    dropped, so an option-less object collapses: `{}`, `{ cursors: {} }`, and
 *    `{ room: undefined }` all normalize to `{}` ("declares nothing").
 * Used by both isEmptyConfig and configsConflict so "declares nothing" means
 * the same thing in both.
 */
function normalizeConfig(value: unknown): unknown {
  if (typeof value === "function") return undefined;
  if (Array.isArray(value)) {
    const arr = value.map(normalizeConfig);
    return arr.length === 0 ? undefined : arr;
  }
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      const normalized = normalizeConfig((value as Record<string, unknown>)[key]);
      if (normalized !== undefined) out[key] = normalized;
    }
    return Object.keys(out).length === 0 ? undefined : out;
  }
  return value;
}

/**
 * Returns true if `incoming` conflicts with the already-locked config.
 *
 * Lenient and directional: a conflict requires a key that BOTH sides declare
 * with different values. So:
 *  - passing NO/empty options (an "ensure running" init()) never conflicts,
 *  - passing the SAME options from another call site never conflicts (the
 *    "declare identical options everywhere" pattern stays quiet),
 *  - adding a key the locked config never declared is not a conflict (it's
 *    ignored anyway, since config is locked) — this avoids false positives when
 *    a later call passes a default-valued option the owner simply omitted,
 *  - a genuine value difference on a key BOTH sides declared DOES conflict.
 *
 * Function-valued options can't be compared by value (closures never compare
 * equal), so two functions for the same key are treated as non-conflicting (the
 * first wins). But a key that's a function on one side and a concrete value on
 * the other IS a conflict — otherwise a later `room: () => ...` silently
 * replacing a locked `room: "/x"` would be swallowed with no warning.
 */
function configsConflict(locked: InitOptions, incoming: InitOptions): boolean {
  // A function-vs-non-function declaration for the same key is a real
  // divergence we can detect even though we can't compare the values.
  for (const key of Object.keys(incoming) as (keyof InitOptions)[]) {
    const incomingIsFn = typeof incoming[key] === "function";
    const lockedIsFn = typeof locked[key] === "function";
    const lockedDeclares = locked[key] !== undefined;
    if (incomingIsFn && lockedDeclares && !lockedIsFn) return true;
    if (lockedIsFn && incoming[key] !== undefined && !incomingIsFn) return true;
  }

  const normalizedLocked = (normalizeConfig(locked) ?? {}) as Record<string, unknown>;
  const normalizedIncoming = (normalizeConfig(incoming) ?? {}) as Record<string, unknown>;

  for (const key of Object.keys(normalizedIncoming)) {
    // Can't conflict on a key the locked config never declared.
    if (!(key in normalizedLocked)) continue;
    if (
      JSON.stringify(normalizedIncoming[key]) !==
      JSON.stringify(normalizedLocked[key])
    ) {
      return true;
    }
  }
  return false;
}

/** True if these options declare no config worth locking (an "ensure running"
 * call). Such a call must NOT lock config, so a real configure() can still win
 * before connection. Uses the same normalization as configsConflict, so
 * `{}`, `{ cursors: {} }`, and `{ room: undefined }` all count as empty. */
function isEmptyConfig(options: InitOptions): boolean {
  return normalizeConfig(options) === undefined;
}

/**
 * Capture init config into module state. The first caller to supply real config
 * wins and locks it; a later call with conflicting values warns and is ignored.
 * An empty "ensure running" call does NOT lock — config stays open for a later
 * configure() (until bootstrap connects, after which config can't change).
 */
function applyConfig(options: InitOptions): void {
  if (configuredOptions) {
    if (configsConflict(configuredOptions, options)) {
      console.warn(
        "[playhtml] Ignoring conflicting config passed after playhtml was already configured. " +
          "Config is locked to the first declaration. Declare it once up front with " +
          "playhtml.configure(...) (or matching options at every call site).",
      );
    }
    return;
  }

  if (isEmptyConfig(options)) return;

  // Real config arriving after connection can't be applied — warn and ignore.
  if (hasBootstrapped) {
    console.warn(
      "[playhtml] Ignoring config passed after playhtml already connected. " +
        "Declare it before init() — e.g. with playhtml.configure(...) in a script " +
        "that runs before any component mounts.",
    );
    return;
  }

  // Shallow-copy so a caller that mutates or reuses its options object after
  // declaring config can't silently change the locked config. cursors is
  // copied too since it's the most commonly nested-and-mutated option.
  configuredOptions = { ...options };
  explicitRoomOption = options.room;
  cachedDefaultRoomOptions = options.defaultRoomOptions
    ? { ...options.defaultRoomOptions }
    : { includeSearch: false };
  cursorOptionsCache = options.cursors ? { ...options.cursors } : {};
  cachedOnError = options.onError;
  isDevelopmentMode = options.developmentMode ?? false;

  if (options.extraCapabilities) {
    for (const [tag, tagInfo] of Object.entries(options.extraCapabilities)) {
      capabilitiesToInitializer[tag] = tagInfo;
    }
  }
  if (options.events) {
    for (const [eventType, event] of Object.entries(options.events)) {
      registerPlayEventListener(eventType, event);
    }
  }
}

/** Mark that bootstrap has begun reading config. After this, config is frozen:
 * a configure()/init(options) that arrives later warns rather than silently
 * doing nothing — config genuinely can't change once connected. */
function lockConfigForBootstrap(): void {
  hasBootstrapped = true;
}

/**
 * Builds a fresh main Yjs provider for the given room. Side effects:
 * assigns module-level `yprovider`, attaches onError, attaches
 * raw-socket message handler via microtask. Also walks shared elements/
 * references for the current DOM. Does NOT await sync.
 */
function buildMainProvider(args: {
  room: string;
  partykitHost: string;
  onError: (() => void) | undefined;
  onMessage: (data: string) => void;
}): { sharedReferences: ReturnType<typeof findSharedReferencesOnPage> } {
  const { room, partykitHost, onError, onMessage } = args;

  const sharedElements = findSharedElementsOnPage();
  const sharedReferences = findSharedReferencesOnPage();
  initializeSharedPermissions();

  sharedReferences.forEach((ref) => {
    const referenceKey = `${ref.domain}${ref.path}#${ref.elementId}`;
    discoveredSharedReferences.add(referenceKey);
  });

  const storageKey = `playhtml_resetEpoch_${room}`;
  const storedResetEpoch = localStorage.getItem(storageKey);
  const clientResetEpoch = storedResetEpoch
    ? parseInt(storedResetEpoch, 10)
    : null;

  yprovider = new YProvider(partykitHost, room, doc, {
    params: {
      sharedElements: JSON.stringify(sharedElements),
      sharedReferences: JSON.stringify(sharedReferences),
      clientResetEpoch:
        clientResetEpoch !== null ? String(clientResetEpoch) : null,
    },
  });
  yprovider.on("error", () => {
    onError?.();
  });
  yprovider.on("sync", handleMainProviderSync);

  // Register custom-message handler once, outside the sync callback,
  // to avoid duplicate registrations on reconnect.
  yprovider.on("custom-message", onMessage);

  return { sharedReferences };
}

/** Disconnect and destroy the cursor client + cursor provider. */
function teardownCursors(): void {
  try { cursorClient?.destroy?.(); } catch {}
  cursorClient = null;
  if (cursorPresenceTransportRoom !== null) {
    releasePresenceTransport(cursorPresenceTransportRoom);
    cursorPresenceTransportRoom = null;
  }
  try { cursorProvider?.disconnect?.(); } catch {}
  try { cursorProvider?.destroy?.(); } catch {}
  cursorProvider = null;
}

/** Disconnect and destroy the main Yjs provider. */
function teardownMainProvider(): void {
  try { yprovider?.disconnect?.(); } catch {}
  try { yprovider?.destroy?.(); } catch {}
}

/**
 * Recreate the shared SyncedStore/Y.Doc from scratch. Called on a room change so
 * the new room starts from an empty doc — page AND element data reset to the new
 * room's state, exactly like a page reload, with no tombstone carried into the
 * old room (discard, don't delete). The old doc is destroyed.
 *
 * Everything derived from the doc is rebuilt: globalData, the public read-only
 * store, and the page-data + proxy bookkeeping. Connected element handlers
 * re-register against the fresh store via setupElements() (called by the caller
 * after the new provider is built); surviving page-data handles re-bind lazily
 * through their ensureProxy/attachObserver re-acquire path.
 */
function recreateStore(): void {
  const oldDoc = doc;

  store = syncedStore<StoreShape>({ play: {} });
  doc = getYjsDoc(store);
  publicSyncedStore = createReadOnlyStore(store.play);
  globalData = doc.getMap<Y.Map<any>>("playhtml-global");

  // Proxies and observers referenced the old doc — drop them so they rebuild
  // against the fresh store. KEEP page-data listener sets + refcounts: a channel
  // handle held across the room change is still a handle on that name, and its
  // onUpdate callbacks live in the preserved set. When the channel re-binds to
  // the fresh store (a new createPageData, or a surviving handle's next
  // read/write), its observer re-attaches wired to that same preserved set — so
  // surviving handles keep notifying. (Element proxies have no such cross-nav
  // handle to preserve; they re-register via setupElements.)
  proxyByTagAndId.clear();
  yObserverByKey.clear();

  try {
    oldDoc.destroy();
  } catch {
    // best-effort
  }
}

function getElementAwarenessIdentity(): PlayerIdentity {
  return (
    cursorClient?.getMyPlayerIdentity() ?? generatePersistentPlayerIdentity()
  );
}

/**
 * Connects element awareness to the normalized page room over the generic
 * presence transport. Reuses the cursor presence socket when the cursor room
 * IS the page room (via the refcounted registry); otherwise opens a separate
 * page-scoped socket. Falls back to the Yjs-awareness path (bindAwarenessListener)
 * when the transport is unavailable.
 */
function buildElementAwarenessClient(): void {
  const transport = acquirePresenceTransport(__currentRoomId);
  if (!transport) return;
  elementAwarenessRoom = __currentRoomId;
  elementAwarenessClient = new ElementAwarenessClient({
    transport,
    getIdentity: getElementAwarenessIdentity,
    getPage: getPresencePage,
    onAwareness: applyElementAwareness,
  });
}

function teardownElementAwarenessClient(): void {
  if (!elementAwarenessClient) return;
  try {
    elementAwarenessClient.destroy();
  } catch {}
  elementAwarenessClient = null;
  if (elementAwarenessRoom !== null) {
    releasePresenceTransport(elementAwarenessRoom);
    elementAwarenessRoom = null;
  }
}

/**
 * Detach the current awareness "change" listener (if any) and attach a fresh
 * one to the provider that holds element awareness. Safe to call multiple times.
 */
function bindAwarenessListener(): void {
  // Transport mode: element awareness flows through elementAwarenessClient,
  // not Yjs awareness — nothing to bind.
  if (elementAwarenessClient) return;
  if (awarenessChangeTarget && awarenessChangeHandler) {
    try {
      awarenessChangeTarget.awareness.off("change", awarenessChangeHandler);
    } catch {}
  }
  awarenessChangeTarget = null;
  awarenessChangeHandler = null;

  const provider = getElementAwarenessProvider();
  if (!provider) return;
  const handler = () => onChangeAwareness();
  provider.awareness.on("change", handler);
  awarenessChangeTarget = provider;
  awarenessChangeHandler = handler;
}

/**
 * Builds the cursor client and optional separate cursor provider for the
 * given main room. Side effects: assigns module-level `cursorProvider` and
 * `cursorClient`, and `currentCursorRoomId`. Returns without awaiting sync.
 *
 * Safe to call multiple times — assumes prior cursorClient/cursorProvider
 * were already torn down by the caller.
 */
function buildCursors(args: {
  cursors: CursorOptions;
  mainRoom: string;
  partykitHost: string;
  onError: (() => void) | undefined;
}): void {
  const { cursors, mainRoom, partykitHost, onError } = args;

  if (!cursors.enabled) {
    currentCursorRoomId = "";
    return;
  }

  const cursorOptions: CursorOptions = { ...cursors };
  if (!cursorOptions.playerIdentity) {
    cursorOptions.playerIdentity = generatePersistentPlayerIdentity();
  }

  let providerForCursors: YProvider = yprovider;

  if (cursorOptions.room) {
    const cursorRoomString = resolveCursorRoom(cursorOptions.room);
    const cursorRoom = normalizeRoomId(window.location.host, cursorRoomString);

    if (cursorRoom !== mainRoom) {
      const cursorDoc = new Y.Doc();
      cursorProvider = new YProvider(
        partykitHost,
        cursorRoom,
        cursorDoc,
      );
      cursorProvider.on("error", () => {
        onError?.();
      });
      providerForCursors = cursorProvider;
      currentCursorRoomId = cursorRoom;
    } else {
      currentCursorRoomId = mainRoom;
    }
  } else {
    currentCursorRoomId = mainRoom;
  }

  const cursorPresenceTransport =
    acquirePresenceTransport(currentCursorRoomId) ?? undefined;
  cursorPresenceTransportRoom = cursorPresenceTransport
    ? currentCursorRoomId
    : null;
  cursorClient = new CursorClientAwareness(
    providerForCursors,
    cursorOptions,
    cursorPresenceTransport,
  );
}

function storeResetEpochForRoom(room: string, resetEpoch: number): void {
  const storageKey = `playhtml_resetEpoch_${room}`;
  localStorage.setItem(storageKey, String(resetEpoch));
  console.log(
    `[PLAYHTML] Stored resetEpoch=${resetEpoch} in localStorage key=${storageKey}`,
  );
}

function waitForMainProviderSync(timeoutMs?: number): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    if (hasSynced) {
      resolve();
      return;
    }

    let settled = false;
    let timeout: ReturnType<typeof setTimeout> | null = null;
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      if (timeout !== null) clearTimeout(timeout);
      mainProviderSyncWaiters.delete(finish);
      if (error) {
        reject(error);
      } else {
        resolve();
      }
    };

    mainProviderSyncWaiters.add(finish);

    if (timeoutMs !== undefined) {
      timeout = setTimeout(() => {
        finish(new Error("Timed out waiting for playhtml room reset sync"));
      }, timeoutMs);
    }
  });
}

function handleMainProviderSync(connected: boolean): void {
  if (!connected) console.error("Issue connecting to yjs...");
  if (hasSynced) return;
  hasSynced = true;
  const waiters = [...mainProviderSyncWaiters];
  mainProviderSyncWaiters.clear();
  waiters.forEach((finish) => finish());
}

function queueServerRoomReset(resetEpoch: number): void {
  storeResetEpochForRoom(__currentRoomId, resetEpoch);

  if (roomResetPromise) {
    pendingRoomResetEpoch = Math.max(pendingRoomResetEpoch ?? 0, resetEpoch);
    return;
  }

  roomResetPromise = runQueuedServerRoomReset(resetEpoch)
    .catch((error) => {
      console.error("[PLAYHTML] Failed to reconnect after room-reset:", error);
      window.location.reload();
    })
    .finally(() => {
      roomResetPromise = null;
      pendingRoomResetEpoch = null;
    });
}

async function runQueuedServerRoomReset(resetEpoch: number): Promise<void> {
  let nextResetEpoch = resetEpoch;

  while (true) {
    const completedResetEpoch = nextResetEpoch;
    pendingRoomResetEpoch = null;
    await resetCurrentRoomFromServer();

    if (
      pendingRoomResetEpoch === null ||
      pendingRoomResetEpoch <= completedResetEpoch
    ) {
      return;
    }

    nextResetEpoch = pendingRoomResetEpoch;
  }
}

async function resetCurrentRoomFromServer(): Promise<void> {
  if (!__currentRoomId || !__currentHost) {
    throw new Error("playhtml cannot reset before init()");
  }

  teardownMainProvider();
  teardownCursors();
  hasSynced = false;
  lastElementAwarenessFingerprint = null;
  trackedElementAwarenessKeys.clear();
  recreateStore();

  buildMainProvider({
    room: __currentRoomId,
    partykitHost: __currentHost,
    onError: cachedOnError,
    onMessage,
  });

  if (cursorOptionsCache?.enabled) {
    buildCursors({
      cursors: cursorOptionsCache,
      mainRoom: __currentRoomId,
      partykitHost: __currentHost,
      onError: cachedOnError,
    });
  }

  bindAwarenessListener();
  markAllElementsAsLoading();
  await waitForMainProviderSync(SERVER_ROOM_RESET_SYNC_TIMEOUT_MS);
  refreshPageDataChannels(getPageDataDeps());
  setupElements();
  markAllElementsAsReady();
  cursorClient?.refreshContainer?.();
  cursorClient?.refreshCursorStyles?.();
  dispatchNavigated(__currentRoomId);
}

/**
 * Wires the listener that lets the browser extension inject a player identity.
 * The extension runs in Chrome's isolated world and can't call
 * cursorClient.configure() directly, so it dispatches a CustomEvent on the
 * shared DOM instead.
 *
 * The extension only provides publicKey and playerStyle (the canonical stable
 * identity + chosen color). All other fields on the page's current identity are
 * preserved — the page may have arbitrary fields the extension doesn't know
 * about.
 *
 * Idempotent: only attaches once. Safe to call from both the initial
 * cursor-enabled path and the late-enable path.
 */
function setupExtensionIdentityListener(): void {
  if (configureIdentityListener) return;

  // TODO: The extension should also be able to set `name` — currently
  // there's no UI for it in the extension, so we preserve the page's
  // value. Once the extension has a name field, include it in the merge.
  configureIdentityListener = ((e: CustomEvent) => {
    const incoming = e.detail?.playerIdentity;
    if (!incoming || !cursorClient) return;

    const current = cursorClient.getMyPlayerIdentity();
    const merged = {
      ...current,
      publicKey: incoming.publicKey,
      playerStyle: incoming.playerStyle,
    };

    cursorClient.configure({ playerIdentity: merged });
    elementAwarenessClient?.refreshIdentity();
    console.log("[playhtml] Merged extension identity via CustomEvent");
  }) as EventListener;
  document.addEventListener(
    "playhtml:configure-identity",
    configureIdentityListener,
  );

  // Signal that we're ready to receive identity injection events
  document.dispatchEvent(new CustomEvent("playhtml:ready"));
}

async function runHandleNavigation(): Promise<void> {
  // firstSetup is true before init and after resetPlayHTML — skip nav in both.
  if (firstSetup) return;

  const nextRoomInput =
    resolveExplicitRoom() ?? getDefaultRoom(cachedDefaultRoomOptions);
  const newMainRoom = normalizeRoomId(window.location.host, nextRoomInput);
  const mainRoomChanged = newMainRoom !== __currentRoomId;

  const cursorsWanted = Boolean(cursorOptionsCache?.enabled);
  const cursorsActive = cursorClient !== null;
  // Cursor setup is static after init, but the cursor client can still be
  // rebuilt when navigation changes the cursor room.
  const cursorEnabledChanged = cursorsWanted !== cursorsActive;

  let cursorRoomChanged = false;
  if (cursorOptionsCache?.enabled) {
    if (cursorOptionsCache.room) {
      const resolved = resolveCursorRoom(cursorOptionsCache.room);
      const normalized = normalizeRoomId(window.location.host, resolved);
      cursorRoomChanged = normalized !== currentCursorRoomId;
    } else {
      cursorRoomChanged = mainRoomChanged;
    }
  }

  // Drop handlers whose DOM element is no longer connected (e.g. innerHTML-swap
  // or framework unmount without calling removePlayElement). Keep handlers for
  // elements still in the DOM — they already have listeners wired, and
  // re-creating a handler here would attach duplicates since ElementHandler
  // has no listener cleanup. React-managed elements stay connected across
  // route changes when the same node is reused; React's unmount path already
  // calls removePlayElement for replaced nodes.
  for (const [, map] of elementHandlers) {
    for (const [id, handler] of [...map.entries()]) {
      const el = (handler as { element?: HTMLElement }).element;
      if (!el || !el.isConnected) {
        // Run onMount cleanup (rAF loops, timers, listeners) and disconnect the
        // descendant observer before dropping the handler — otherwise a
        // view element's clock loop keeps ticking forever after navigation.
        (handler as { destroy?: () => void }).destroy?.();
        map.delete(id);
      }
    }
  }

  if (mainRoomChanged) {
    teardownMainProvider();
    teardownElementAwarenessClient();
    hasSynced = false;
    lastElementAwarenessFingerprint = null;
    trackedElementAwarenessKeys.clear();
    // Re-init the doc for the new room: page AND element data are room-scoped,
    // and the doc is reused across rooms, so a fresh doc resets both to the new
    // room (like a page reload) without syncing a delete tombstone back to the
    // old room. Must happen before buildMainProvider so the new provider binds
    // the fresh doc.
    recreateStore();
    buildMainProvider({
      room: newMainRoom,
      partykitHost: __currentHost,
      onError: cachedOnError,
      onMessage,
    });
    __currentRoomId = newMainRoom;
    buildElementAwarenessClient();
  }

  if (cursorEnabledChanged || (cursorRoomChanged && cursorOptionsCache)) {
    // teardownCursors handles the disable case (wanted off, currently on) and
    // clears the way for a rebuild on enable / room change.
    teardownCursors();
    if (cursorsWanted && cursorOptionsCache) {
      buildCursors({
        cursors: cursorOptionsCache,
        mainRoom: newMainRoom,
        partykitHost: __currentHost,
        onError: cachedOnError,
      });
    }
  }

  // Element awareness lives on the page provider, so rebind only when the page
  // room provider is rebuilt and its awareness object has been replaced.
  if (mainRoomChanged) {
    bindAwarenessListener();
  }

  markAllElementsAsLoading();

  if (mainRoomChanged) {
    await waitForMainProviderSync();
    refreshPageDataChannels(getPageDataDeps());
  }

  setupElements();
  markAllElementsAsReady();

  cursorClient?.refreshContainer?.();
  cursorClient?.refreshCursorStyles?.();

  dispatchNavigated(__currentRoomId);
}

/**
 * Declare config for this playhtml instance without connecting. Idempotent and
 * framework-agnostic: call it once, up front, from wherever owns the config (a
 * <head> script, PlayProvider, an island). Connection happens later via init()
 * / standalone component mount, which read whatever config was declared here.
 *
 * Use this when you can't put a single init() at the top of your app — Astro
 * islands, multi-page apps, multiple React roots — so config doesn't depend on
 * which "ensure running" call happens to run first. The first declaration wins;
 * a later conflicting one warns and is ignored.
 */
function configurePlayHTML(options: InitOptions = {}): void {
  applyConfig(options);
}

function initPlayHTML(options: InitOptions = {}) {
  if (initStarted) {
    // Already bootstrapping/running. init() here means "ensure running" — the
    // connection is already in flight. Still funnel options through applyConfig
    // so a conflicting late config warns (and a matching/empty one is a quiet
    // no-op). Config is locked to the first declaration.
    applyConfig(options);
    return readyPromise;
  }

  const existingPlayhtml = (window as any).playhtml;
  if (existingPlayhtml) {
    if (isPromiseLike(existingPlayhtml.ready)) {
      readyPromise = existingPlayhtml.ready;
      readyPromise.then(
        () => {
          isLoading = false;
        },
        () => {},
      );
      initStarted = true;
      return readyPromise;
    }

    const error = new Error(
      "playhtml is already set up by an incompatible instance. Make sure @playhtml/react and playhtml use matching versions.",
    );
    readyReject(error);
    initStarted = true;
    return readyPromise;
  }

  initStarted = true;
  // Capture config (honoring any earlier configure() call — applyConfig is a
  // no-op if config is already locked) before bootstrapping.
  applyConfig(options);
  const initPromise = initPlayHTMLOnce();
  initPromise.catch((error) => {
    readyReject(error);
  });
  return initPromise;
}

/**
 * Connect and set up playhtml. Reads config exclusively from module state
 * (populated by applyConfig), so there is a single source of truth regardless
 * of which call site declared the config.
 *
 * TODO: if it is a localhost url, need to make some deterministic way to connect
 * to the same room.
 */
async function initPlayHTMLOnce() {
  // Connection is about to read config; freeze it. A later configure() now
  // warns instead of silently no-op'ing — config can't change post-connect.
  lockConfigForBootstrap();
  // host/onError/developmentMode are not mirrored into long-lived module state
  // beyond cachedOnError/isDevelopmentMode, so read them from configuredOptions.
  const host = configuredOptions?.host;
  const cursors = cursorOptionsCache ?? {};
  const inputRoom =
    resolveExplicitRoom() ?? getDefaultRoom(cachedDefaultRoomOptions);
  const onError = cachedOnError;
  // @ts-ignore
  window.playhtml = playhtml;
  // DOM marker visible to browser extension content scripts (which run in an
  // isolated world and can't see window.playhtml). Set early so the extension
  // can detect native playhtml before cursor styles are injected.
  document.documentElement.dataset.playhtml = "true";

  // TODO: change to md5 hash if room ID length becomes problem / if some other analytic for telling who is connecting
  // TODO: We want to normalize here but we can't without losing data.
  const room = normalizeRoomId(window.location.host, inputRoom);

  const partykitHost = getPartykitHost(host);
  __currentRoomId = room;
  __currentHost = partykitHost;

  console.log(
    `࿂࿂࿂࿂࿂࿂࿂࿂࿂࿂࿂࿂࿂࿂࿂࿂࿂࿂࿂࿂࿂࿂࿂࿂࿂࿂࿂࿂࿂࿂࿂࿂࿂࿂࿂࿂࿂࿂
࿂࿂࿂࿂  ࿂    ࿂    ࿂    ࿂    ࿂  ࿂࿂࿂࿂
࿂࿂࿂࿂ booting up playhtml... ࿂࿂࿂࿂
࿂࿂࿂࿂  https://playhtml.fun  ࿂࿂࿂࿂
࿂࿂࿂࿂   ࿂     ࿂     ࿂     ࿂   ࿂࿂࿂࿂
࿂࿂࿂࿂࿂࿂࿂࿂࿂࿂࿂࿂࿂࿂࿂࿂࿂࿂࿂࿂࿂࿂࿂࿂࿂࿂࿂࿂࿂࿂࿂࿂࿂࿂࿂࿂࿂࿂`,
  );

  const { sharedReferences } = buildMainProvider({
    room,
    partykitHost,
    onError,
    onMessage,
  });

  // Initialize cursor tracking immediately after provider creation
  buildCursors({
    cursors,
    mainRoom: room,
    partykitHost,
    onError,
  });

  buildElementAwarenessClient();

  if (cursors.enabled) {
    setupExtensionIdentityListener();
  }

  // Create presence API — always available, wraps whichever awareness provider exists
  presenceAPI = createPresenceAPI({
    getAwareness: () => (cursorClient?.getProvider() ?? yprovider).awareness,
    getPlayerIdentity: () =>
      cursorClient?.getMyPlayerIdentity() ?? generatePersistentPlayerIdentity(),
    getCursorPresences: () => cursorClient?.getCursorPresences() ?? new Map(),
    onCursorPresencesChange: (callback) =>
      cursorClient?.onCursorPresencesChange(callback) ?? (() => {}),
  });

  // extraCapabilities and events were applied by applyConfig when config was
  // declared, so they're available before this connect step runs.

  // Import default styles
  const playStyles = document.createElement("link");
  playStyles.rel = "stylesheet";
  playStyles.href = "https://unpkg.com/playhtml@latest/dist/style.css";
  document.head.appendChild(playStyles);

  if (isDevelopmentMode) {
    setupDevUI(playhtml);
  }
  // TODO: expose a way to activate the dev tools UI on any page at runtime
  // (e.g. window.playhtml.showDevTools()) so it can be triggered from the
  // browser console or from an admin panel without requiring developmentMode
  // in the init config. This would call setupDevUI(playhtml) on demand.

  // Mark all discovered playhtml elements as loading before sync
  markAllElementsAsLoading();

  await waitForMainProviderSync();
  console.log("[PLAYHTML]: Setting up elements... Time to have some fun 🛝");

  setupElements();

  // Mark all elements as ready after sync completes and elements are set up
  markAllElementsAsReady();
  isLoading = false;
  readyResolve();

  // Fetch simple permissions for referenced shared elements so clients can block writes locally
  if (sharedReferences.length > 0) {
    try {
      const elementIds = sharedReferences.map((r) => r.elementId);
      yprovider.sendMessage(
        JSON.stringify({ type: "export-permissions", elementIds })
      );
    } catch (error) {
      console.error("[PLAYHTML] Error during post-sync setup:", error);
    }
  }

  return yprovider;
}

function getElementAwareness(tagType: TagType, elementId: string) {
  if (elementAwarenessClient) {
    return elementAwarenessClient.getLocalAwareness(tagType, elementId);
  }
  const awarenessProvider = getElementAwarenessProvider();
  const awareness = awarenessProvider.awareness.getLocalState();
  const elementAwareness = awareness?.[tagType] ?? {};
  return elementAwareness[elementId];
}

function getElementAwarenessProvider(): YProvider {
  return yprovider;
}

function isHTMLElement(ele: any): ele is HTMLElement {
  return ele instanceof HTMLElement;
}

// Loading state management functions
function getDefaultLoadingBehavior(element: HTMLElement): string {
  if (element.hasAttribute("can-play")) return "none"; // No auto-loading for can-play
  return "animate"; // can-move, can-toggle, can-spin, can-grow, etc.
}

function markElementAsLoading(element: HTMLElement): void {
  const behavior =
    element.getAttribute("loading-behavior") ||
    getDefaultLoadingBehavior(element);

  if (behavior === "none") return;

  element.classList.add("playhtml-loading");

  // Add custom loading class if specified
  const customLoadingClass = element.getAttribute("loading-class");
  if (customLoadingClass) {
    element.classList.add(customLoadingClass);
  }

  // Add accessibility attributes
  element.setAttribute("aria-busy", "true");
  element.setAttribute("aria-live", "polite");
}

function markElementAsReady(element: HTMLElement): void {
  const behavior =
    element.getAttribute("loading-behavior") ||
    getDefaultLoadingBehavior(element);

  if (behavior === "none") return;

  element.classList.remove("playhtml-loading");

  // Remove custom loading class if it was added
  const customLoadingClass = element.getAttribute("loading-class");
  if (customLoadingClass) {
    element.classList.remove(customLoadingClass);
  }

  // Remove accessibility attributes
  element.removeAttribute("aria-busy");
  element.removeAttribute("aria-live");
}

function markAllElementsAsLoading(): void {
  for (const tag of getTagTypes()) {
    const tagElements: HTMLElement[] = Array.from(
      document.querySelectorAll(`[${tag}]`),
    ).filter(isHTMLElement);

    tagElements.forEach((element) => {
      markElementAsLoading(element);
    });
  }
}

function markAllElementsAsReady(): void {
  for (const tag of getTagTypes()) {
    const tagElements: HTMLElement[] = Array.from(
      document.querySelectorAll(`[${tag}]`),
    ).filter(isHTMLElement);

    tagElements.forEach((element) => {
      markElementAsReady(element);
    });
  }
}

function createPlayElementData<T extends TagType, TData = any>(
  element: HTMLElement,
  tag: T,
  tagInfo: ElementInitializer<TData>,
  elementId: string,
): ElementData<TData> {
  if (VERBOSE) {
    console.log("registering element", elementId, "using SyncedStore data");
  }

  const initialData =
    tagInfo.defaultData instanceof Function
      ? tagInfo.defaultData(element)
      : tagInfo.defaultData;

  const dataProxy =
    tagInfo.defaultData === undefined
      ? undefined
      : ensureElementProxy<TData>(tag, elementId, initialData as TData);
  const initialAwareness = getElementAwareness(tag, elementId);

  const elementData: ElementData = {
    ...tagInfo,
    myDefaultAwareness:
      initialAwareness !== undefined
        ? initialAwareness
        : tagInfo.myDefaultAwareness,
    devMode: isDevelopmentMode,
    // Always provide a plain snapshot to render paths
    data: clonePlain(dataProxy),
    awareness:
      initialAwareness !== undefined
        ? [initialAwareness]
        : tagInfo.myDefaultAwareness !== undefined
          ? [tagInfo.myDefaultAwareness]
          : undefined,
    element,
    onChange: (newData: TData) => {
      if (dataProxy === undefined) {
        console.error(
          `[playhtml] setData() was called for "${elementId}", but its initializer does not define \`defaultData\`.`,
        );
        return;
      }
      // Prevent writes for read-only shared consumer elements
      const elementIdFromAttr = getIdForElement(element);
      if (isSharedReadOnly(element, elementIdFromAttr)) {
        return;
      }
      if (typeof newData === "function") {
        // Mutator form support: onChange can accept function(draft)
        // Batch all nested mutations into a single Yjs transaction to coalesce events
        doc.transact(() => {
          const returned = (newData as (draft: unknown) => unknown)(dataProxy);
          // Only warn when the return looks like an intended *replacement*
          // snapshot (an object/array). Terse arrows like `d => d.count++` or
          // `d => (d.x = 1)` return a number/boolean as a side effect of a
          // valid in-place mutation — warning on those is just noise.
          if (
            isDevelopmentMode &&
            returned !== undefined &&
            typeof returned === "object"
          ) {
            console.warn(
              `[playhtml] A setData() mutator for "${elementId}" returned an object. ` +
                `Mutators must mutate the draft in place (e.g. \`d => { d.count++ }\`); ` +
                `the return value is ignored. To replace the whole snapshot, pass a value instead of a function.`,
            );
          }
        });
      } else {
        // Value form: replace snapshot semantics
        doc.transact(() => {
          deepReplaceIntoProxy(dataProxy, newData);
        });
      }
    },
    onAwarenessChange: (elementAwarenessData) => {
      if (elementAwarenessClient) {
        elementAwarenessClient.setLocalAwareness(
          tag,
          elementId,
          elementAwarenessData,
        );
        return;
      }
      const awarenessProvider = getElementAwarenessProvider();
      ensureAwarenessIdentity(
        awarenessProvider.awareness,
        cursorClient?.getMyPlayerIdentity() ?? generatePersistentPlayerIdentity(),
      );
      const existingAwareness =
        awarenessProvider.awareness.getLocalState()?.[tag] || {};

      if (existingAwareness[elementId] === elementAwarenessData) {
        return;
      }

      // Build a fresh object rather than mutating the existing one in place.
      // y-protocols' setLocalState detects changes via deep equality against the
      // previous state; mutating the current state object in place makes that
      // comparison see no change, which suppresses the "change" event the
      // provider listens on to broadcast awareness — so peers never receive it.
      const nextAwareness = { ...existingAwareness, [elementId]: elementAwarenessData };
      awarenessProvider.awareness.setLocalStateField(tag, nextAwareness);
    },
    triggerAwarenessUpdate: () => {
      if (elementAwarenessClient) {
        // setLocalAwareness (called by onAwarenessChange, which always runs
        // immediately before this in setMyAwareness) already emitted the
        // handler sweep synchronously. Refreshing here would fire
        // updateElementAwareness a second time for the same local write.
        return;
      }
      onChangeAwareness();
    },
  };

  return elementData;
}

function isCorrectElementInitializer(
  tagInfo: ElementInitializer | Partial<ElementInitializer> | undefined,
): tagInfo is ElementInitializer {
  return getElementInitializerValidationIssues(tagInfo).length === 0;
}

function getElementInitializerValidationIssues(
  tagInfo: ElementInitializer | Partial<ElementInitializer> | undefined,
): string[] {
  if (tagInfo == null) {
    return ["initializer"];
  }

  const issues: string[] = [];

  const hasDefaultData = tagInfo.defaultData !== undefined;
  const hasValidDefaultData =
    hasDefaultData &&
    tagInfo.defaultData !== null &&
    (typeof tagInfo.defaultData === "object" ||
      typeof tagInfo.defaultData === "function");
  const hasUpdateElement = typeof tagInfo.updateElement === "function";
  const hasView = typeof tagInfo.view === "function";
  const hasDataUpdate = hasUpdateElement || hasView;
  const hasMyDefaultAwareness = tagInfo.myDefaultAwareness !== undefined;
  const hasUpdateElementAwareness =
    typeof tagInfo.updateElementAwareness === "function";
  const hasUpdateFunction = hasDataUpdate || hasUpdateElementAwareness;

  if (hasDefaultData && !hasValidDefaultData) {
    issues.push("defaultData must be an object or function");
  }

  if (hasDefaultData && !hasDataUpdate) {
    issues.push("defaultData requires updateElement or view");
  } else if (!hasDefaultData && hasDataUpdate) {
    issues.push("updateElement or view requires defaultData");
  }

  if (hasMyDefaultAwareness && !hasUpdateElementAwareness) {
    issues.push("myDefaultAwareness requires updateElementAwareness");
  }

  if (issues.length === 0 && !hasUpdateFunction) {
    issues.push("updateElement, view, or updateElementAwareness");
  }

  return issues;
}

// Read custom element properties set by CanPlayElement (React) on the DOM node
function getCustomElementProps(element: HTMLElement) {
  const el = element as any;
  const props: Partial<ElementInitializer> = {};
  const keys: (keyof ElementInitializer)[] = [
    "defaultData",
    "defaultLocalData",
    "myDefaultAwareness",
    "updateElement",
    "view",
    "updateElementAwareness",
    "onDrag",
    "onDragStart",
    "onClick",
    "onMount",
    "resetShortcut",
    "debounceMs",
    "isValidElementForTag",
  ];
  for (const key of keys) {
    if (el[key] !== undefined) {
      props[key] = el[key];
    }
  }
  // Legacy alias
  if (el.additionalSetup !== undefined && props.onMount === undefined) {
    props.onMount = el.additionalSetup;
  }
  return props;
}

function shouldReadElementPropsForTag(
  tag: TagType | string,
  element: HTMLElement,
): boolean {
  return tag === TagType.CanPlay || !element.hasAttribute(TagType.CanPlay);
}

function getElementInitializerInfoForElement(
  tag: TagType | string,
  element: HTMLElement,
) {
  if (tag === TagType.CanPlay) {
    // For can-play, all properties come from the DOM element
    const customProps = getCustomElementProps(element);
    return customProps as Required<Omit<ElementInitializer, "additionalSetup">>;
  }

  const builtIn = capabilitiesToInitializer[tag];
  if (!builtIn) return undefined;

  if (!shouldReadElementPropsForTag(tag, element)) {
    return builtIn;
  }

  const customProps = getCustomElementProps(element);
  // Merge: built-in defaults overridden by any custom properties on the element
  return { ...builtIn, ...customProps };
}

function onChangeAwareness() {
  const awarenessProvider = getElementAwarenessProvider();
  const states = awarenessProvider.awareness.getStates();

  // Only run when element-awareness data changed. Cursor client writes __playhtml_cursors__
  // on every mouse move (up to 60fps); skip rebuild and handler updates when only that changed.
  const fingerprint = getElementAwarenessFingerprint(
    states as Map<number, Record<string, unknown>>,
  );
  if (fingerprint === lastElementAwarenessFingerprint) {
    return;
  }
  lastElementAwarenessFingerprint = fingerprint;

  // Build awareness per element: { array: V[], byStableId: Map<string, V> }
  const elementAwareness = new Map<
    string,
    { array: any[]; byStableId: Map<string, any> }
  >();

  states.forEach((state, clientId) => {
    const stableId = getStableIdForAwareness(
      state as Record<string, unknown>,
      clientId,
    );

    // Process each tag type
    Object.keys(state).forEach((tag) => {
      if (tag.startsWith("__")) return; // Skip reserved fields like __playhtml_cursors__

      const tagData = state[tag];
      if (!tagData || typeof tagData !== "object") return;

      Object.keys(tagData).forEach((elementId) => {
        const awarenessValue = tagData[elementId];
        const key = `${tag}:${elementId}`;

        if (!elementAwareness.has(key)) {
          elementAwareness.set(key, { array: [], byStableId: new Map() });
        }

        const entry = elementAwareness.get(key)!;
        entry.array.push(awarenessValue);
        entry.byStableId.set(stableId, awarenessValue);
      });
    });
  });

  applyElementAwareness(elementAwareness);
}

function applyElementAwareness(elementAwareness: ElementAwarenessMap): void {
  elementAwareness.forEach(({ array, byStableId }, key) => {
    updateHandlerAwarenessForKey(key, array, byStableId);
  });

  for (const key of trackedElementAwarenessKeys) {
    if (elementAwareness.has(key)) continue;
    updateHandlerAwarenessForKey(key, [], new Map());
  }

  trackedElementAwarenessKeys = new Set(elementAwareness.keys());
}

function updateHandlerAwarenessForKey(
  key: string,
  array: any[],
  byStableId: Map<string, any>,
) {
  // Split only on first colon so element IDs that contain colons (valid in HTML) are preserved
  const colonIndex = key.indexOf(":");
  const tag = key.slice(0, colonIndex);
  const elementId = key.slice(colonIndex + 1);
  const tagElementHandlers = elementHandlers.get(tag as TagType);
  if (!tagElementHandlers) return;

  const handler = tagElementHandlers.get(elementId);
  if (handler) {
    handler.updateAwareness(array, byStableId);
  }
}

/**
 * Sets up any playhtml elements that are currently on the page.
 *
 * Should be called only once. If you'd like to set up new elements, use `setupPlayElement`, which is exposed
 * on the `playhtml` object on `window`.
 */
function setupElements(): void {
  if (!hasSynced) {
    return;
  }

  // Stamp any registrations made before init() onto their elements so the
  // can-play scan below picks them up.
  for (const [id, init] of pendingRegistrations) {
    const el = document.getElementById(id);
    if (el && isHTMLElement(el)) {
      stampRegistrationOntoElement(el, init);
    }
  }

  for (const tag of getTagTypes()) {
    const tagElements: HTMLElement[] = Array.from(
      document.querySelectorAll(`[${tag}]`),
    ).filter(isHTMLElement);

    if (!tagElements.length) {
      continue;
    }

    if (VERBOSE) {
      console.log(`SET UP ${tag}`);
    }
    void Promise.all(
      tagElements.map((element) => setupPlayElementForTag(element, tag)),
    );
  }

  if (!firstSetup) {
    return;
  }

  if (elementAwarenessClient) {
    // Seed handlers from any peer state that arrived before elements bound.
    elementAwarenessClient.refresh();
  } else {
    // Re-bound on provider rebuild via bindAwarenessListener so nav-time provider
    // swaps don't leave an orphaned listener.
    bindAwarenessListener();
    // Trigger initial awareness sync to populate existing states
    onChangeAwareness();
  }

  navigationController = createNavigationController(async () => {
    await runHandleNavigation();
  });
  detachNavListeners = attachNavigationListeners(navigationController);

  firstSetup = false;
}

function getPageDataDeps() {
  return {
    ensureProxy: ensureElementProxy,
    getProxy: (tag: string, id: string) => proxyByTagAndId.get(tag)?.get(id),
    // Getters so a handle held across a room change (which recreates store/doc)
    // reads the current ones, not stale references captured at creation.
    getDoc: () => doc,
    getStorePlay: () => store.play,
    proxyByTagAndId,
    yObserverByKey,
    channelRefCounts: pageDataRefCounts,
    channelListeners: pageDataListeners,
  };
}

function createPageData<T>(name: string, defaultValue: T): PageDataChannel<T> {
  if (!hasSynced) {
    throw new Error("playhtml.createPageData is not available before init()");
  }
  return createPageDataChannel(name, defaultValue, getPageDataDeps());
}

function createPresenceRoom(name: string): PresenceRoom {
  if (!hasSynced) {
    throw new Error("playhtml.createPresenceRoom is not available before init()");
  }

  const roomId = normalizeRoomId(window.location.host, name);
  const roomDoc = new Y.Doc();
  const provider = new YProvider(__currentHost, roomId, roomDoc);

  const presence = createPresenceAPI({
    getAwareness: () => provider.awareness,
    getPlayerIdentity: () =>
      cursorClient?.getMyPlayerIdentity() ?? generatePersistentPlayerIdentity(),
  });

  let destroyed = false;
  return {
    presence,
    destroy: () => {
      if (destroyed) return;
      destroyed = true;
      provider.destroy();
      roomDoc.destroy();
    },
  };
}

export interface PlayHTMLComponents {
  init: typeof initPlayHTML;
  configure: typeof configurePlayHTML;
  readonly isLoading: boolean;
  readonly ready: Promise<void>;
  handleNavigation: () => Promise<void>;
  setupPlayElements: typeof setupElements;
  setupPlayElement: typeof setupPlayElement;
  removePlayElement: typeof removePlayElement;
  deleteElementData: typeof deleteElementData;
  setupPlayElementForTag: typeof setupPlayElementForTag;
  /** @experimental View API — register a custom element by id. */
  register: typeof registerPlayElement;
  /** @experimental View API — register a reusable capability by attribute name. */
  define: typeof definePlayCapability;
  /** @experimental View API — get a handle for a bound element. */
  getHandle: (elementId: string, tag?: string) => PlayElementHandle;
  syncedStore: ReadOnlyStore<PlayStore["play"]>;
  elementHandlers: Map<string, Map<string, ElementHandler>>;
  eventHandlers: Map<string, Array<RegisteredPlayEvent>>;
  dispatchPlayEvent: typeof dispatchPlayEvent;
  registerPlayEventListener: typeof registerPlayEventListener;
  removePlayEventListener: typeof removePlayEventListener;
  cursorClient: CursorClientAwareness | null;
  presence: PresenceAPI;
  createPageData: typeof createPageData;
  createPresenceRoom: typeof createPresenceRoom;
  // Debug / Dev helpers
  roomId: string;
  host: string;
  listSharedElements: () => Array<{
    type: "source" | "consumer";
    elementId: string;
    dataSource: string;
    normalized: string;
    permissions?: "read-only" | "read-write";
    element: HTMLElement;
  }>;
}

/**
 * Full teardown of all playhtml state. Not part of the public API —
 * the singleton design means no single caller can safely own teardown
 * without reference counting. Exported as a named function for test
 * isolation (beforeEach resets) only.
 */
export async function resetPlayHTML(): Promise<void> {
  if (firstSetup && !initStarted) return;

  try {
    if (navigationController) {
      navigationController.destroy();
      navigationController = null;
    }
    if (detachNavListeners) {
      detachNavListeners();
      detachNavListeners = null;
    }

    if (configureIdentityListener) {
      document.removeEventListener(
        "playhtml:configure-identity",
        configureIdentityListener,
      );
      configureIdentityListener = null;
    }

    // Detach awareness change listener before destroying providers, so we
    // cleanly `.off("change", ...)` rather than leaking the subscription on
    // a soon-to-be-destroyed awareness object.
    if (awarenessChangeTarget && awarenessChangeHandler) {
      try {
        awarenessChangeTarget.awareness.off("change", awarenessChangeHandler);
      } catch {}
    }
    awarenessChangeTarget = null;
    awarenessChangeHandler = null;

    for (const [, map] of elementHandlers) {
      for (const handler of map.values()) {
        try {
          (handler as any).destroy?.();
        } catch {}
      }
      map.clear();
    }
    elementHandlers.clear();
    pageDataRefCounts.clear();
    pageDataListeners.clear();
    mainProviderSyncWaiters.clear();

    teardownElementAwarenessClient();
    teardownCursors();
    teardownMainProvider();

    for (const [, entry] of presenceTransportsByRoom) {
      try {
        entry.transport.destroy();
      } catch {}
    }
    presenceTransportsByRoom.clear();
    cursorPresenceTransportRoom = null;

    try {
      teardownDevUI();
    } catch {}

    document.head
      .querySelectorAll("link[href*='playhtml']")
      .forEach((n) => n.remove());
    document
      .querySelectorAll("#playhtml-cursor-styles")
      .forEach((n) => n.remove());

    delete (window as any).playhtml;
    delete document.documentElement.dataset.playhtml;

    hasSynced = false;
    lastElementAwarenessFingerprint = null;
    trackedElementAwarenessKeys.clear();
    firstSetup = true;
    isLoading = true;
    initStarted = false;
    readyPromise = createReadyPromise();
    __currentRoomId = "";
    __currentHost = "";
    presenceAPI = null;
    explicitRoomOption = undefined;
    cachedDefaultRoomOptions = { includeSearch: false };
    cursorOptionsCache = undefined;
    cachedOnError = undefined;
    roomResetPromise = null;
    pendingRoomResetEpoch = null;
    isDevelopmentMode = false;
    configuredOptions = null;
    hasBootstrapped = false;
  } finally {
    // firstSetup = true (set above) is the canonical "not initialized"
    // flag — runHandleNavigation checks it to skip nav after reset.
  }
}

// Expose big variables to the window object for debugging purposes.
export const playhtml: PlayHTMLComponents = {
  init: initPlayHTML,
  configure: configurePlayHTML,
  get isLoading() {
    return isLoading;
  },
  get ready() {
    return readyPromise;
  },
  handleNavigation: async function handleNavigation(): Promise<void> {
    if (!navigationController) return;
    await navigationController.trigger();
  },
  setupPlayElements: setupElements,
  setupPlayElement,
  removePlayElement,
  deleteElementData,
  setupPlayElementForTag,
  register: registerPlayElement,
  define: definePlayCapability,
  getHandle: createPlayElementHandle,
  get syncedStore() {
    return publicSyncedStore;
  },
  elementHandlers,
  eventHandlers,
  dispatchPlayEvent,
  registerPlayEventListener,
  removePlayEventListener,
  get cursorClient() {
    return cursorClient;
  },
  get presence() {
    if (!presenceAPI) {
      throw new Error("playhtml.presence is not available before init()");
    }
    return presenceAPI;
  },
  // Filled after init
  get roomId() {
    return __currentRoomId;
  },
  get host() {
    return __currentHost;
  },
  createPageData,
  createPresenceRoom,
  listSharedElements: devListSharedElements,
};

/**
 * Performs any necessary setup for a playhtml TagType. Safe to call repeatedly.
 */
function maybeSetupTag(tag: TagType | string): void {
  if (tag === PAGE_TAG) {
    throw new Error(`"${PAGE_TAG}" is a reserved tag name for page-level data`);
  }

  if (elementHandlers.has(tag)) {
    return;
  }

  if (!hasSynced) {
    return;
  }

  if (!elementHandlers.has(tag)) {
    elementHandlers.set(tag, new Map<string, ElementHandler>());
  }

  store.play[tag] ??= {};
}

/**
 * Returns true if the given element is set up properly for the given tag, false otherwise.
 * Checks both built-in and custom (DOM element) validators, preferring the custom one.
 */
function isElementValidForTag(
  element: HTMLElement,
  tag: TagType | string,
): boolean {
  const customValidator = shouldReadElementPropsForTag(tag, element)
    ? (element as any).isValidElementForTag
    : undefined;
  if (typeof customValidator === "function") {
    return customValidator(element);
  }
  return (
    capabilitiesToInitializer[tag]?.isValidElementForTag?.(element) ?? true
  );
}

function describeElementForError(element: HTMLElement): string {
  const tagName = element.tagName.toLowerCase();
  const id = element.id ? `#${element.id}` : "";
  const classes = Array.from(element.classList)
    .map((className) => `.${className}`)
    .join("");

  return `<${tagName}${id}${classes}>`;
}

function reportDuplicateElementId(
  tag: TagType | string,
  elementId: string,
  existingElement: HTMLElement,
  duplicateElement: HTMLElement,
): void {
  console.error(
    `[playhtml] Duplicate element id "${elementId}" for ${tag}. Element IDs must be unique per capability tag because playhtml stores shared data by tag and ID. Keeping ${describeElementForError(existingElement)} and ignoring ${describeElementForError(duplicateElement)}.`,
    { existingElement, duplicateElement },
  );
}

function removeDisconnectedElementHandlerForReplacement(
  tag: TagType | string,
  elementId: string,
  replacementElement: HTMLElement,
): void {
  const existingHandler = elementHandlers.get(tag)?.get(elementId);
  if (
    !existingHandler ||
    existingHandler.element === replacementElement ||
    existingHandler.element.isConnected
  ) {
    return;
  }

  removePlayElement(existingHandler.element);
}

/**
 * Sets up a playhtml element to handle the given tag's capabilities.
 */
async function setupPlayElementForTag<T extends TagType | string>(
  element: HTMLElement,
  tag: T,
): Promise<void> {
  if (VERBOSE) {
    console.log(`Setting up playhtml element for tag ${tag}`);
  }

  if (!isElementValidForTag(element, tag)) {
    return;
  }

  if (!hasSynced) {
    return;
  }

  if (!element.id) {
    // TODO: better way for unique ID here? but actually having it reversible is a nice property
    const selectorId = element.getAttribute("selector-id");
    if (selectorId) {
      const selectorIdx = selectorIdsToAvailableIdx.get(selectorId) ?? 0;

      element.id = btoa(`${tag}-${selectorId}-${selectorIdx}`);
      selectorIdsToAvailableIdx.set(selectorId, selectorIdx + 1);
    } else {
      element.id = await hashElement(tag, element);
    }
  }
  const elementId = getIdForElement(element);

  if (!elementId) {
    console.error(
      `Element ${element} does not have an acceptable ID. Please add an ID to the element to register it as a playhtml element.`,
    );
    return;
  }

  maybeSetupTag(tag);
  const tagElementHandlers = elementHandlers.get(tag)!;
  removeDisconnectedElementHandlerForReplacement(tag, elementId, element);

  const elementInitializerInfo = getElementInitializerInfoForElement(
    tag,
    element,
  );
  if (!isCorrectElementInitializer(elementInitializerInfo)) {
    const initializerIssues =
      getElementInitializerValidationIssues(elementInitializerInfo);
    console.error(
      `Element ${elementId} does not have proper info to initialize a playhtml element. Missing or invalid initializer properties: ${initializerIssues.join(", ")}. Please refer to https://github.com/spencerc99/playhtml#can-play for troubleshooting help.`,
    );
    return;
  }

  const elementData = createPlayElementData(
    element,
    tag as TagType,
    elementInitializerInfo,
    elementId,
  );
  const existingHandler = tagElementHandlers.get(elementId);
  if (existingHandler) {
    if (existingHandler.element !== element) {
      reportDuplicateElementId(
        tag,
        elementId,
        existingHandler.element,
        element,
      );
      return;
    }

    existingHandler.reinitializeElementData(elementData);
    applySharedElementDataToHandler(tag as string, elementId, existingHandler);
    // ensure observer is attached
    attachSyncedStoreObserver(tag as string, elementId);
    return;
  } else {
    const handler = new ElementHandler(elementData);
    tagElementHandlers.set(elementId, handler);
    // View handlers can emit capability descendants (mount points for
    // `define`d capabilities / `register`ed ids). Bind the current children and
    // re-bind only when the subtree's child structure changes (observer-driven,
    // so a ticking view doesn't re-scan every frame).
    if (elementInitializerInfo.view) {
      handler.onAfterRender = setupViewDescendants;
      handler.observeDescendants();
    }
    if (tag === TagType.CanMirror) {
      setupPlayElementDescendants(element);
    }
  }

  // redo this now that we have set it in the mapping.
  // TODO: this is inefficient, it tries to do this in the constructor but fails, should clean up the API
  elementData.triggerAwarenessUpdate?.();
  // Set up the common classes for affected elements.
  element.classList.add(`__playhtml-element`);
  element.style.setProperty("--jiggle-delay", `${Math.random() * 1}s;}`);

  attachSyncedStoreObserver(tag as string, elementId);
}

function applySharedElementDataToHandler(
  tag: string,
  elementId: string,
  handler: ElementHandler,
): boolean {
  const proxy = store.play[tag]?.[elementId];
  if (proxy === undefined) return false;

  // Push a plain snapshot into the handler for stable rendering.
  const applyKey = `${tag}:${elementId}`;
  // Mark as remote-apply so onChange can permit programmatic updates for RO elements.
  remoteApplyingKeys.add(applyKey);
  try {
    // @ts-ignore private usage intended
    handler.__data = clonePlain(proxy);
    if (tag === TagType.CanMirror) {
      setupPlayElementDescendants(handler.element);
    }
  } finally {
    remoteApplyingKeys.delete(applyKey);
  }
  return true;
}

function attachSyncedStoreObserver(tag: string, elementId: string) {
  const key = `${tag}:${elementId}`;
  const tagHandlers = elementHandlers.get(tag);
  if (!tagHandlers) return;
  const handler = tagHandlers.get(elementId);
  if (!handler) return;

  // Detach previous observer if present
  const yVal = getYjsValue(store.play[tag]?.[elementId]);
  if (!yVal || typeof (yVal as any).observeDeep !== "function") return;
  const existing = yObserverByKey.get(key);
  if (existing) {
    // @ts-ignore
    (yVal as any).unobserveDeep(existing);
  }
  let scheduled = false;
  const observer = () => {
    if (scheduled) return;
    scheduled = true;
    queueMicrotask(() => {
      scheduled = false;
      if (!applySharedElementDataToHandler(tag, elementId, handler)) return;
      // Mark that this shared reference has received data
      sharedUpdateSeen.add(key);
      // Debug: log updates for shared elements
      if (VERBOSE) {
        console.log(
          `[PLAYHTML] updated shared element ${tag}:${elementId} via SyncedStore observer`,
        );
      }
    });
  };
  // @ts-ignore
  (yVal as any).observeDeep(observer);
  yObserverByKey.set(key, observer);

  if (isDevelopmentMode) {
    // Dev hydration warning for shared references
    const el = handler.element;
    if (el && el.hasAttribute && el.hasAttribute("data-source")) {
      if (!sharedHydrationTimers.has(key)) {
        const timeoutId = window.setTimeout(() => {
          if (!sharedUpdateSeen.has(key)) {
            console.warn(
              `[playhtml] Shared reference ${tag}:${elementId} has not received data. Check data-source and source availability.`,
            );
          }
          sharedHydrationTimers.delete(key);
        }, 3000);
        sharedHydrationTimers.set(key, timeoutId);
      }
    }
  }
}

// TODO: make async and run it after synced
function setupPlayElement(
  element: Element,
  { ignoreIfAlreadySetup }: { ignoreIfAlreadySetup?: boolean } = {},
) {
  // Prevent invalid configuration: element cannot be both a source and a consumer
  if (
    (element as HTMLElement).hasAttribute?.("data-source") &&
    (element as HTMLElement).hasAttribute?.("shared")
  ) {
    const id = (element as HTMLElement).id || "<no-id>";
    console.error(
      `[playhtml] Element ${id} has both 'data-source' and 'shared'. Ignoring. A single element cannot be both a consumer and a source.`,
    );
    return;
  }
  if (
    ignoreIfAlreadySetup &&
    Array.from(elementHandlers.values()).some((handlers) =>
      handlers.has(element.id),
    )
  ) {
    return;
  }

  if (!isHTMLElement(element)) {
    console.log(`Element ${element.id} not an HTML element. Ignoring.`);
    return;
  }

  // If this element was registered via register() before it existed, stamp its
  // initializer on now so the can-play branch below picks it up.
  if (element.id && pendingRegistrations.has(element.id)) {
    stampRegistrationOntoElement(element, pendingRegistrations.get(element.id)!);
  }

  // Check for data-source attribute and handle dynamic discovery
  if (element.hasAttribute("data-source")) {
    handleNewSharedReference(element);
  }

  // Check for shared attribute and register as shared element
  if (element.hasAttribute("shared")) {
    handleNewSharedElement(element);
  }

  // Handle loading state for dynamically added elements
  const hasPlayhtmlAttributes = getTagTypes().some((tag) =>
    element.hasAttribute(tag),
  );

  if (hasPlayhtmlAttributes) {
    if (hasSynced) {
      // If already synced, element will be ready immediately
      markElementAsReady(element);
    } else {
      // If not synced yet, element should start loading
      markElementAsLoading(element);
    }
  }

  void Promise.all(
    getTagTypes()
      .filter((tag) => element.hasAttribute(tag))
      .map((tag) => setupPlayElementForTag(element, tag)),
  );
}

function setupPlayElementDescendants(element: HTMLElement): void {
  const descendants = new Set<HTMLElement>();
  const currentDescendants = new Map<string, HTMLElement>();
  for (const tag of getTagTypes()) {
    element.querySelectorAll(`[${tag}]`).forEach((descendant) => {
      if (isHTMLElement(descendant)) {
        descendants.add(descendant);
        const descendantId = getIdForElement(descendant);
        if (descendantId) {
          currentDescendants.set(`${tag}:${descendantId}`, descendant);
        }
      }
    });
  }

  const previousDescendants = mirrorDescendantElementsByRoot.get(element);
  previousDescendants?.forEach((previousElement, key) => {
    if (currentDescendants.get(key) !== previousElement) {
      removePlayElement(previousElement);
    }
  });

  descendants.forEach((descendant) => {
    setupPlayElement(descendant);
  });
  mirrorDescendantElementsByRoot.set(element, currentDescendants);
}

/**
 * Removes the element handler for a DOM element from local state.
 * This unregisters the element but preserves all shared collaborative data.
 * Use this when a DOM element is removed/unmounted but you want to keep the data.
 *
 * @param element - The DOM element to unregister
 */
function removePlayElement(element: Element | null) {
  if (!element || !element.id) {
    return;
  }

  const elementId = getIdForElement(element as HTMLElement);
  if (!elementId) {
    return;
  }

  for (const [tag, tagElementHandler] of elementHandlers) {
    const handler = tagElementHandler.get(elementId);
    if (!handler || handler.element !== element) {
      continue;
    }

    const key = `${tag}:${elementId}`;
    const yVal = getYjsValue(store.play[tag]?.[elementId]);
    const observer = yObserverByKey.get(key);
    if (
      yVal &&
      observer &&
      typeof (yVal as any).unobserveDeep === "function"
    ) {
      // @ts-ignore
      (yVal as any).unobserveDeep(observer);
    }
    yObserverByKey.delete(key);
    sharedUpdateSeen.delete(key);
    const timerId = sharedHydrationTimers.get(key);
    if (timerId !== undefined) {
      clearTimeout(timerId);
      sharedHydrationTimers.delete(key);
    }
    // Run onMount cleanup (rAF loops, timers, event listeners) and disconnect
    // the descendant observer so view elements don't leak after removal.
    handler.destroy?.();
    elementAwarenessClient?.removeLocalAwareness(tag, elementId);
    tagElementHandler.delete(elementId);
  }
}

// ───────────────────────────────────────────────────────────────────────────
// Programmatic registration (`register` / `define`) + `view`
// ───────────────────────────────────────────────────────────────────────────

/**
 * Handle returned by `playhtml.register`, and by `playhtml.getHandle` for any
 * bound element. Reads/writes resolve the live handler lazily, so a handle
 * obtained before the element binds still works once it does.
 *
 * @experimental Part of the new view API; subject to change in a future minor.
 */
export interface PlayElementHandle<T = any, U = any, V = any> {
  id: string;
  /** The bound DOM element, or null until it exists and binds. */
  getElement(): HTMLElement | null;
  /** Current shared data. Do not mutate it directly — mutations are not synced and may corrupt state; write via setData. */
  getData(): T | undefined;
  setData(next: T | ((draft: T) => void)): void;
  setLocalData(next: U | ((draft: U) => void)): void;
  setMyAwareness(next: V): void;
  /** Re-run the view now (for clock-driven views). No-op without a view. */
  requestUpdate(): void;
  /** Detach the handler (shared data is preserved) and drop the registration. */
  unregister(): void;
}

// elementId -> initializer, pending until both the definition and the DOM
// element exist (upgrade semantics, like customElements.define).
const pendingRegistrations = new Map<string, ElementInitializer>();

/**
 * Enforces initializer invariants before register/define stores a capability.
 */
function validateRegisteredInitializer(
  name: string,
  init: ElementInitializer,
): void {
  if (init.view && init.updateElement) {
    throw new Error(
      `[playhtml] "${name}" defines both \`view\` and \`updateElement\`. They are mutually exclusive — pick one.`,
    );
  }
  if (init.view && (init.onClick || init.onDrag || init.onDragStart)) {
    throw new Error(
      `[playhtml] "${name}" defines \`view\` alongside an element event handler (onClick/onDrag/onDragStart). ` +
        `In view mode, attach events inside the template (e.g. \`@click=\${...}\`) instead.`,
    );
  }
  // Shared data must be an object (or a factory returning one), never a bare
  // primitive. An object shape stays robust as the data evolves — you can add
  // fields without a migration, where `defaultData: 0` can't grow.
  if (
    init.defaultData !== undefined &&
    typeof init.defaultData !== "function" &&
    (typeof init.defaultData !== "object" || init.defaultData === null)
  ) {
    throw new Error(
      `[playhtml] "${name}" has a non-object \`defaultData\`. Use an object ` +
        `(e.g. \`{ count: 0 }\`) so the shape can grow without a data migration.`,
    );
  }
  const issues = getElementInitializerValidationIssues(init);
  if (issues.length > 0) {
    throw new Error(
      `[playhtml] "${name}" has an invalid initializer: ${issues.join(", ")}.`,
    );
  }
}

/** Stamps a registration's initializer fields onto its element as props. */
function stampRegistrationOntoElement(
  element: HTMLElement,
  init: ElementInitializer,
): void {
  Object.assign(element, init);
  if (!element.hasAttribute(TagType.CanPlay)) {
    element.setAttribute(TagType.CanPlay, "");
  }
}

/** Applies a pending registration if its element exists and we've synced. */
function applyPendingRegistration(elementId: string): void {
  if (!hasSynced) return;
  const init = pendingRegistrations.get(elementId);
  if (!init) return;
  const element = document.getElementById(elementId);
  if (!element || !isHTMLElement(element)) return;
  stampRegistrationOntoElement(element, init);
  void setupPlayElementForTag(element, TagType.CanPlay);
}

/**
 * Finds the live handler for an element id. An element can carry several
 * capabilities at once, all sharing one id, so pass the capability tag (e.g.
 * "can-toggle") to disambiguate. Without a tag, prefers the can-play handler
 * and otherwise returns the first match.
 */
function findHandlerForElementId(
  elementId: string,
  tag?: string,
): ElementHandler | undefined {
  if (tag !== undefined) {
    return elementHandlers.get(tag)?.get(elementId);
  }
  const canPlay = elementHandlers.get(TagType.CanPlay)?.get(elementId);
  if (canPlay) return canPlay;
  for (const [, map] of elementHandlers) {
    const handler = map.get(elementId);
    if (handler) return handler;
  }
  return undefined;
}

/**
 * Emits a development-only warning when a handle write lands on an element
 * that has not bound yet (wrong id, or the element does not exist). Writes are
 * dropped silently otherwise; reads stay quiet.
 */
function warnUnboundHandleWrite(method: string, elementId: string): void {
  if (!isDevelopmentMode) return;
  console.warn(
    `[playhtml] ${method}("${elementId}") — no bound element with that id yet; the write was dropped. ` +
      `Register/add the element first, or check the id.`,
  );
}

function createPlayElementHandle(
  elementId: string,
  tag?: string,
): PlayElementHandle {
  return {
    id: elementId,
    getElement: () => document.getElementById(elementId),
    getData: () => findHandlerForElementId(elementId, tag)?.data,
    setData: (next) => {
      const handler = findHandlerForElementId(elementId, tag);
      if (!handler) return warnUnboundHandleWrite("setData", elementId);
      handler.setData(next);
    },
    setLocalData: (next) => {
      const handler = findHandlerForElementId(elementId, tag);
      if (!handler) return warnUnboundHandleWrite("setLocalData", elementId);
      handler.setLocalData(next);
    },
    setMyAwareness: (next) => {
      const handler = findHandlerForElementId(elementId, tag);
      if (!handler) return warnUnboundHandleWrite("setMyAwareness", elementId);
      handler.setMyAwareness(next);
    },
    requestUpdate: () => {
      const handler = findHandlerForElementId(elementId, tag);
      if (!handler) return warnUnboundHandleWrite("requestUpdate", elementId);
      handler.requestUpdate();
    },
    unregister: () => {
      pendingRegistrations.delete(elementId);
      const el = document.getElementById(elementId);
      if (el) removePlayElement(el);
    },
  };
}

/**
 * Registers a `view`/`updateElement` initializer for a single element by id.
 * Callable before or after `init()` and before or after the element exists;
 * binding happens once both are present. Returns a handle for reads/writes
 * from outside the view (e.g. form submit handlers).
 *
 * @experimental New view API; signature may change in a future minor release.
 */
function registerPlayElement<T = any, U = any, V = any>(
  elementId: string,
  init: ElementInitializer<T, U, V>,
): PlayElementHandle<T, U, V> {
  validateRegisteredInitializer(elementId, init as ElementInitializer);
  pendingRegistrations.set(elementId, init as ElementInitializer);
  applyPendingRegistration(elementId);
  if (isDevelopmentMode && hasSynced && !document.getElementById(elementId)) {
    console.warn(
      `[playhtml] register("${elementId}") — no element with that id is in the DOM yet. ` +
        `It will bind automatically when the element appears.`,
    );
  }
  // register always binds via can-play, so scope the handle to that tag.
  return createPlayElementHandle(
    elementId,
    TagType.CanPlay,
  ) as PlayElementHandle<T, U, V>;
}

/**
 * Registers a reusable capability under an attribute name (e.g. "can-note").
 * Every element carrying that attribute gets the capability — including ones
 * added to the DOM later. The imperative counterpart of
 * `init({ extraCapabilities })`.
 *
 * @param capabilityName - The attribute name elements use to opt in (used in an
 *   attribute selector, e.g. `[can-note]`).
 * @experimental New view API; signature may change in a future minor release.
 */
function definePlayCapability<T = any, U = any, V = any>(
  capabilityName: string,
  init: ElementInitializer<T, U, V>,
): void {
  if (capabilityName === PAGE_TAG) {
    throw new Error(`"${PAGE_TAG}" is a reserved tag name for page-level data`);
  }
  if (capabilityName === TagType.CanPlay) {
    throw new Error(
      `[playhtml] "${TagType.CanPlay}" is reserved — use register(id, init) for single elements.`,
    );
  }
  if (Object.prototype.hasOwnProperty.call(TagTypeToElement, capabilityName)) {
    throw new Error(
      `[playhtml] "${capabilityName}" is a built-in capability and cannot be redefined.`,
    );
  }
  validateRegisteredInitializer(capabilityName, init as ElementInitializer);
  capabilitiesToInitializer[capabilityName] = init as ElementInitializer;
  // Upgrade any elements already on the page (no-op before init()).
  if (hasSynced) {
    const els = Array.from(
      document.querySelectorAll(`[${capabilityName}]`),
    ).filter(isHTMLElement);
    void Promise.all(
      els.map((el) => setupPlayElementForTag(el, capabilityName)),
    );
  }
}

/**
 * After a view renders, reconcile the capability descendants it produced —
 * mount points for `define`d capabilities or `register`ed ids. This is what
 * makes data-driven lists of collaborative children (e.g. a chat list
 * rendering `<div can-chat>` per room) work. Driven by a MutationObserver on
 * the view root (see ElementHandler.observeDescendants), so it runs when the
 * child structure changes — not on every render.
 *
 * Reconciliation, not just binding: newly-present descendants are bound, and
 * descendants this root previously bound that are now gone (a keyed list item
 * was removed) are torn down via removePlayElement — which runs their onMount
 * cleanup and disconnects their observers, so churning lists don't leak
 * handlers pointing at detached DOM. Shared data is preserved.
 */
const viewDescendants = new WeakMap<HTMLElement, Map<string, HTMLElement>>();

function setupViewDescendants(root: HTMLElement): void {
  // Stamp pending single-element registrations onto matching descendants.
  for (const [id, init] of pendingRegistrations) {
    if (id === root.id) continue;
    const el = document.getElementById(id);
    if (el && root.contains(el) && isHTMLElement(el)) {
      stampRegistrationOntoElement(el, init);
    }
  }
  // Capability descendants present in this render, keyed by `tag:id`. The scan
  // is subtree-wide, so each view-root tracks its full descendant set
  // (including nested ones) — teardown below covers every depth.
  const present = new Map<string, HTMLElement>();
  for (const tag of getTagTypes()) {
    const els = Array.from(root.querySelectorAll(`[${tag}]`)).filter(
      isHTMLElement,
    );
    for (const el of els) {
      if (el === root) continue;
      if (!el.id) {
        if (isDevelopmentMode) {
          console.warn(
            `[playhtml] a view rendered a "${tag}" element with no id; it won't bind. ` +
              `Give capability children a stable, unique id (key keyed lists by it).`,
          );
        }
        continue;
      }
      present.set(`${tag}:${el.id}`, el);
      const existing = elementHandlers.get(tag)?.get(el.id);
      if (existing) {
        if (existing.element === el) continue; // already bound to this node
      }
      void setupPlayElementForTag(el, tag);
    }
  }
  // Tear down descendants this root bound previously that are gone now.
  const previous = viewDescendants.get(root);
  if (previous) {
    for (const [key, el] of previous) {
      if (!present.has(key)) {
        // removePlayElement runs the handler's destroy() (onMount cleanup +
        // observer disconnect) and preserves the shared data.
        removePlayElement(el);
      }
    }
  }
  viewDescendants.set(root, present);
}


/**
 * Completely deletes all shared collaborative data for an element.
 * This is a destructive operation that removes data across all clients.
 * This includes:
 * - SyncedStore data (store.play[tag][elementId])
 * - Observer subscriptions
 * - Element handlers
 *
 * Use this when you want to permanently delete an element's data.
 * For just removing a DOM element while keeping data, use removePlayElement instead.
 *
 * @param tag - The capability tag (e.g., "can-move", "can-toggle")
 * @param elementId - The element ID
 */
function deleteElementData(tag: string, elementId: string): void {
  if (!hasSynced) {
    console.warn(
      `[PLAYHTML] Cannot remove element data before sync: ${tag}:${elementId}`,
    );
    return;
  }

  const key = `${tag}:${elementId}`;

  // 1. Remove observer
  const yVal = getYjsValue(store.play[tag]?.[elementId]);
  if (yVal && typeof (yVal as any).observeDeep === "function") {
    const observer = yObserverByKey.get(key);
    if (observer) {
      try {
        // @ts-ignore
        (yVal as any).unobserveDeep(observer);
      } catch (error) {
        console.warn(`[PLAYHTML] Failed to remove observer for ${key}:`, error);
      }
      yObserverByKey.delete(key);
    }
  }

  // 2. Remove from SyncedStore
  const tagRecord = store.play[tag];
  if (tagRecord && elementId in tagRecord) {
    try {
      doc.transact(() => {
        delete tagRecord[elementId];
      });
    } catch (error) {
      console.warn(
        `[PLAYHTML] Failed to remove SyncedStore data for ${key}:`,
        error,
      );
    }
  }

  // 3. Remove from proxy cache
  const tagMap = proxyByTagAndId.get(tag);
  if (tagMap) {
    tagMap.delete(elementId);
    if (tagMap.size === 0) {
      proxyByTagAndId.delete(tag);
    }
  }

  // 4. Remove element handler
  const tagElementHandlers = elementHandlers.get(tag);
  if (tagElementHandlers) {
    tagElementHandlers.delete(elementId);
  }

  // 6. Clean up shared reference tracking
  sharedUpdateSeen.delete(key);
  const timerId = sharedHydrationTimers.get(key);
  if (timerId !== undefined) {
    clearTimeout(timerId);
    sharedHydrationTimers.delete(key);
  }
}

function dispatchPlayEvent(message: EventMessage) {
  const { type } = message;
  if (!eventHandlers.has(type)) {
    console.error(`[playhtml] event "${type}" not registered.`);
    return;
  }

  sendPlayEvent(message);
}

/**
 * Registers the given event listener.
 * Returns a unique ID corresponding to the listener.
 */
// TODO: allow duplicates or not..
// duplicates are good for registering a lot of logic.. but why wouldn't you just put it all in one call?
// duplicates bad when you want to handle deduping the same logic, so this would be useful to expose one helper function in the react context
// to register a listener for a type and provide a callback and it returns you a function that triggers that event.
function registerPlayEventListener(
  type: string,
  event: Omit<PlayEvent, "type">,
): string {
  const id = String(eventCount++);

  eventHandlers.set(type, [
    ...(eventHandlers.get(type) ?? []),
    { type, ...event, id },
  ]);

  // NOTE: bring this back if desired to automatically listen to native DOM events of the same type
  // document.addEventListener(type, (evt) => {
  //   const payload: EventMessage = {
  //     type,
  //     // @ts-ignore
  //     eventPayload: evt.detail,
  //     // @ts-ignore
  //     // element: evt.target,
  //   };
  //   sendPlayEvent(payload);
  // });
  return id;
}

/**
 * Removes the event listener with the given type and id.
 */
function removePlayEventListener(type: string, id: string) {
  const handlers = eventHandlers.get(type);
  if (!handlers) {
    return;
  }

  const index = handlers.findIndex((handler) => handler.id === id);
  if (index === -1) {
    return;
  }

  handlers.splice(index, 1);
  if (handlers.length === 0) {
    eventHandlers.delete(type);
  }
}

export {
  TagType,
  TagTypeToElement,
  getIdForElement,
  CanDuplicateTo,
  CanMoveBounds,
  CanMoveBoundsMinVisible,
  CanMoveBoundsMinVisiblePx,
} from "@playhtml/common";

export type {
  ElementAwarenessEventHandlerData,
  ElementInitializer,
  PageDataChannel,
  PlayerIdentity,
  Cursor,
  CursorPresence,
  CursorEvents,
  CursorPresenceView,
  PresenceRoom,
  PresenceView,
} from "@playhtml/common";

// Re-export a curated subset of lit-html for `view` authoring, so
// script-tag and module users can `import { html, repeat } from "playhtml"`.
// Intentionally NO `unsafeHTML` — auto-escaping of interpolated values is a
// core safety property of the view API.
export { html, svg, nothing } from "lit-html";
export { repeat } from "lit-html/directives/repeat.js";
export { classMap } from "lit-html/directives/class-map.js";
export { styleMap } from "lit-html/directives/style-map.js";
