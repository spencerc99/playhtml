// ABOUTME: Shared navigation for the extension's standalone portrait and history pages.
// ABOUTME: Keeps page links consistent while hiding unfinished surfaces behind their feature gate.

import React from "react";
import browser from "webextension-polyfill";
import "@fontsource/martian-mono/latin-400.css";
import "@fontsource/source-serif-4/latin-200-italic.css";
import { isFeatureReleased } from "./ReleasedFeature";
import "./ExtensionPageNav.scss";

export type ExtensionPageId = "portrait" | "time" | "walking-record" | "scraps";

const PAGE_LINKS: Array<{
  id: ExtensionPageId;
  label: string;
  path: string;
}> = [
  { id: "portrait", label: "portrait", path: "portrait.html" },
  { id: "time", label: "time", path: "stats.html" },
  { id: "walking-record", label: "history", path: "newtab.html" },
  { id: "scraps", label: "scraps", path: "scraps.html" },
];

export function ExtensionPageNav({
  currentPage,
}: {
  currentPage: ExtensionPageId;
}) {
  const visibleLinks = PAGE_LINKS.filter(
    (link) => link.id !== "scraps" || isFeatureReleased("SCRAPS"),
  );

  return (
    <div className="extension-page-nav">
      <span className="extension-page-nav__wordmark">we were online</span>
      <nav className="extension-page-nav__links" aria-label="Extension pages">
        {visibleLinks.map((link) =>
          link.id === currentPage ? (
            <span aria-current="page" key={link.id}>
              {link.label}
            </span>
          ) : (
            <a href={browser.runtime.getURL(link.path)} key={link.id}>
              {link.label}
            </a>
          ),
        )}
      </nav>
    </div>
  );
}
