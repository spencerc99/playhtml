// ABOUTME: Admin gate for walking-together — key-based via the "admin" role from
// ABOUTME: /.well-known/playhtml.json, with the legacy name+color match as fallback.

const ADMIN_NAME = "spencer";
const ADMIN_COLOR = "#ffae00";

/**
 * True when the player holds the admin key (the "admin" role published in the
 * domain's /.well-known/playhtml.json — server-verified key ownership), OR
 * matches the legacy name+color convention.
 *
 * Pass `roles` from `usePlayerIdentity()`. The legacy fallback remains so
 * sessions keep working until the admin pk lands in the well-known file; it
 * is client-side only and not a security boundary. Once the key path is in
 * use, delete the fallback.
 */
export function isAdmin(
  name?: string,
  color?: string,
  roles: string[] = [],
): boolean {
  if (roles.includes("admin")) return true;
  return (
    name?.toLowerCase() === ADMIN_NAME && color?.toLowerCase() === ADMIN_COLOR
  );
}
