// ABOUTME: Admin gate for walking-together — matches a specific name + cursor color.
// ABOUTME: Client-side only; this is a workshop convenience, not a security boundary.

const ADMIN_NAME = "spencer";
const ADMIN_COLOR = "#ffae00";

/** True when the player's name AND cursor color both match the admin identity. */
export function isAdmin(name?: string, color?: string): boolean {
  return (
    name?.toLowerCase() === ADMIN_NAME && color?.toLowerCase() === ADMIN_COLOR
  );
}
