// ABOUTME: Builds the public people API (`playhtml.people`, `room.people`) over the channel-based presence client.
// ABOUTME: Each person is their identity plus one presence object; each top-level presence key is one wire channel.

import type {
  CursorPresenceView,
  ElementPerson,
  Me,
  PagePresence,
  People,
  Person,
  PresenceAPI,
  PresenceKeys,
  PresenceView,
  User,
} from "@playhtml/common";
import { playerIdentityToUser } from "@playhtml/common";
import { isReservedPresenceField, safeInvoke } from "./presence-utils";

/**
 * Channel name that subscribes to every page presence channel at once (cursor
 * excluded). Understood by PresenceClient and passed through PresenceFacade.
 */
export const ALL_PRESENCE_CHANNELS = "*";

// Mirrors the server's low-frequency budget for page presence messages.
const PRESENCE_WRITE_BUDGET = 20;
const PRESENCE_WRITE_WINDOW_MS = 1_000;

/** Your identity, with live `name` and `color` setters (the users module's `me`). */
export interface SelfIdentity {
  readonly pid: string;
  name: string | undefined;
  color: string;
}

/**
 * An element's person entry. The 2.15 element `users` entries were
 * `{ user, live }`; both stay readable as hidden getters so old code works and
 * logged entries stay clean.
 */
export function createElementPerson<V>(user: User, presence: V): ElementPerson<V> {
  const person = { ...user, presence } as ElementPerson<V>;
  Object.defineProperty(person, "user", {
    get() {
      return user;
    },
    enumerable: false,
  });
  Object.defineProperty(person, "live", {
    get() {
      return (this as ElementPerson<V>).presence;
    },
    enumerable: false,
  });
  return person;
}

export function presenceFingerprint(value: unknown): string {
  try {
    return JSON.stringify(value ?? null);
  } catch {
    return "null";
  }
}

function assertWritableKey(key: unknown): asserts key is string {
  if (typeof key !== "string") {
    throw new Error(
      `[playhtml] setMyPresence() takes a key and a value, e.g. setMyPresence("status", "typing").`,
    );
  }
  if (key === "cursor") {
    throw new Error(
      `[playhtml] "cursor" is set by playhtml when cursors are on, so you can't set it. ` +
        `Read it as person.presence.cursor.`,
    );
  }
  if (key === ALL_PRESENCE_CHANNELS || isReservedPresenceField(key)) {
    throw new Error(
      `[playhtml] "${key}" is reserved by playhtml and can't be used as a presence key.`,
    );
  }
}

function normalizeKeys(keys: PresenceKeys): string[] {
  const list = typeof keys === "string" ? [keys] : Array.from(keys);
  for (const key of list) {
    if (typeof key !== "string") {
      throw new Error(
        `[playhtml] onChange() takes a key or a list of keys first, e.g. onChange("status", callback).`,
      );
    }
  }
  return list;
}

function presenceFromView(view: PresenceView | undefined): PagePresence {
  const presence: PagePresence = {};
  if (!view) return presence;
  for (const [key, value] of Object.entries(view)) {
    if (isReservedPresenceField(key)) continue;
    if (value === undefined || value === null) continue;
    presence[key] = value;
  }
  return presence;
}

function pickKeys(presence: PagePresence, keys: string[]): unknown[] {
  return keys.map((key) => presence[key] ?? null);
}

function withoutCursor(presence: PagePresence): PagePresence {
  if (!("cursor" in presence)) return presence;
  const { cursor: _cursor, ...rest } = presence;
  return rest;
}

type PeopleOptions = {
  /** The channel-based presence client these people read and write. */
  getSource: () => PresenceAPI;
  /** Your identity (pid, name, color), with setters that save and publish. */
  getSelf: () => SelfIdentity;
  /** Everyone known on the page, in join order (page only). */
  getUsers?: () => User[];
  /** Fires when `getUsers()` changes: joins, leaves, name or color (page only). */
  onUsersChange?: (callback: () => void) => () => void;
  /** Everyone's cursors, keyed by pid (page only). */
  getCursorPresences?: () => Map<string, CursorPresenceView> | undefined;
  /** Whether to emit development-only warnings. */
  isDevMode?: () => boolean;
};

export function createPeople(options: PeopleOptions): People {
  const { getSource, getSelf, getUsers, onUsersChange, getCursorPresences, isDevMode } =
    options;
  const recentWrites: number[] = [];
  let warnedAboutRate = false;

  function selfUser(): User {
    const self = getSelf();
    const user: User = { pid: self.pid, color: self.color, isMe: true };
    if (self.name !== undefined) user.name = self.name;
    return user;
  }

  function cursorFor(pid: string, cursors: Map<string, CursorPresenceView> | undefined) {
    const view = cursors?.get(pid);
    if (!view?.cursor) return undefined;
    return { ...view.cursor, zone: view.zone ?? null, page: view.page };
  }

  function buildEveryone(): Person[] {
    const views = getSource().getPresences();
    const cursors = getCursorPresences?.();
    const self = selfUser();
    const users = new Map<string, User>();

    for (const user of getUsers?.() ?? []) users.set(user.pid, user);
    for (const view of views.values()) {
      if (view.user && !users.has(view.user.pid)) users.set(view.user.pid, view.user);
    }
    if (cursors) {
      for (const [pid, view] of cursors) {
        if (users.has(pid) || !view.playerIdentity) continue;
        users.set(pid, view.user ?? playerIdentityToUser(view.playerIdentity, false));
      }
    }
    // You are always here, even before the connection is up.
    users.set(self.pid, self);

    const presenceByPid = new Map<string, PresenceView>();
    for (const view of views.values()) {
      if (view.user) presenceByPid.set(view.user.pid, view);
    }

    const everyone: Person[] = [];
    for (const user of users.values()) {
      const presence = presenceFromView(presenceByPid.get(user.pid));
      const cursor = cursorFor(user.pid, cursors);
      if (cursor) presence.cursor = cursor;
      everyone.push({ ...user, isMe: user.pid === self.pid, presence });
    }
    return everyone;
  }

  function myPresence(): PagePresence {
    const self = getSelf();
    const views = getSource().getPresences();
    let view: PresenceView | undefined;
    for (const candidate of views.values()) {
      if (candidate.isMe || candidate.user?.pid === self.pid) {
        view = candidate;
        break;
      }
    }
    const presence = presenceFromView(view);
    const cursor = cursorFor(self.pid, getCursorPresences?.());
    if (cursor) presence.cursor = cursor;
    return presence;
  }

  const me: Me = {
    get pid() {
      return getSelf().pid;
    },
    get name() {
      return getSelf().name;
    },
    set name(name: string | undefined) {
      getSelf().name = name;
    },
    get color() {
      return getSelf().color;
    },
    set color(color: string) {
      getSelf().color = color;
    },
    get isMe() {
      return true as const;
    },
    get presence() {
      return myPresence();
    },
  };

  function noteWrite(): void {
    if (warnedAboutRate || !isDevMode?.()) return;
    const now = Date.now();
    recentWrites.push(now);
    while (recentWrites.length && now - recentWrites[0] > PRESENCE_WRITE_WINDOW_MS) {
      recentWrites.shift();
    }
    if (recentWrites.length > PRESENCE_WRITE_BUDGET) {
      warnedAboutRate = true;
      console.warn(
        `[playhtml] setMyPresence() was called more than ${PRESENCE_WRITE_BUDGET} times per second. ` +
          `Presence is for state changes, not per-frame streams; extra writes are dropped. ` +
          `Throttle the writes. Cursors already share pointer position for you.`,
      );
    }
  }

  function setMyPresence(key: string, value: unknown): void {
    assertWritableKey(key);
    if (arguments.length < 2) {
      throw new Error(
        `[playhtml] setMyPresence("${key}") needs a value. Pass null to clear it.`,
      );
    }
    noteWrite();
    getSource().setMyPresence(key, value ?? null);
  }

  function onChange(callback: (everyone: Person[]) => void): () => void;
  function onChange(keys: PresenceKeys, callback: (everyone: Person[]) => void): () => void;
  function onChange(
    first: PresenceKeys | ((everyone: Person[]) => void),
    second?: (everyone: Person[]) => void,
  ): () => void {
    const callback = (second ?? first) as (everyone: Person[]) => void;
    if (typeof callback !== "function") {
      throw new Error("[playhtml] onChange() needs a callback.");
    }
    const keys = second ? normalizeKeys(first as PresenceKeys) : null;
    const select = keys
      ? (presence: PagePresence) => pickKeys(presence, keys)
      : (presence: PagePresence) => withoutCursor(presence);

    // Watch every channel even for some keys: joins, leaves, and name or color
    // changes from people without those keys still change the list. The
    // fingerprint drops updates that leave the watched part the same.
    let lastFingerprint: string | null = null;
    const check = () => {
      const everyone = buildEveryone();
      const next = presenceFingerprint(
        everyone.map((person) => [person.pid, person.name, person.color, select(person.presence)]),
      );
      if (next === lastFingerprint) return;
      if (safeInvoke(() => callback(everyone), "people subscriber")) {
        lastFingerprint = next;
      }
    };

    const source = getSource();
    const unsubscribes: (() => void)[] = [];
    unsubscribes.push(source.onPresenceChange(ALL_PRESENCE_CHANNELS, check));
    if (keys?.includes("cursor")) {
      unsubscribes.push(source.onPresenceChange("cursor", check));
    }
    if (onUsersChange) unsubscribes.push(onUsersChange(check));
    check();
    return () => {
      for (const unsubscribe of unsubscribes) unsubscribe();
    };
  }

  return {
    get everyone() {
      return buildEveryone();
    },
    me,
    getAll: buildEveryone,
    setMyPresence,
    onChange,
  };
}
