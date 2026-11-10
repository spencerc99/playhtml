// ABOUTME: Renders the searchable catalogue of canonical examples, plus the newest community
// ABOUTME: sites from the Are.na channel. The full sites list lives in the playhtml.fun gallery.

import { useEffect, useMemo, useState } from "react";
import {
  ARENA_CONTENTS_URL,
  filterExamples,
  isArenaContentsResponse,
  mapArenaSites,
  type SiteSummary,
} from "./catalogue";
import type { CatalogueExampleSummary } from "./examples";
import styles from "./examples.module.css";

type ExampleCatalogueProps = {
  examples: readonly CatalogueExampleSummary[];
};

// The docs show one row of the newest sites. Everything else is in the gallery.
const GALLERY_URL = "https://playhtml.fun/gallery/";

// Counts the columns the responsive card grid currently resolves to, so the
// sites preview fills exactly one row at any width.
function useGridColumns(grid: HTMLElement | null): number {
  const [columns, setColumns] = useState(1);

  useEffect(() => {
    if (!grid) return;

    const measure = () => {
      const template = getComputedStyle(grid).gridTemplateColumns;
      const count = template.split(" ").filter(Boolean).length;
      setColumns(Math.max(1, count));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(grid);
    return () => observer.disconnect();
  }, [grid]);

  return columns;
}

function SearchIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="11" cy="11" r="6.5" />
      <path d="m16 16 4 4" />
    </svg>
  );
}

function ArrowIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M5 12h13M13 7l5 5-5 5" />
    </svg>
  );
}

function ExternalIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M14 5h5v5M19 5l-8 8" />
      <path d="M18 13v5H6V6h5" />
    </svg>
  );
}

function ExampleCard({ example }: { example: CatalogueExampleSummary }) {
  const labels = Array.from(
    new Set([...example.capabilities, ...example.tags]),
  ).slice(0, 3);

  return (
    <article className={styles.card} data-source="example">
      <div className={styles.cardBody}>
        <div className={styles.cardMeta}>
          <span className={`${styles.sourceBadge} ${styles.exampleBadge}`}>
            {example.kind === "recipe" ? "Recipe" : "Docs demo"}
          </span>
          <span className={styles.difficulty}>{example.difficulty}</span>
        </div>
        <h2 className={styles.cardTitle}>{example.title}</h2>
        <p className={styles.cardDescription}>{example.description}</p>
        {labels.length > 0 && (
          <ul className={styles.tagList} aria-label="Topics">
            {labels.map((label) => (
              <li key={label}>{label}</li>
            ))}
          </ul>
        )}
      </div>

      <div className={styles.cardActions}>
        <a
          className={`${styles.primaryAction} sl-link-button primary`}
          href={example.docsHref}
        >
          {example.kind === "recipe" ? "Open example" : "View demo"}
          <ArrowIcon />
        </a>
        {example.remixId && (
          <a
            className={`${styles.secondaryAction} sl-link-button secondary`}
            href={`/docs/play#id=${encodeURIComponent(example.remixId)}`}
          >
            Remix
          </a>
        )}
      </div>
    </article>
  );
}

// Mirrors the playhtml.fun gallery tile: the whole card links to the site.
function SiteCard({ site }: { site: SiteSummary }) {
  return (
    <a
      className={styles.siteTile}
      data-source="site"
      href={site.href}
      target="_blank"
      rel="noreferrer"
    >
      <span className={styles.siteShot}>
        {site.imageUrl ? (
          <img
            src={site.imageUrl}
            alt={site.imageAlt ?? `Screenshot of ${site.title}`}
            loading="lazy"
            referrerPolicy="no-referrer"
          />
        ) : null}
      </span>
      <span className={styles.siteText}>
        <b>{site.title}</b>
        {site.description && (
          <i className={styles.siteDesc}>{site.description}</i>
        )}
        {site.author && <span>by {site.author}</span>}
        <span className={styles.siteHost}>
          <span>{site.hostname}</span>
          <span aria-hidden="true">{"\u2197"}</span>
        </span>
      </span>
    </a>
  );
}

export function ExampleCatalogue({ examples }: ExampleCatalogueProps) {
  const [query, setQuery] = useState("");
  const [sites, setSites] = useState<SiteSummary[]>([]);
  const [sitesState, setSitesState] = useState<"loading" | "loaded" | "failed">(
    "loading",
  );
  // Callback ref, since the grid mounts only once the sites have loaded.
  const [sitesGrid, setSitesGrid] = useState<HTMLDivElement | null>(null);
  const siteColumns = useGridColumns(sitesGrid);

  useEffect(() => {
    const abortController = new AbortController();
    setSitesState("loading");

    async function loadSites() {
      try {
        const response = await fetch(ARENA_CONTENTS_URL, {
          signal: abortController.signal,
          headers: { Accept: "application/json" },
        });
        if (!response.ok) {
          throw new Error(`Are.na returned ${response.status}`);
        }

        const payload: unknown = await response.json();
        if (!isArenaContentsResponse(payload)) {
          throw new Error("Are.na returned an unexpected response");
        }
        if (!abortController.signal.aborted) {
          setSites(mapArenaSites(payload));
          setSitesState("loaded");
        }
      } catch {
        if (!abortController.signal.aborted) {
          setSitesState("failed");
        }
      }
    }

    void loadSites();
    return () => abortController.abort();
  }, []);

  const visibleExamples = useMemo(
    () => filterExamples(examples, query),
    [examples, query],
  );
  const newestSites = sites.slice(0, siteColumns);
  const showEmptyState = visibleExamples.length === 0;

  return (
    <section
      className={`${styles.catalogue} not-content`}
      aria-label="Examples catalogue"
    >
      {sitesState !== "failed" && (
        <section
          className={`${styles.resultGroup} ${styles.sitesBand}`}
          aria-labelledby="sites-heading"
        >
          <div className={styles.groupHeader}>
            <h2 id="sites-heading" className={styles.groupTitle}>
              From the gallery
            </h2>
            <a className={styles.showAll} href={GALLERY_URL}>
              See every site
              <ArrowIcon />
            </a>
          </div>
          <p className={styles.sitesIntro}>
            Sites people made with playhtml. We collect them in the{" "}
            <a href={GALLERY_URL}>playhtml.fun gallery</a>; the newest show
            here.
          </p>
          {sitesState === "loading" ? (
            <p className={styles.sitesStatus} role="status">
              Loading sites…
            </p>
          ) : (
            <div ref={setSitesGrid} className={styles.siteGrid}>
              {newestSites.map((site) => (
                <SiteCard key={site.id} site={site} />
              ))}
            </div>
          )}
        </section>
      )}

      <div className={styles.controls}>
        <label className={styles.searchLabel}>
          <span>Search examples</span>
          <span className={styles.searchField}>
            <SearchIcon />
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.currentTarget.value)}
              placeholder="Try sound, physics, can-move…"
              aria-controls="examples-catalogue-results"
            />
          </span>
        </label>
      </div>

      <div id="examples-catalogue-results" className={styles.resultGroups}>
        {visibleExamples.length > 0 && (
          <section
            className={styles.resultGroup}
            aria-labelledby="examples-heading"
          >
            <div className={styles.groupHeader}>
              <h2 id="examples-heading" className={styles.groupTitle}>
                Examples
              </h2>
              <p className={styles.resultCount} aria-live="polite">
                {visibleExamples.length}{" "}
                {visibleExamples.length === 1 ? "example" : "examples"}
              </p>
            </div>
            <div className={styles.cardGrid}>
              {visibleExamples.map((example) => (
                <ExampleCard key={example.id} example={example} />
              ))}
            </div>
          </section>
        )}
      </div>

      {showEmptyState && (
        <div className={styles.emptyState}>
          <strong>No examples found.</strong>
          <span>Try another search.</span>
        </div>
      )}
    </section>
  );
}
