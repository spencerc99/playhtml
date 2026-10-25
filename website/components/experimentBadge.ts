// ABOUTME: Mounts a floating playhtml logo badge that marks a page as an experiment.
// ABOUTME: Clicking it opens a mini about card linking to playhtml, the docs, and the source.

import "./experimentBadge.scss";
import {
  findExperiment,
  type ExperimentCatalogEntry,
} from "../utils/experimentsCatalog";

export type ExperimentBadgePosition =
  | "bottom-right"
  | "bottom-left"
  | "top-right"
  | "top-left";

export interface ExperimentBadgeOptions {
  // Catalog number such as "EX-04". Unknown numbers still render a generic card.
  experiment: string;
  position?: ExperimentBadgePosition;
  // Distance from the viewport edges, as any CSS length.
  offset?: string;
}

const RepoUrl = "https://github.com/spencerc99/playhtml";
const BadgeSelector = "[data-playhtml-experiment-badge]";
const FontsUrl =
  "https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:wght@700&family=IBM+Plex+Mono:wght@500&family=Play:wght@400;700&display=swap";
const CodeIcon =
  '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 7l-5 5 5 5"/><path d="M16 7l5 5-5 5"/><path d="M13.5 5l-3 14"/></svg>';

function sourceUrl(entry: ExperimentCatalogEntry | undefined): string {
  if (!entry?.sourcePath) return `${RepoUrl}/tree/main/website/experiments`;
  const kind = entry.sourcePath.includes(".") ? "blob" : "tree";
  return `${RepoUrl}/${kind}/main/website/${entry.sourcePath}`;
}

function element<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function link(label: string, href: string, className: string) {
  const anchor = element("a", className, label);
  anchor.href = href;
  if (/^https?:\/\//.test(href)) {
    anchor.target = "_blank";
    anchor.rel = "noopener";
  }
  return anchor;
}

// Experiments load their own fonts, so the badge brings the playhtml site
// faces (shared with the homepage and docs) itself.
function loadBadgeFonts() {
  if (document.querySelector(`link[href="${FontsUrl}"]`)) return;
  const fonts = document.createElement("link");
  fonts.rel = "stylesheet";
  fonts.href = FontsUrl;
  document.head.append(fonts);
}

export function mountExperimentBadge({
  experiment,
  position = "bottom-right",
  offset,
}: ExperimentBadgeOptions): () => void {
  const existing = document.querySelector<HTMLElement>(BadgeSelector);
  if (existing) return () => existing.remove();

  loadBadgeFonts();
  const entry = findExperiment(experiment);
  const badge = element(
    "aside",
    `playhtml-experiment-badge playhtml-experiment-badge--${position}`,
  );
  badge.dataset.playhtmlExperimentBadge = "";
  badge.setAttribute("aria-label", "playhtml experiment");
  if (offset) badge.style.setProperty("--badge-offset", offset);

  const panelId = "playhtml-experiment-badge-panel";
  const panel = element("section", "playhtml-experiment-badge__panel");
  panel.id = panelId;
  panel.hidden = true;
  panel.setAttribute("aria-label", "About this experiment");

  const body = element("div", "playhtml-experiment-badge__body");
  const meta = element("div", "playhtml-experiment-badge__meta");
  const title = element(
    "h2",
    "playhtml-experiment-badge__title",
    entry?.name ?? "an experiment",
  );
  meta.append(
    title,
    element(
      "span",
      "playhtml-experiment-badge__chip",
      entry?.number ?? experiment,
    ),
  );
  body.append(meta);
  if (entry?.description) {
    body.append(
      element("p", "playhtml-experiment-badge__description", entry.description),
    );
  }
  if (entry?.related) {
    const related = element("p", "playhtml-experiment-badge__related");
    related.append(
      link(
        entry.related.label,
        entry.related.href,
        "playhtml-experiment-badge__inline",
      ),
    );
    body.append(related);
  }

  const about = element("p", "playhtml-experiment-badge__about");
  about.append(
    "Experiments in making the web feel more shared and alive, using ",
    link("playhtml", "/", "playhtml-experiment-badge__inline"),
    ", an open-source tool for making communal websites.",
  );
  body.append(about);

  const credit = element("p", "playhtml-experiment-badge__credit");
  credit.append(
    "by ",
    link(
      "spencer",
      "https://spencer.place/",
      "playhtml-experiment-badge__inline",
    ),
  );
  body.append(credit);

  const bar = element("div", "playhtml-experiment-badge__bar");
  const links = element("nav", "playhtml-experiment-badge__links");
  links.setAttribute("aria-label", "playhtml links");
  links.append(
    link("home", "/", "playhtml-experiment-badge__link"),
    link(
      "experiments",
      "/#experiments-index",
      "playhtml-experiment-badge__link",
    ),
    link("docs", "/docs/", "playhtml-experiment-badge__link"),
  );
  const source = link(
    "",
    sourceUrl(entry),
    "playhtml-experiment-badge__source",
  );
  source.setAttribute("aria-label", "View source on GitHub");
  source.title = "View source";
  source.innerHTML = CodeIcon;
  bar.append(links, source);
  panel.append(body, bar);

  const toggle = element("button", "playhtml-experiment-badge__toggle");
  toggle.type = "button";
  toggle.setAttribute("aria-expanded", "false");
  toggle.setAttribute("aria-controls", panelId);
  toggle.title = "About this playhtml experiment";
  const logo = element("img", "playhtml-experiment-badge__logo");
  logo.src = "/playhtml-logo.png";
  logo.alt = "playhtml";
  logo.width = 48;
  logo.height = 48;
  logo.draggable = false;
  toggle.append(logo);
  if (entry) {
    toggle.append(
      element("span", "playhtml-experiment-badge__number", entry.number),
    );
  }

  function setOpen(open: boolean) {
    panel.hidden = !open;
    toggle.setAttribute("aria-expanded", String(open));
    badge.classList.toggle("is-open", open);
  }

  toggle.addEventListener("click", () => setOpen(panel.hidden));
  const handlePointerDown = (event: PointerEvent) => {
    if (!panel.hidden && !badge.contains(event.target as Node)) setOpen(false);
  };
  const handleKeyDown = (event: KeyboardEvent) => {
    if (event.key === "Escape" && !panel.hidden) {
      setOpen(false);
      toggle.focus();
    }
  };
  document.addEventListener("pointerdown", handlePointerDown);
  document.addEventListener("keydown", handleKeyDown);

  badge.append(panel, toggle);
  document.body.append(badge);

  return () => {
    document.removeEventListener("pointerdown", handlePointerDown);
    document.removeEventListener("keydown", handleKeyDown);
    badge.remove();
  };
}
