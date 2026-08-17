// ABOUTME: Top navigation bar for the extension popup home view.
// ABOUTME: Renders links to the standalone extension pages as a bar, bare links, or icons.

import React from "react";
import { isFeatureReleased } from "./ReleasedFeature";
import { FrameSvg, PathSvg, TornPaperSvg } from "./icons";
import "./PopupNav.scss";

export const WALKING_RECORD_PAGE = "walking-record.html";

/**
 * bar     — full-width segmented bar
 * inline  — bare mono links, for a tight header row
 * compact — bare links with the arrows dropped and type tightened, fits 3+
 * icon    — glyph-only buttons, scales past 3 items
 */
export type PopupNavVariant = "bar" | "inline" | "compact" | "icon";

interface Props {
  onNavigate: (path: string) => void;
  variant?: PopupNavVariant;
  /** Preview escape hatch: render gated items regardless of their flag. */
  forceAllItems?: boolean;
}

interface NavEntry {
  label: string;
  path: string;
  icon: React.ComponentType<{ size?: number }>;
  /** Hidden until this feature ships. */
  gated?: boolean;
}

const NAV_ENTRIES: NavEntry[] = [
  { label: "portrait", path: "portrait.html", icon: FrameSvg },
  { label: "history", path: WALKING_RECORD_PAGE, icon: PathSvg },
  { label: "scraps", path: "scraps.html", icon: TornPaperSvg, gated: true },
];

function NavItem({
  entry,
  variant,
  onNavigate,
}: {
  entry: NavEntry;
  variant: PopupNavVariant;
  onNavigate: (path: string) => void;
}) {
  const { label, path, icon: Icon } = entry;
  const isIcon = variant === "icon";

  return (
    <button
      type="button"
      className="popup-nav__item"
      title={isIcon ? label : undefined}
      aria-label={isIcon ? label : undefined}
      onClick={(e) => {
        e.stopPropagation();
        onNavigate(path);
      }}
    >
      {isIcon ? (
        <Icon size={16} />
      ) : (
        <>
          {label}
          {variant !== "compact" && (
            <span className="popup-nav__arrow" aria-hidden>
              {"↗"}
            </span>
          )}
        </>
      )}
    </button>
  );
}

export function PopupNav({
  onNavigate,
  variant = "bar",
  forceAllItems = false,
}: Props) {
  const entries = NAV_ENTRIES.filter(
    (entry) => !entry.gated || forceAllItems || isFeatureReleased("SCRAPS"),
  );

  return (
    <nav
      className={`popup-nav popup-nav--${variant}`}
      aria-label="Extension pages"
    >
      {entries.map((entry) => (
        <NavItem
          key={entry.label}
          entry={entry}
          variant={variant}
          onNavigate={onNavigate}
        />
      ))}
    </nav>
  );
}
