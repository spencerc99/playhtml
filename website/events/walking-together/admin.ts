// ABOUTME: Admin gate for walking-together — matches the player's public key (pid).
// ABOUTME: Client-side only; this is a workshop convenience, not a security boundary.

// Spencer's extension identity, the same key the fridge uses for its owner.
const ADMIN_PIDS = new Set([
  "pk_04934976d2bc13f0a3a1e62a9124a3edb1e236b2eef64b618c646e25e3ade8ec77d2b56bedb39b78150d141be1b6b41a85b86010930941e02e82e96ce61af35d53",
]);

/** True when the player's pid is on the admin list. Names and colors are self-chosen, so they never grant admin. */
export function isAdmin(pid?: string): boolean {
  return !!pid && ADMIN_PIDS.has(pid);
}
