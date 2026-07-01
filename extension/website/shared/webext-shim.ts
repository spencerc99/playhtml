// ABOUTME: Minimal webextension-polyfill stand-in so extension social code (bottles, inventory)
// ABOUTME: can run on the wewere.online site. Aliased to "webextension-polyfill" for website builds only.

// runtime.getURL: extension code asks for packed assets (e.g. "inventory/bottle.png").
// On the site those live under public/, served from the root — so just root-anchor the path.
function getURL(path: string): string {
  return "/" + path.replace(/^\/+/, "");
}

// storage.local: back it with localStorage so held-inventory etc. persist across reloads,
// matching the extension's per-browser semantics closely enough for a playground.
const STORAGE_PREFIX = "wwo-webext-shim:";

const local = {
  async get(
    keys?: string | string[] | Record<string, unknown> | null,
  ): Promise<Record<string, unknown>> {
    const wanted: string[] | null =
      keys == null
        ? null
        : Array.isArray(keys)
          ? keys
          : typeof keys === "string"
            ? [keys]
            : Object.keys(keys);
    const out: Record<string, unknown> = {};
    const read = (k: string) => {
      const raw = localStorage.getItem(STORAGE_PREFIX + k);
      if (raw != null) {
        try {
          out[k] = JSON.parse(raw);
        } catch {
          out[k] = raw;
        }
      }
    };
    if (wanted) {
      wanted.forEach(read);
    } else {
      for (let i = 0; i < localStorage.length; i++) {
        const full = localStorage.key(i);
        if (full?.startsWith(STORAGE_PREFIX)) read(full.slice(STORAGE_PREFIX.length));
      }
    }
    // get({key: default}) form: fill defaults for missing keys.
    if (keys && !Array.isArray(keys) && typeof keys === "object") {
      for (const [k, def] of Object.entries(keys)) {
        if (!(k in out)) out[k] = def;
      }
    }
    return out;
  },
  async set(items: Record<string, unknown>): Promise<void> {
    for (const [k, v] of Object.entries(items)) {
      localStorage.setItem(STORAGE_PREFIX + k, JSON.stringify(v));
    }
  },
  async remove(keys: string | string[]): Promise<void> {
    (Array.isArray(keys) ? keys : [keys]).forEach((k) =>
      localStorage.removeItem(STORAGE_PREFIX + k),
    );
  },
  async clear(): Promise<void> {
    const toRemove: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const full = localStorage.key(i);
      if (full?.startsWith(STORAGE_PREFIX)) toRemove.push(full);
    }
    toRemove.forEach((k) => localStorage.removeItem(k));
  },
};

const noopListener = {
  addListener: () => {},
  removeListener: () => {},
  hasListener: () => false,
};

const browser = {
  runtime: {
    getURL,
    onMessage: { ...noopListener },
    sendMessage: async () => undefined,
  },
  storage: {
    local,
    // session is referenced in a couple of places; mirror local for the playground.
    session: local,
  },
  // commands is optional in the extension code (optional-chained); leave undefined.
  commands: undefined,
  tabs: {
    query: async () => [],
    sendMessage: async () => undefined,
  },
};

export default browser;
