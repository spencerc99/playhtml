// ABOUTME: Stores the Worker admin key in this browser for WWO operator pages.
// ABOUTME: Framework-free so non-React pages (the internet map) can share the sign-in.

const TOKEN_STORAGE_KEY = "wwo-admin-token";
const TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export function saveAdminToken(token: string) {
  localStorage.setItem(TOKEN_STORAGE_KEY, JSON.stringify({ token, expiresAt: Date.now() + TOKEN_TTL_MS }));
}

// Each visit pushes the expiry out again, so regular use never signs you out.
export function loadAdminToken(): string {
  const raw = localStorage.getItem(TOKEN_STORAGE_KEY);
  if (!raw) return "";
  try {
    const stored = JSON.parse(raw) as { token?: unknown; expiresAt?: unknown };
    if (typeof stored.token === "string" && typeof stored.expiresAt === "number" && stored.expiresAt > Date.now()) {
      saveAdminToken(stored.token);
      return stored.token;
    }
  } catch {
    // Unreadable entry: treat as signed out.
  }
  localStorage.removeItem(TOKEN_STORAGE_KEY);
  return "";
}

export function clearAdminToken() {
  localStorage.removeItem(TOKEN_STORAGE_KEY);
}
