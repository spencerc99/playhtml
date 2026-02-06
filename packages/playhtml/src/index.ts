/// <reference lib="dom"/>
/// <reference types="vite/client" />
import YPartyKitProvider from "y-partykit/provider";
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
  PlayHTMLIdentity,
  ValidatedSession,
} from "@playhtml/common";
import * as Y from "yjs";
import { syncedStore, getYjsDoc, getYjsValue } from "@syncedstore/core";
import { ElementHandler } from "./elements";
import { hashElement } from "./utils";
import { CursorClientAwareness } from "./cursors/cursor-client";
import {
  initializeAuth,
  onAuthReady,
  getCurrentIdentity,
  checkPermission,
  createNewIdentity,
  configureGlobalPermissions,
  initializeSessionAuth,
  getCurrentSession,
  createSessionAction,
  establishSessionWithWS,
  getUserRolesForElement,
  getMyRoles,
} from "./auth";
import type { RoleDefinition } from "./auth";
import { setupDevUI } from "./development";
import {
  findSharedElementsOnPage,
  findSharedReferencesOnPage,
  isSharedReadOnly,
} from "./sharing";
import { parseDataSource } from "@playhtml/common";

const DefaultPartykitHost = "playhtml.spencerc99.partykit.dev";
const StagingPartykitHost = "staging.playhtml.spencerc99.partykit.dev";
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
  play: Record<string, Record<string, any>>; // tag -> elementId -> data proxy
};
const store = syncedStore<StoreShape>({ play: {} });
const doc = getYjsDoc(store);

// MIGRATION: Flags and infrastructure for transitioning to SyncedStore-only
const MIGRATION_FLAGS = {
  // TESTING: Re-enabled for production data volume testing
  enableMigration: true,
  // Log migration progress - ENABLED for testing
  logMigration: false,
};

function migrateTagFromYMapToSyncedStore(tag: string): void {
  if (!MIGRATION_FLAGS.enableMigration) return;

  const startTime = performance.now();
  console.debug(`[MIGRATION] Starting migration for tag: ${tag}`);

  const tagMap = globalData.get(tag);
  if (!tagMap) {
    console.debug(`[MIGRATION] No data found for tag: ${tag}`);
    return;
  }

  // Log the size of data we're about to migrate
  let mapSize = 0;
  try {
    tagMap.forEach(() => mapSize++);
    console.debug(`[MIGRATION] Found ${mapSize} entries for tag: ${tag}`);
  } catch (error) {
    console.error(
      `[MIGRATION ERROR] Failed to count entries for tag ${tag}:`,
      error
    );
    return;
  }

  // Ensure tag exists in SyncedStore
  store.play[tag] ??= {};

  let migratedCount = 0;
  let errorCount = 0;

  try {
    // Batch all migration operations in a single transaction to prevent excessive broadcasts
    doc.transact(() => {
      tagMap.forEach((elementData: any, elementId: string) => {
        try {
          // Log memory usage for large objects
          const dataSize = JSON.stringify(elementData).length;
          if (dataSize > 10000) {
            console.debug(
              `[MIGRATION] Large data entry: ${tag}:${elementId} (${dataSize} chars)`
            );
          }

          const clonedData = clonePlain(elementData);
          store.play[tag]![elementId] = clonedData;
          migratedCount++;

          // Log progress every 1000 items for large datasets
          if (migratedCount % 1000 === 0) {
            console.debug(
              `[MIGRATION] Progress: ${migratedCount}/${mapSize} migrated for ${tag}`
            );
          }
        } catch (error) {
          errorCount++;
          console.error(
            `[MIGRATION ERROR] Failed to migrate ${tag}:${elementId}:`,
            error
          );
        }
      });
    });
  } catch (error) {
    console.error(`[MIGRATION FATAL] forEach failed for tag ${tag}:`, error);
    return;
  }

  const endTime = performance.now();
  const duration = endTime - startTime;

  if (MIGRATION_FLAGS.logMigration) {
    console.debug(
      `[MIGRATION] Completed ${tag}: ${migratedCount} migrated, ${errorCount} errors, ${duration.toFixed(
        2
      )}ms`
    );
  }
}

function migrateAllDataFromYMapToSyncedStore(): void {
  if (!MIGRATION_FLAGS.enableMigration) return;

  // Check if migration has already been completed
  const migrationComplete = globalData.get("__migration_complete__");
  if (migrationComplete) {
    console.debug("[MIGRATION] Migration already completed, skipping");
    return;
  }

  console.debug("[MIGRATION] Starting migration from Y.Map to SyncedStore");

  // Migrate all tags (excluding our migration flag)
  globalData.forEach((_, tag) => {
    if (tag !== "__migration_complete__") {
      migrateTagFromYMapToSyncedStore(tag);
    }
  });

  // Mark migration as complete so other clients don't run it
  globalData.set("__migration_complete__", true);

  console.debug(
    "[MIGRATION] Migration completed. SyncedStore state:",
    clonePlain(store.play)
  );
}

function getDefaultRoom(includeSearch?: boolean): string {
  // TODO: Strip filename extension
  const transformedPathname = window.location.pathname.replace(/\.[^/.]+$/, "");

  return includeSearch
    ? transformedPathname + window.location.search
    : transformedPathname;
}

let yprovider: YPartyKitProvider;
let cursorClient: CursorClientAwareness | null = null;
// @ts-ignore, will be removed
let globalData: Y.Map<any> = doc.getMap<Y.Map<any>>("playhtml-global");
// Internal map for quick access to proxies
const proxyByTagAndId = new Map<string, Map<string, any>>();
const yObserverByKey = new Map<string, (events: any[]) => void>();
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
  if (yprovider?.ws && yprovider.ws.readyState === WebSocket.OPEN) {
    try {
      const newReference = { domain, path, elementId };
      // Send individual reference update
      yprovider.ws.send(
        JSON.stringify({
          type: "add-shared-reference",
          reference: newReference,
        })
      );

      // Request permissions for this specific element
      yprovider.ws.send(
        JSON.stringify({
          type: "export-permissions",
          elementIds: [elementId],
        })
      );
    } catch (error) {
      console.warn(
        "[PLAYHTML] Failed to notify server of new shared reference:",
        error
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
  if (yprovider?.ws && yprovider.ws.readyState === WebSocket.OPEN) {
    try {
      // Register this element as shared with the server
      const sharedElement = {
        elementId,
        permissions: permissionMode,
        path: window.location.pathname,
      };

      yprovider.ws.send(
        JSON.stringify({
          type: "register-shared-element",
          element: sharedElement,
        })
      );
    } catch (error) {
      console.warn(
        "[PLAYHTML] Failed to notify server of new shared element:",
        error
      );
    }
  }
}

function ensureElementProxy<T = any>(
  tag: string,
  elementId: string,
  defaultData: T
) {
  if (!proxyByTagAndId.has(tag)) proxyByTagAndId.set(tag, new Map());
  const tagMap = proxyByTagAndId.get(tag)!;
  if (!tagMap.has(elementId)) {
    store.play[tag] ??= {};
    if (store.play[tag][elementId] === undefined) {
      // Always clone to avoid reusing the same object reference across multiple elements,
      // which SyncedStore forbids ("reassigning object that already occurs in the tree").
      const initial = clonePlain(defaultData) as any;
      store.play[tag][elementId] = initial;
    }
    tagMap.set(elementId, store.play[tag][elementId]);
  }
  return tagMap.get(elementId)!;
}
let elementHandlers: Map<string, Map<string, ElementHandler>> = new Map<
  string,
  Map<string, ElementHandler>
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
export interface CursorOptions {
  enabled?: boolean;
  playerIdentity?: any;
  proximityThreshold?: number;
  visibilityThreshold?: number;
  cursorStyle?: string;
  onProximityEntered?: (
    playerIdentity?: any,
    positions?: {
      ours: { x: number; y: number };
      theirs: { x: number; y: number };
    },
    angle?: number
  ) => void;
  onProximityLeft?: (connectionId: string) => void;
  onCustomCursorRender?: (
    connectionId: string,
    element: HTMLElement
  ) => HTMLElement | null;
  enableChat?: boolean;
}

export interface InitOptions<T = any> {
  /**
   * The room to connect users to (this should be a string that matches the other users
   * that you want a given user to connect with).
   *
   * All rooms are automatically prefixed with their host (`window.location.hostname`) to prevent
   * conflicting with other people's sites.
   * Defaults to `window.location.pathname + window.location.search. You can customize this by
   * passing in your own room dynamically
   */
  room?: string;

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
  defaultRoomOptions?: {
    /**
     * defaults to false
     */
    includeSearch?: boolean;
  };
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

  /**
   * Define global roles for the entire site. Maps role names to either:
   * - An array of public keys (explicit membership)
   * - A PermissionFunction (inline condition, evaluated at check time)
   *
   * Example:
   *   roles: {
   *     owner: ["<public-key>"],
   *     contributors: async (ctx) => ctx.customData.visitCount >= 5,
   *   }
   */
  roles?: Record<string, RoleDefinition>;
}

let capabilitiesToInitializer: Record<TagType | string, ElementInitializer> =
  TagTypeToElement;

function getTagTypes(): (TagType | string)[] {
  return [TagType.CanPlay, ...Object.keys(capabilitiesToInitializer)];
}

function sendPlayEvent(eventMessage: EventMessage) {
  if (!yprovider.ws) {
    return;
  }
  yprovider.ws.send(JSON.stringify(eventMessage));
}

function onMessage(evt: MessageEvent) {
  // ignore non-relevant events
  if (evt.data instanceof Blob) {
    return;
  }

  let message: any;
  try {
    message = JSON.parse(evt.data);
  } catch (err) {
    return;
  }

  console.log(
    `[PLAYHTML] Received WebSocket message:`,
    message.type || "unknown-type"
  );

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
              `[data-source$="#${CSS.escape(elementId)}"]`
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
let isDevelopmentMode = false;
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

async function initPlayHTML({
  // TODO: if it is a localhost url, need to make some deterministic way to connect to the same room.
  host,
  extraCapabilities,
  events,
  defaultRoomOptions = {},
  room: inputRoom = getDefaultRoom(defaultRoomOptions.includeSearch),
  onError,
  developmentMode = false,
  cursors = {},
  roles = {},
}: InitOptions = {}) {
  if (!firstSetup || "playhtml" in window) {
    console.error("playhtml already set up! ignoring");
    return;
  }
  isDevelopmentMode = developmentMode;
  // @ts-ignore
  window.playhtml = playhtml;

  // Configure global permissions if provided
  if (Object.keys(roles).length > 0) {
    configureGlobalPermissions(roles);
  }

  // TODO: change to md5 hash if room ID length becomes problem / if some other analytic for telling who is connecting
  const room = encodeURIComponent(window.location.host + "-" + inputRoom);

  const partykitHost = getPartykitHost(host);

  console.log(
    `࿂࿂࿂࿂࿂࿂࿂࿂࿂࿂࿂࿂࿂࿂࿂࿂࿂࿂࿂࿂࿂࿂࿂࿂࿂࿂࿂࿂࿂࿂࿂࿂࿂࿂࿂࿂࿂࿂
࿂࿂࿂࿂  ࿂    ࿂    ࿂    ࿂    ࿂  ࿂࿂࿂࿂
࿂࿂࿂࿂ booting up playhtml... ࿂࿂࿂࿂
࿂࿂࿂࿂  https://playhtml.fun  ࿂࿂࿂࿂
࿂࿂࿂࿂   ࿂     ࿂     ࿂     ࿂   ࿂࿂࿂࿂
࿂࿂࿂࿂࿂࿂࿂࿂࿂࿂࿂࿂࿂࿂࿂࿂࿂࿂࿂࿂࿂࿂࿂࿂࿂࿂࿂࿂࿂࿂࿂࿂࿂࿂࿂࿂࿂࿂`
  );

  // Discover shared elements and references on the page
  const sharedElements = findSharedElementsOnPage();
  const sharedReferences = findSharedReferencesOnPage();
  // Map elementId -> permission for quick client-side checks (filled after initial sync)
  initializeSharedPermissions();

  // Initialize tracking of discovered shared references
  sharedReferences.forEach((ref) => {
    const referenceKey = `${ref.domain}${ref.path}#${ref.elementId}`;
    discoveredSharedReferences.add(referenceKey);
  });

  if (sharedElements.length > 0) {
    console.log(
      `[PLAYHTML] Found ${sharedElements.length} shared elements:`,
      sharedElements
    );
  }

  if (sharedReferences.length > 0) {
    console.log(
      `[PLAYHTML] Found ${sharedReferences.length} shared references:`,
      sharedReferences
    );
  }

  // Create provider with shared element parameters
  yprovider = new YPartyKitProvider(partykitHost, room, doc, {
    params: {
      sharedElements: JSON.stringify(sharedElements),
      sharedReferences: JSON.stringify(sharedReferences),
    },
  });
  yprovider.on("error", () => {
    onError?.();
  });

  // Initialize cursor tracking immediately after provider creation
  if (cursors.enabled) {
    // Generate player identity if not provided
    const cursorOptions = {
      ...cursors,
    };
    if (!cursorOptions.playerIdentity) {
      cursorOptions.playerIdentity = generatePersistentPlayerIdentity();
    }

    cursorClient = new CursorClientAwareness(yprovider, cursorOptions);
  }

  if (extraCapabilities) {
    for (const [tag, tagInfo] of Object.entries(extraCapabilities)) {
      capabilitiesToInitializer[tag] = tagInfo;
    }
  }

  if (events) {
    for (const [eventType, event] of Object.entries(events)) {
      registerPlayEventListener(eventType, event);
    }
  }
  // Import default styles
  const playStyles = document.createElement("link");
  playStyles.rel = "stylesheet";
  playStyles.href = "https://unpkg.com/playhtml@latest/dist/style.css";
  document.head.appendChild(playStyles);

  if (developmentMode) {
    setupDevUI(playhtml);
  }

  // Mark all discovered playhtml elements as loading before sync
  markAllElementsAsLoading();

  // await until yprovider is synced
  await new Promise((resolve) => {
    if (hasSynced) {
      resolve(true);
    }
    yprovider.on("sync", (connected: boolean) => {
      if (!connected) {
        console.error("Issue connecting to yjs...");
      } else if (connected) {
        yprovider.ws!.addEventListener("message", onMessage);
      }
      if (hasSynced) {
        return;
      }
      hasSynced = true;
      console.log("[PLAYHTML]: Setting up elements... Time to have some fun 🛝");

      migrateAllDataFromYMapToSyncedStore();

      // Initialize authentication system
      initializeAuth()
        .then(async (auth) => {
          if (auth.isAuthenticated) {
            console.log(
              "[PLAYHTML AUTH]: Authenticated as",
              auth.identity?.displayName ||
                auth.identity?.publicKey?.slice(0, 8) + "..."
            );

            // Initialize session-based authentication
            try {
              await initializeSessionAuth(yprovider.ws!);
              console.log(
                "[PLAYHTML SESSION]: Session authentication initialized"
              );
            } catch (error) {
              console.warn(
                "[PLAYHTML SESSION]: Failed to establish session:",
                error
              );
            }

            // Auto-register owned elements with authentication server
            await autoRegisterAuthenticatedElements(auth.identity!);
          } else {
            console.log("[PLAYHTML AUTH]: Running in read-only mode");
          }
        })
        .catch((error) => {
          console.error("[PLAYHTML AUTH]: Failed to initialize auth:", error);
        });

      setupElements();

      // Mark all elements as ready after sync completes and elements are set up
      markAllElementsAsReady();

      // Fetch simple permissions for referenced shared elements so clients can block writes locally
      if (sharedReferences.length > 0) {
        try {
          const elementIds = sharedReferences.map((r) => r.elementId);
          yprovider.ws?.send(
            JSON.stringify({ type: "export-permissions", elementIds })
          );
        } catch {}
      }

      resolve(true);
    });
  });

  return yprovider;
}

// Auto-register elements with authentication attributes
async function autoRegisterAuthenticatedElements(
  identity: PlayHTMLIdentity
): Promise<void> {
  // Check if user has global ownership/admin roles
  const userRoles = await getUserRolesForElement("", identity); // Empty elementId for global check
  const hasGlobalAccess = userRoles.includes("owner") || userRoles.includes("admin");

  if (hasGlobalAccess) {
    console.log(
      `[PLAYHTML AUTH]: User has global ${userRoles.includes("owner") ? "owner" : "admin"} access`
    );
  }

  // Find all elements with specific permissions configured
  const elementsWithPermissions = document.querySelectorAll("[playhtml-permissions]");
  
  if (elementsWithPermissions.length > 0) {
    console.log(
      `[PLAYHTML AUTH]: Found ${elementsWithPermissions.length} elements with specific permissions`
    );

    // Log elements with permissions for debugging
    for (const element of Array.from(elementsWithPermissions)) {
      if (!(element instanceof HTMLElement) || !element.id) continue;

      const permissions = element.getAttribute("playhtml-permissions");
      if (permissions) {
        console.log(
          `[PLAYHTML AUTH]: Element ${element.id} has permissions: ${permissions}`
        );
      }
    }
  }
}

function getElementAwareness(tagType: TagType, elementId: string) {
  const awareness = yprovider.awareness.getLocalState();
  const elementAwareness = awareness?.[tagType] ?? {};
  return elementAwareness[elementId];
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
      document.querySelectorAll(`[${tag}]`)
    ).filter(isHTMLElement);

    tagElements.forEach((element) => {
      markElementAsLoading(element);
    });
  }
}

function markAllElementsAsReady(): void {
  for (const tag of getTagTypes()) {
    const tagElements: HTMLElement[] = Array.from(
      document.querySelectorAll(`[${tag}]`)
    ).filter(isHTMLElement);

    tagElements.forEach((element) => {
      markElementAsReady(element);
    });
  }
}

function createPlayElementData<T extends TagType>(
  element: HTMLElement,
  tag: T,
  tagInfo: ElementInitializer<T>,
  elementId: string
): ElementData<T> {
  if (VERBOSE) {
    console.log("registering element", elementId, "using SyncedStore data");
  }

  const initialData =
    tagInfo.defaultData instanceof Function
      ? tagInfo.defaultData(element)
      : tagInfo.defaultData;

  // Always use SyncedStore proxy
  const dataProxy = ensureElementProxy(tag as string, elementId, initialData);

  const elementData: ElementData = {
    ...tagInfo,
    // Always provide a plain snapshot to render paths
    data: clonePlain(dataProxy),
    awareness:
      getElementAwareness(tag, elementId) ??
      tagInfo.myDefaultAwareness !== undefined
        ? [tagInfo.myDefaultAwareness]
        : undefined,
    element,
    onChange: async (newData) => {
      // Prevent writes for read-only shared consumer elements
      const elementIdFromAttr = getIdForElement(element);
      if (isSharedReadOnly(element, elementIdFromAttr)) {
        return;
      }
      // Check permissions for write operations
      const identity = getCurrentIdentity();
      const session = getCurrentSession();

      // Check permissions using global roles and element-specific permissions
      const hasPermission = await checkPermission(elementId, "write", identity);
      if (!hasPermission) {
        console.warn(
          `[PLAYHTML AUTH]: Permission denied for write action on element ${elementId}`
        );
        return;
      }

      // If we have a session, use session-based actions for server validation
      if (session && identity) {
        try {
          // Create session action for server validation
          const sessionAction = createSessionAction(
            "write",
            elementId,
            newData
          );

          // Send to server for validation (optimistic update - apply locally first)
          if (typeof (newData as any) === "function") {
            doc.transact(() => {
              (newData as any)(dataProxy);
            });
          } else {
            doc.transact(() => {
              deepReplaceIntoProxy(dataProxy, newData);
            });
          }

          // Send session action to server for validation
          yprovider.ws?.send(
            JSON.stringify({
              type: "session_action",
              action: sessionAction,
            })
          );
        } catch (error) {
          console.error(
            "[PLAYHTML SESSION]: Failed to create session action:",
            error
          );
          // Fall back to direct update for better UX
          if (typeof (newData as any) === "function") {
            doc.transact(() => {
              (newData as any)(dataProxy);
            });
          } else {
            doc.transact(() => {
              deepReplaceIntoProxy(dataProxy, newData);
            });
          }
        }
      } else {
        // No session or identity - direct CRDT update
        if (typeof (newData as any) === "function") {
          // Mutator form support: onChange can accept function(draft)
          // Batch all nested mutations into a single Yjs transaction to coalesce events
          doc.transact(() => {
            (newData as any)(dataProxy);
          });
        } else {
          // Value form: replace snapshot semantics
          doc.transact(() => {
            deepReplaceIntoProxy(dataProxy, newData);
          });
        }
      }
    },
    onAwarenessChange: (elementAwarenessData) => {
      const localAwareness = yprovider.awareness.getLocalState()?.[tag] || {};

      if (localAwareness[elementId] === elementAwarenessData) {
        return;
      }

      localAwareness[elementId] = elementAwarenessData;
      yprovider.awareness.setLocalStateField(tag, localAwareness);
    },
    triggerAwarenessUpdate: () => {
      onChangeAwareness();
    },
  };

  return elementData;
}

function clonePlain<T>(value: T): T {
  // Prefer structuredClone when available; fallback to JSON clone for plain data
  try {
    // @ts-ignore
    if (typeof structuredClone === "function") {
      // @ts-ignore
      return structuredClone(value);
    }
  } catch {}
  if (value === null || value === undefined) return value;
  if (typeof value === "object") {
    return JSON.parse(JSON.stringify(value));
  }
  return value;
}

function isCorrectElementInitializer(
  tagInfo: ElementInitializer
): tagInfo is ElementInitializer {
  return (
    tagInfo.defaultData !== undefined &&
    (typeof tagInfo.defaultData === "object" ||
      typeof tagInfo.defaultData === "function") &&
    tagInfo.updateElement !== undefined
  );
}

function getElementInitializerInfoForElement(
  tag: TagType | string,
  element: HTMLElement
) {
  if (tag === TagType.CanPlay) {
    // TODO: this needs to handle multiple can-play functionalities?
    const customElement = element as any;
    const elementInitializerInfo: Required<
      Omit<ElementInitializer, "additionalSetup">
    > = {
      defaultData: customElement.defaultData,
      defaultLocalData: customElement.defaultLocalData,
      myDefaultAwareness: customElement.myDefaultAwareness,
      updateElement: customElement.updateElement,
      updateElementAwareness: customElement.updateElementAwareness,
      onDrag: customElement.onDrag,
      onDragStart: customElement.onDragStart,
      onClick: customElement.onClick,
      onMount: customElement.onMount || customElement.additionalSetup,
      resetShortcut: customElement.resetShortcut,
      debounceMs: customElement.debounceMs,
      isValidElementForTag: customElement.isValidElementForTag,
    };
    return elementInitializerInfo;
  }

  return capabilitiesToInitializer[tag];
}

function onChangeAwareness() {
  // map of tagType -> elementId -> clientId -> awarenessData
  const awarenessStates = new Map<string, Map<string, any>>();

  function setClientElementAwareness(
    tag: string,
    elementId: string,
    clientId: number,
    awarenessData: any
  ) {
    if (!awarenessStates.has(tag)) {
      awarenessStates.set(tag, new Map<string, any>());
    }
    const tagAwarenessStates = awarenessStates.get(tag)!;
    if (!tagAwarenessStates.has(elementId)) {
      tagAwarenessStates.set(elementId, new Map<string, any>());
    }
    const elementAwarenessStates = tagAwarenessStates.get(elementId);
    elementAwarenessStates.set(clientId, awarenessData);
  }

  yprovider.awareness.getStates().forEach((state, clientId) => {
    for (const [tag, tagData] of Object.entries(state)) {
      const tagElementHandlers = elementHandlers.get(tag as TagType);
      if (!tagElementHandlers) {
        continue;
      }
      for (const [elementId, _elementHandler] of tagElementHandlers) {
        if (!(elementId in tagData)) {
          continue;
        }
        const elementAwarenessData = tagData[elementId];
        setClientElementAwareness(
          tag,
          elementId,
          clientId,
          elementAwarenessData
        );
      }
    }

    for (const [tag, tagAwarenessStates] of awarenessStates) {
      const tagElementHandlers = elementHandlers.get(tag as TagType);
      if (!tagElementHandlers) {
        continue;
      }
      for (const [elementId, elementHandler] of tagElementHandlers) {
        const elementAwarenessStates = tagAwarenessStates
          .get(elementId)
          ?.values();
        if (!elementAwarenessStates) {
          continue;
        }
        let presentAwarenessStates = Array.from(elementAwarenessStates);
        elementHandler.__awareness = presentAwarenessStates;
      }
    }
  });
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

  for (const tag of getTagTypes()) {
    const tagElements: HTMLElement[] = Array.from(
      document.querySelectorAll(`[${tag}]`)
    ).filter(isHTMLElement);

    if (!tagElements.length) {
      continue;
    }

    if (VERBOSE) {
      console.log(`SET UP ${tag}`);
    }
    void Promise.all(
      tagElements.map((element) => setupPlayElementForTag(element, tag))
    );
  }

  if (!firstSetup) {
    return;
  }

  yprovider.awareness.on("change", () => onChangeAwareness());
  firstSetup = false;
}

export interface PlayHTMLComponents {
  init: typeof initPlayHTML;
  setupPlayElements: typeof setupElements;
  setupPlayElement: typeof setupPlayElement;
  removePlayElement: typeof removePlayElement;
  setupPlayElementForTag: typeof setupPlayElementForTag;
  syncedStore: (typeof store)["play"];
  // TODO: REMOVE AFTER MIGRATION VALIDATED
  globalData: typeof globalData;
  elementHandlers: Map<string, Map<string, ElementHandler>>;
  eventHandlers: Map<string, Array<RegisteredPlayEvent>>;
  dispatchPlayEvent: typeof dispatchPlayEvent;
  registerPlayEventListener: typeof registerPlayEventListener;
  removePlayEventListener: typeof removePlayEventListener;
  cursorClient: CursorClientAwareness | null;
  // Authentication (permissions are client-side advisory — see auth.ts)
  auth: {
    getCurrentIdentity: typeof getCurrentIdentity;
    checkPermission: typeof checkPermission;
    onAuthReady: typeof onAuthReady;
    createNewIdentity: typeof createNewIdentity;
    configureGlobalPermissions: typeof configureGlobalPermissions;
    getMyRoles: typeof getMyRoles;
    // Session functions
    getCurrentSession: typeof getCurrentSession;
    establishSession: (
      identity?: PlayHTMLIdentity
    ) => Promise<ValidatedSession>;
  };
}

// Expose big variables to the window object for debugging purposes.
export const playhtml: PlayHTMLComponents = {
  init: initPlayHTML,
  setupPlayElements: setupElements,
  setupPlayElement,
  removePlayElement,
  setupPlayElementForTag,
  syncedStore: store.play,
  // TODO: REMOVE AFTER MIGRATION VALIDATED
  globalData,
  elementHandlers,
  eventHandlers,
  dispatchPlayEvent,
  registerPlayEventListener,
  removePlayEventListener,
  get cursorClient() {
    return cursorClient;
  },
  // Authentication (permissions are client-side advisory — see auth.ts)
  auth: {
    getCurrentIdentity,
    checkPermission,
    onAuthReady,
    createNewIdentity,
    configureGlobalPermissions,
    getMyRoles,
    // Session functions
    getCurrentSession,
    establishSession: async (identity?: PlayHTMLIdentity) => {
      const actualIdentity = identity || getCurrentIdentity();
      if (!actualIdentity) {
        throw new Error("No identity available for session establishment");
      }
      if (!yprovider?.ws) {
        throw new Error("No WebSocket connection available");
      }
      return await establishSessionWithWS(actualIdentity, yprovider.ws);
    },
  },
};

/**
 * Performs any necessary setup for a playhtml TagType. Safe to call repeatedly.
 */
function maybeSetupTag(tag: TagType | string): void {
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
 */
function isElementValidForTag(
  element: HTMLElement,
  tag: TagType | string
): boolean {
  return (
    capabilitiesToInitializer[tag]?.isValidElementForTag?.(element) ?? true
  );
}

/**
 * Sets up a playhtml element to handle the given tag's capabilities.
 */
async function setupPlayElementForTag<T extends TagType | string>(
  element: HTMLElement,
  tag: T
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
      `Element ${element} does not have an acceptable ID. Please add an ID to the element to register it as a playhtml element.`
    );
    return;
  }

  maybeSetupTag(tag);
  const tagElementHandlers = elementHandlers.get(tag)!;

  const elementInitializerInfo = getElementInitializerInfoForElement(
    tag,
    element
  );
  if (!isCorrectElementInitializer(elementInitializerInfo)) {
    console.error(
      `Element ${elementId} does not have proper info to initial a playhtml element. Please refer to https://github.com/spencerc99/playhtml#can-play for troubleshooting help.`
    );
    return;
  }

  const elementData = createPlayElementData(
    element,
    tag,
    elementInitializerInfo,
    elementId
  );
  if (tagElementHandlers.has(elementId)) {
    // Try to update the elements info
    tagElementHandlers.get(elementId)!.reinitializeElementData(elementData);
    // ensure observer is attached
    attachSyncedStoreObserver(tag as string, elementId);
    return;
  } else {
    tagElementHandlers.set(elementId, new ElementHandler(elementData));
  }

  // redo this now that we have set it in the mapping.
  // TODO: this is inefficient, it tries to do this in the constructor but fails, should clean up the API
  elementData.triggerAwarenessUpdate?.();
  // Set up the common classes for affected elements.
  element.classList.add(`__playhtml-element`);
  element.style.setProperty("--jiggle-delay", `${Math.random() * 1}s;}`);

  attachSyncedStoreObserver(tag as string, elementId);
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
      // Push plain snapshot into handler for stable rendering
      const proxy = store.play[tag]?.[elementId];
      if (!proxy) return;
      const plain = clonePlain(proxy);
      // Mark as remote-apply so onChange can permit programmatic updates for RO elements
      const applyKey = `${tag}:${elementId}`;
      remoteApplyingKeys.add(applyKey);
      try {
        // @ts-ignore private usage intended
        handler.__data = plain;
      } finally {
        remoteApplyingKeys.delete(applyKey);
      }
      // Mark that this shared reference has received data
      sharedUpdateSeen.add(key);
      // Debug: log updates for shared elements
      if (VERBOSE) {
        console.log(
          `[PLAYHTML] updated shared element ${tag}:${elementId} via SyncedStore observer`
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
              `[playhtml] Shared reference ${tag}:${elementId} has not received data. Check data-source and source availability.`
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
  { ignoreIfAlreadySetup }: { ignoreIfAlreadySetup?: boolean } = {}
) {
  if (
    ignoreIfAlreadySetup &&
    Object.keys(elementHandlers || {}).some((tag) =>
      elementHandlers.get(tag)?.has(element.id)
    )
  ) {
    return;
  }

  if (!isHTMLElement(element)) {
    console.log(`Element ${element.id} not an HTML element. Ignoring.`);
    return;
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
    element.hasAttribute(tag)
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
      .map((tag) => setupPlayElementForTag(element, tag))
  );
}

function removePlayElement(element: Element | null) {
  if (!element || !element.id) {
    return;
  }

  for (const tag of Object.keys(elementHandlers)) {
    const tagElementHandler = elementHandlers.get(tag)!;
    if (tagElementHandler.has(element.id)) {
      tagElementHandler.delete(element.id);
    }
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
  event: Omit<PlayEvent, "type">
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

export type {
  TagType,
  PlayerIdentity,
  Cursor,
  CursorPresence,
} from "@playhtml/common";
