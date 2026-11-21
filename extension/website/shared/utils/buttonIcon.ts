// ABOUTME: Lays out the icons a button scrap carries, beside its text, the way its page did.
// ABOUTME: Shared by the scraps tray, the lightbox, and the baked collage so all three agree.

/**
 * Whether the icon was captured with its size in ems of the button's text.
 * Newer captures are; older ones carry pixel sizes and are drawn in a 1em box.
 */
export function iconSizedInEms(markup: string): boolean {
  const root = /^\s*<svg\b[^>]*>/i.exec(markup)?.[0] ?? "";
  return /\swidth="[\d.]+em"/i.test(root) && /\sheight="[\d.]+em"/i.test(root);
}

/** The space an older capture, which recorded no gap, leaves beside its icon. */
const LEGACY_ICON_GAP = "0.45em";

/**
 * Inline styles for the box holding a button's icon. An em-sized icon keeps
 * its own size; the button's captured `columnGap` spaces it from the text.
 * An older capture is drawn in a 1em square with a fixed gap.
 */
export function buttonIconStyle(
  markup: string,
  side: "leading" | "trailing",
  hasText: boolean,
  styles: Record<string, string>,
): Record<string, string> {
  const base: Record<string, string> = {
    display: "inline-flex",
    flex: "0 0 auto",
    alignItems: "center",
  };
  if (iconSizedInEms(markup)) return base;
  const legacy: Record<string, string> = {
    ...base,
    width: "1em",
    height: "1em",
  };
  if (hasText && !styles.columnGap) {
    legacy[side === "leading" ? "marginRight" : "marginLeft"] = LEGACY_ICON_GAP;
  }
  return legacy;
}
