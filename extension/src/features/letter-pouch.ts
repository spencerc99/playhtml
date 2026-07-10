// ABOUTME: The letter pouch — the writing economy. You hold at most POUCH_MAX
// ABOUTME: letters; one regrows per POUCH_REGEN_MS. Replaces the per-domain cooldown.

export const POUCH_MAX = 3;
export const POUCH_REGEN_MS = 3 * 24 * 60 * 60 * 1000; // one letter per 3 days

const STORAGE_KEY = "bottle:pouch:v1";

interface PouchState {
  count: number;
  lastRegenAt: number;
}

// In-memory mirror: source of truth for the session, persisted best-effort.
// If a localStorage write fails (quota/unavailable), the session still gates.
let mem: PouchState | null = null;

function load(now: number): PouchState {
  if (!mem) {
    mem = readStorage() ?? { count: POUCH_MAX, lastRegenAt: now };
  }
  applyRegen(mem, now);
  persist(mem);
  return mem;
}

function readStorage(): PouchState | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      typeof (parsed as PouchState).count !== "number" ||
      typeof (parsed as PouchState).lastRegenAt !== "number"
    ) {
      return null;
    }
    const s = parsed as PouchState;
    return {
      count: Math.min(POUCH_MAX, Math.max(0, Math.floor(s.count))),
      lastRegenAt: s.lastRegenAt,
    };
  } catch {
    return null;
  }
}

function applyRegen(s: PouchState, now: number): void {
  if (s.count >= POUCH_MAX) {
    // A full pouch banks no regen time — the clock starts at the next spend.
    s.lastRegenAt = now;
    return;
  }
  const regrown = Math.floor((now - s.lastRegenAt) / POUCH_REGEN_MS);
  if (regrown <= 0) return;
  s.count = Math.min(POUCH_MAX, s.count + regrown);
  s.lastRegenAt = s.count >= POUCH_MAX ? now : s.lastRegenAt + regrown * POUCH_REGEN_MS;
}

function persist(s: PouchState): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
  } catch {
    // Memory mirror still gates this session.
  }
}

/** Letters currently held (after applying regeneration). */
export function pouchCount(now: number = Date.now()): number {
  return load(now).count;
}

/** Spend one letter. Returns false (and spends nothing) if the pouch is empty. */
export function spendLetter(now: number = Date.now()): boolean {
  const s = load(now);
  if (s.count < 1) return false;
  s.count -= 1;
  persist(s);
  return true;
}

/** Test-only: clear module memory (and storage unless keepStorage). */
export function __resetPouchForTests(opts?: { keepStorage?: boolean }): void {
  mem = null;
  if (!opts?.keepStorage) {
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      // ignore
    }
  }
}
