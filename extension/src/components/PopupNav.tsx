// ABOUTME: Top navigation bar for the extension popup home view.
// ABOUTME: Renders equal-width links that open full extension pages in a new tab.

import React from "react";
import { ReleasedFeature } from "./ReleasedFeature";
import "./PopupNav.scss";

export const WALKING_RECORD_PAGE = "walking-record.html";

interface Props {
  onNavigate: (path: string) => void;
}

function NavItem({
  label,
  path,
  onNavigate,
}: {
  label: string;
  path: string;
  onNavigate: (path: string) => void;
}) {
  return (
    <button
      type="button"
      className="popup-nav__item"
      onClick={(e) => {
        e.stopPropagation();
        onNavigate(path);
      }}
    >
      {label}
      <span className="popup-nav__arrow" aria-hidden>
        {"↗"}
      </span>
    </button>
  );
}

export function PopupNav({ onNavigate }: Props) {
  return (
    <nav className="popup-nav" aria-label="Extension pages">
      <NavItem label="portrait" path="portrait.html" onNavigate={onNavigate} />
      <NavItem
        label="history"
        path={WALKING_RECORD_PAGE}
        onNavigate={onNavigate}
      />
      <ReleasedFeature feature="SCRAPS">
        <NavItem label="scraps" path="scraps.html" onNavigate={onNavigate} />
      </ReleasedFeature>
    </nav>
  );
}
