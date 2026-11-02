// ABOUTME: Keeps Safari's copy of the extension and the iPhone app's own copy in step.
// ABOUTME: Shares identity and setup, history and scraps, collages, and what either side deleted.

import browser from "webextension-polyfill";
import type { CollectionEvent } from "@playhtml/extension-types";
import { PLAYER_IDENTITY_STORAGE_KEY } from "../storage/playerIdentity";
import { LEGIBILITY_KEY } from "../utils/keyboardRedaction";
import {
  gunzipToString,
  gzipEventExport,
  gzipString,
} from "../utils/dataTransfer";
import type { CollageRecord } from "../entrypoints/scraps/collageRecord";
import type { SharedContainer, SyncSide } from "./sharedContainer";

export const DEVICE_SYNC_ALARM = "deviceSync";
/** How often each side takes in the other's changes while it is awake. */
export const DEVICE_SYNC_PERIOD_MINUTES = 10;
export const SYNC_DELETIONS_KEY = "wwoSyncDeletions";
export const SYNC_PROGRESS_KEY = "wwoSyncProgress";
/** Each setup choice's last value seen here and when it was set, on either side. */
export const SYNC_SETTINGS_SEEN_KEY = "wwoSyncSettingsSeen";

const ONBOARDING_KEY = "onboarding_complete";
/** Setup choices that travel with the identity: who you are and what you collect. */
const SHARED_SETTING_KEYS = [
  PLAYER_IDENTITY_STORAGE_KEY,
  ONBOARDING_KEY,
  LEGIBILITY_KEY,
  "setup_email",
];
const SHARED_SETTING_PREFIXES = ["collection_mode_"];
/**
 * History from the other side is read from a little before the newest event
 * already taken from it, so events it stored late are still picked up.
 */
const EVENT_OVERLAP_MS = 24 * 60 * 60 * 1000;

/** When each scrap and collage was deleted, by id, on either side. */
export interface Deletions {
  scraps: Record<string, number>;
  collages: Record<string, number>;
}

/** What one side writes for the other: setup, deletions and its collages. */
export interface SideState {
  version: 1;
  side: SyncSide;
  writtenAt: number;
  onboarded: boolean;
  settings: Record<string, unknown>;
  /** When each setup choice was last changed, so the later change wins on both sides. */
  settingsAt: Record<string, number>;
  deletions: Deletions;
  /** Each collage as the text of its collage file. */
  collages: string[];
}

interface SyncProgress {
  /** When the other side's history file was last taken in. */
  eventsImportedAt?: number;
  /** The newest event taken from the other side. */
  eventsImportedThrough?: number;
  eventsFingerprint?: string;
  stateFingerprint?: string;
}

export interface SyncStore {
  /** How many events are held and the newest one's time, without reading them all. */
  eventSummary(): Promise<{ count: number; newest: number }>;
  getAllEvents(): Promise<CollectionEvent[]>;
  addSyncedEvents(events: CollectionEvent[]): Promise<CollectionEvent[]>;
  deleteScrapEvents(ids: string[]): Promise<number>;
}

export interface SyncCollages {
  list(): Promise<{ id: string; updatedAt: number }[]>;
  load(id: string): Promise<CollageRecord | null>;
  save(record: CollageRecord): Promise<void>;
  remove(id: string): Promise<void>;
  encode(record: CollageRecord): Promise<string>;
  decode(text: string): CollageRecord;
}

export interface SyncDeps {
  container: SharedContainer;
  store: SyncStore;
  collages: SyncCollages;
  storage: {
    get(keys: string[] | null): Promise<Record<string, unknown>>;
    set(items: Record<string, unknown>): Promise<void>;
    remove(keys: string[]): Promise<void>;
  };
  now(): number;
}

export interface SyncResult {
  /** This side took on the other side's identity, so running services must restart. */
  adoptedIdentity: boolean;
  importedEvents: number;
  /** Scraps taken in, so their pictures can be copied and fingerprinted here. */
  importedScraps: CollectionEvent[];
  savedCollages: number;
}

export function emptyDeletions(): Deletions {
  return { scraps: {}, collages: {} };
}

function readDeletions(value: unknown): Deletions {
  const result = emptyDeletions();
  if (!value || typeof value !== "object") return result;
  for (const kind of ["scraps", "collages"] as const) {
    const entries = (value as Record<string, unknown>)[kind];
    if (!entries || typeof entries !== "object") continue;
    for (const [id, at] of Object.entries(entries as Record<string, unknown>)) {
      if (typeof at === "number") result[kind][id] = at;
    }
  }
  return result;
}

/** Every deletion either side knows of, keeping the later time for an id both deleted. */
export function mergeDeletions(a: Deletions, b: Deletions): Deletions {
  const merged = emptyDeletions();
  for (const kind of ["scraps", "collages"] as const) {
    for (const source of [a[kind], b[kind]]) {
      for (const [id, at] of Object.entries(source)) {
        merged[kind][id] = Math.max(merged[kind][id] ?? 0, at);
      }
    }
  }
  return merged;
}

/** Ids `merged` holds that `before` did not: deletions this side has yet to carry out. */
export function newDeletions(before: Deletions, merged: Deletions) {
  return {
    scraps: Object.keys(merged.scraps).filter((id) => !(id in before.scraps)),
    collages: Object.keys(merged.collages).filter(
      (id) => !(id in before.collages),
    ),
  };
}

function publicKeyOf(settings: Record<string, unknown>): string | null {
  const identity = settings[PLAYER_IDENTITY_STORAGE_KEY] as
    | { public?: { publicKey?: unknown } }
    | undefined;
  const key = identity?.public?.publicKey;
  return typeof key === "string" ? key : null;
}

function isOnboarded(settings: Record<string, unknown>): boolean {
  const value = settings[ONBOARDING_KEY];
  return value === "true" || value === true;
}

/**
 * Whether this side should take on the other side's identity and setup. A side
 * that has not been set up takes the other's; when both were set up as
 * different people, Safari's identity wins, since it is the one people had
 * first and the one their history and access are tied to.
 */
export function shouldAdopt(
  local: { onboarded: boolean; publicKey: string | null },
  other: { side: SyncSide; onboarded: boolean; publicKey: string | null },
): boolean {
  if (!other.onboarded || !other.publicKey) return false;
  if (!local.onboarded || !local.publicKey) return true;
  if (local.publicKey === other.publicKey) return false;
  return other.side === "safari";
}

function isSharedSettingKey(key: string): boolean {
  return (
    SHARED_SETTING_KEYS.includes(key) ||
    SHARED_SETTING_PREFIXES.some((prefix) => key.startsWith(prefix))
  );
}

export function pickSharedSettings(
  all: Record<string, unknown>,
): Record<string, unknown> {
  const picked: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(all)) {
    if (isSharedSettingKey(key)) picked[key] = value;
  }
  return picked;
}

/**
 * Which of the other side's collages to store here: ones this side lacks or
 * holds an older version of, and not ones either side deleted since.
 */
export function collagesToSave(
  local: { id: string; updatedAt: number }[],
  incoming: CollageRecord[],
  deletions: Deletions,
): CollageRecord[] {
  const held = new Map(local.map((entry) => [entry.id, entry.updatedAt]));
  return incoming.filter((record) => {
    const deletedAt = deletions.collages[record.id];
    if (deletedAt !== undefined && deletedAt >= record.updatedAt) return false;
    const heldAt = held.get(record.id);
    return heldAt === undefined || record.updatedAt > heldAt;
  });
}

function otherSide(side: SyncSide): SyncSide {
  return side === "safari" ? "app" : "safari";
}

function fingerprint(text: string): string {
  // A short FNV-1a hash, enough to tell whether a state changed since it was written.
  let hash = 0x811c9dc5;
  for (let at = 0; at < text.length; at += 1) {
    hash ^= text.charCodeAt(at);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `${text.length}:${hash.toString(16)}`;
}

function readTimes(value: unknown): Record<string, number> {
  const times: Record<string, number> = {};
  if (!value || typeof value !== "object") return times;
  for (const [key, at] of Object.entries(value as Record<string, unknown>)) {
    if (typeof at === "number") times[key] = at;
  }
  return times;
}

type SettingsSeen = Record<string, { value: string; at: number }>;

function readSettingsSeen(value: unknown): SettingsSeen {
  const seen: SettingsSeen = {};
  if (!value || typeof value !== "object") return seen;
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    const { value: text, at } = (entry ?? {}) as Record<string, unknown>;
    if (typeof text === "string" && typeof at === "number") {
      seen[key] = { value: text, at };
    }
  }
  return seen;
}

/**
 * Setup choices other than who you are (what is collected, keyboard
 * legibility, email). These follow the most recent change on either side; the
 * identity and whether setup is done follow `shouldAdopt` instead.
 */
function choiceKeys(settings: Record<string, unknown>): string[] {
  return Object.keys(settings).filter(
    (key) => key !== PLAYER_IDENTITY_STORAGE_KEY && key !== ONBOARDING_KEY,
  );
}

/**
 * Stamps each choice whose value changed here since the last pass with `now`.
 * A choice made before sync first saw it is stamped as oldest, so it never
 * overrides one the other side made.
 */
export function noteChoiceChanges(
  settings: Record<string, unknown>,
  seen: SettingsSeen,
  now: number,
): SettingsSeen {
  const noted = { ...seen };
  // A choice removed here (an email forgotten) is a change too, kept as
  // absent so the other side removes it as well.
  for (const key of new Set([...choiceKeys(settings), ...choiceKeys(seen)])) {
    const value = choiceValue(settings, key);
    if (noted[key]?.value === value) continue;
    if (!noted[key] && value === ABSENT) continue;
    noted[key] = { value, at: noted[key] ? now : 0 };
  }
  return noted;
}

/** What a choice that is not set is recorded as; no JSON value is empty text. */
const ABSENT = "";

function choiceValue(settings: Record<string, unknown>, key: string): string {
  return key in settings && settings[key] !== undefined
    ? JSON.stringify(settings[key])
    : ABSENT;
}

/** The other side's choices changed more recently than this side's. */
export function newerChoices(
  seen: SettingsSeen,
  other: {
    settings: Record<string, unknown>;
    settingsAt: Record<string, number>;
  },
): { set: Record<string, unknown>; remove: string[] } {
  const newer = { set: {} as Record<string, unknown>, remove: [] as string[] };
  const keys = new Set([
    ...choiceKeys(other.settings),
    ...choiceKeys(other.settingsAt).filter(isSharedSettingKey),
  ]);
  for (const key of keys) {
    const at = other.settingsAt[key] ?? 0;
    const value = choiceValue(other.settings, key);
    if (at > (seen[key]?.at ?? 0) && value !== (seen[key]?.value ?? ABSENT)) {
      if (value === ABSENT) newer.remove.push(key);
      else newer.set[key] = other.settings[key];
    }
  }
  return newer;
}

function readSideState(text: string, side: SyncSide): SideState | null {
  try {
    const parsed = JSON.parse(text) as Partial<SideState>;
    if (parsed.version !== 1 || parsed.side !== side) return null;
    return {
      version: 1,
      side,
      writtenAt: Number(parsed.writtenAt) || 0,
      onboarded: parsed.onboarded === true,
      settings:
        parsed.settings && typeof parsed.settings === "object"
          ? pickSharedSettings(parsed.settings)
          : {},
      settingsAt: readTimes(parsed.settingsAt),
      deletions: readDeletions(parsed.deletions),
      collages: Array.isArray(parsed.collages)
        ? parsed.collages.filter(
            (entry): entry is string => typeof entry === "string",
          )
        : [],
    };
  } catch {
    return null;
  }
}

/** Records scraps deleted here, so the other side deletes them too instead of bringing them back. */
export async function recordScrapDeletions(
  ids: string[],
  at = Date.now(),
): Promise<void> {
  if (ids.length === 0) return;
  const stored = await browser.storage.local.get(SYNC_DELETIONS_KEY);
  const deletions = readDeletions(stored[SYNC_DELETIONS_KEY]);
  for (const id of ids) deletions.scraps[id] = at;
  await browser.storage.local.set({ [SYNC_DELETIONS_KEY]: deletions });
}

/** Records a collage deleted here, for the same reason. */
export async function recordCollageDeletion(
  id: string,
  at = Date.now(),
): Promise<void> {
  const stored = await browser.storage.local.get(SYNC_DELETIONS_KEY);
  const deletions = readDeletions(stored[SYNC_DELETIONS_KEY]);
  deletions.collages[id] = at;
  await browser.storage.local.set({ [SYNC_DELETIONS_KEY]: deletions });
}

/**
 * One pass: take in what the other side wrote, then write this side's own.
 * Each side owns its own two files, `<side>.state` and `<side>.events`, and
 * only ever reads the other's, so the two never write the same file.
 */
export async function runDeviceSync(deps: SyncDeps): Promise<SyncResult> {
  const { container, store, collages, storage } = deps;
  const side = container.side;
  const other = otherSide(side);
  const result: SyncResult = {
    adoptedIdentity: false,
    importedEvents: 0,
    importedScraps: [],
    savedCollages: 0,
  };

  const local = await storage.get(null);
  const progress = {
    ...(local[SYNC_PROGRESS_KEY] as SyncProgress | undefined),
  };
  const localDeletions = readDeletions(local[SYNC_DELETIONS_KEY]);

  const otherFile = await container.read(`${other}.state`);
  const otherState = otherFile
    ? readSideState(await gunzipToString(otherFile.bytes), other)
    : null;

  let deletions = localDeletions;
  let settings = pickSharedSettings(local);
  const seen = noteChoiceChanges(
    settings,
    readSettingsSeen(local[SYNC_SETTINGS_SEEN_KEY]),
    deps.now(),
  );
  if (otherState) {
    deletions = mergeDeletions(localDeletions, otherState.deletions);
    const pending = newDeletions(localDeletions, deletions);
    if (pending.scraps.length > 0)
      await store.deleteScrapEvents(pending.scraps);
    if (pending.collages.length > 0) {
      // A collage edited here after the other side deleted it is kept, the
      // same newer-wins rule the other side applies when this one comes back.
      const held = new Map(
        (await collages.list()).map((entry) => [entry.id, entry.updatedAt]),
      );
      for (const id of pending.collages) {
        const heldAt = held.get(id);
        if (heldAt === undefined || deletions.collages[id] >= heldAt) {
          await collages.remove(id);
        }
      }
    }
    if (pending.scraps.length > 0 || pending.collages.length > 0) {
      await storage.set({ [SYNC_DELETIONS_KEY]: deletions });
    }

    if (
      shouldAdopt(
        { onboarded: isOnboarded(settings), publicKey: publicKeyOf(settings) },
        {
          side: other,
          onboarded: otherState.onboarded,
          publicKey: publicKeyOf(otherState.settings),
        },
      )
    ) {
      await storage.set(otherState.settings);
      settings = { ...settings, ...otherState.settings };
      // Every choice comes over with the identity, keeping when it was made.
      for (const key of choiceKeys(otherState.settings)) {
        seen[key] = {
          value: choiceValue(otherState.settings, key),
          at: otherState.settingsAt[key] ?? 0,
        };
      }
      result.adoptedIdentity = true;
    }
    // Choices changed more recently on the other side, including ones it
    // removed, win here too.
    const newer = newerChoices(seen, otherState);
    if (Object.keys(newer.set).length > 0) await storage.set(newer.set);
    if (newer.remove.length > 0) await storage.remove(newer.remove);
    if (Object.keys(newer.set).length > 0 || newer.remove.length > 0) {
      settings = { ...settings, ...newer.set };
      for (const key of newer.remove) delete settings[key];
      for (const key of [...Object.keys(newer.set), ...newer.remove]) {
        seen[key] = {
          value: choiceValue(settings, key),
          at: otherState.settingsAt[key] ?? 0,
        };
      }
    }

    const incoming: CollageRecord[] = [];
    for (const text of otherState.collages) {
      try {
        incoming.push(collages.decode(text));
      } catch (error) {
        console.warn(
          "[device sync] skipped a collage that could not be read:",
          error,
        );
      }
    }
    for (const record of collagesToSave(
      await collages.list(),
      incoming,
      deletions,
    )) {
      // A shared link's delete token never leaves the side that shared it.
      const held = await collages.load(record.id).catch(() => null);
      await collages.save(
        held?.publication
          ? { ...record, publication: held.publication }
          : record,
      );
      result.savedCollages += 1;
    }
  }

  const otherEvents = await container.stat(`${other}.events`);
  if (otherEvents && otherEvents.modified > (progress.eventsImportedAt ?? 0)) {
    const file = await container.read(`${other}.events`);
    if (file) {
      const parsed = JSON.parse(await gunzipToString(file.bytes)) as {
        events?: CollectionEvent[];
      };
      const since = (progress.eventsImportedThrough ?? 0) - EVENT_OVERLAP_MS;
      const events = (parsed.events ?? []).filter(
        (event) => event.ts > since && !(event.id in deletions.scraps),
      );
      const stored = await store.addSyncedEvents(events);
      result.importedEvents = stored.length;
      result.importedScraps = stored.filter(
        (event) => event.type === "element",
      );
      progress.eventsImportedAt = file.modified;
      progress.eventsImportedThrough = events.reduce(
        (latest, event) => Math.max(latest, event.ts),
        progress.eventsImportedThrough ?? 0,
      );
    }
  }

  const ownCollages: string[] = [];
  for (const entry of await collages.list()) {
    const record = await collages.load(entry.id).catch(() => null);
    if (record) ownCollages.push(await collages.encode(record));
  }
  const ownState: Omit<SideState, "writtenAt"> = {
    version: 1,
    side,
    onboarded: isOnboarded(settings),
    settings,
    settingsAt: Object.fromEntries(
      Object.entries(seen).map(([key, entry]) => [key, entry.at]),
    ),
    deletions,
    collages: ownCollages,
  };
  const stateText = JSON.stringify(ownState);
  const stateFingerprint = fingerprint(stateText);
  if (stateFingerprint !== progress.stateFingerprint) {
    await container.write(
      `${side}.state`,
      await gzipString(JSON.stringify({ ...ownState, writtenAt: deps.now() })),
    );
    progress.stateFingerprint = stateFingerprint;
  }

  const summary = await store.eventSummary();
  const eventsFingerprint = `${summary.count}:${summary.newest}`;
  if (eventsFingerprint !== progress.eventsFingerprint) {
    const events = await store.getAllEvents();
    await container.write(
      `${side}.events`,
      await gzipEventExport(events, null, deps.now()),
    );
    progress.eventsFingerprint = eventsFingerprint;
  }

  await storage.set({
    [SYNC_PROGRESS_KEY]: progress,
    [SYNC_SETTINGS_SEEN_KEY]: seen,
  });
  return result;
}
