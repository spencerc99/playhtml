// ABOUTME: Provides shared room path normalization for client room derivation.
// ABOUTME: Keeps permission path checks aligned with provider room IDs.

export function normalizePathname(pathname: string): string {
  return pathname.replace(/\.[^/.]+$/, "");
}
