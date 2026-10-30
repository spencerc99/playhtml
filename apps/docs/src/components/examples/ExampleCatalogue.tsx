// ABOUTME: Renders the searchable catalogue of canonical examples and external sites.
// ABOUTME: Loads the curated Are.na channel without blocking repo-owned examples.

import { useEffect, useMemo, useState } from "react";
import {
  ARENA_CHANNEL_URL,
  ARENA_CONTENTS_URL,
  filterExamples,
  filterSites,
  isArenaContentsResponse,
  mapArenaSites,
  type SiteSummary,
  type SourceFilter,
} from "./catalogue";
import type { CatalogueExampleSummary } from "./examples";
import styles from "./examples.module.css";

type ExampleCatalogueProps = {
  examples: readonly CatalogueExampleSummary[];
};

// On "All" with no search, each section previews whole rows so both kinds of
// results are visible at a glance; "Show all" expands the section in place.
// Site cards carry a screenshot and run tall, so they preview one row.
const SITE_PREVIEW_ROWS = 1;
const EXAMPLE_PREVIEW_ROWS = 2;

// Counts the columns the responsive card grid currently resolves to, so a
// preview can fill whole rows at any width.
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

function ShowAllButton({
  expanded,
  total,
  onToggle,
}: {
  expanded: boolean;
  total: number;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      className={styles.showAll}
      aria-expanded={expanded}
      onClick={onToggle}
    >
      {expanded ? "Show less" : `Show all ${total}`}
      {!expanded && <ArrowIcon />}
    </button>
  );
}

const SOURCE_FILTERS: Array<{ value: SourceFilter; label: string }> = [
  { value: "all", label: "All" },
  { value: "examples", label: "Examples" },
  { value: "sites", label: "Sites" },
];

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

function SiteCard({ site }: { site: SiteSummary }) {
  return (
    <article className={styles.card} data-source="site">
      <div className={styles.siteMedia}>
        {site.imageUrl ? (
          <img
            src={site.imageUrl}
            alt={site.imageAlt ?? ""}
            loading="lazy"
            referrerPolicy="no-referrer"
          />
        ) : (
          <span className={styles.sitePlaceholder}>{site.hostname}</span>
        )}
      </div>

      <div className={styles.cardBody}>
        <div className={styles.cardMeta}>
          <span className={`${styles.sourceBadge} ${styles.siteBadge}`}>
            Site
          </span>
          <span className={styles.hostname}>{site.hostname}</span>
        </div>
        <h2 className={styles.cardTitle}>{site.title}</h2>
        {site.author && <p className={styles.author}>by {site.author}</p>}
        {site.description && (
          <p className={styles.cardDescription}>{site.description}</p>
        )}
      </div>

      <div className={styles.cardActions}>
        <a
          className={`${styles.primaryAction} sl-link-button primary`}
          href={site.href}
          target="_blank"
          rel="noreferrer"
        >
          Visit site
          <ExternalIcon />
        </a>
      </div>
    </article>
  );
}

export function ExampleCatalogue({ examples }: ExampleCatalogueProps) {
  const [query, setQuery] = useState("");
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>("all");
  const [sites, setSites] = useState<SiteSummary[]>([]);
  const [sitesState, setSitesState] = useState<"loading" | "loaded" | "failed">(
    "loading",
  );
  const [requestVersion, setRequestVersion] = useState(0);
  const [sitesExpanded, setSitesExpanded] = useState(false);
  const [examplesExpanded, setExamplesExpanded] = useState(false);
  // Callback refs, since each grid mounts only once its results exist.
  const [sitesGrid, setSitesGrid] = useState<HTMLDivElement | null>(null);
  const [examplesGrid, setExamplesGrid] = useState<HTMLDivElement | null>(null);
  const siteColumns = useGridColumns(sitesGrid);
  const exampleColumns = useGridColumns(examplesGrid);

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
  }, [requestVersion]);

  const visibleExamples = useMemo(
    () => (sourceFilter === "sites" ? [] : filterExamples(examples, query)),
    [examples, query, sourceFilter],
  );
  const visibleSites = useMemo(
    () => (sourceFilter === "examples" ? [] : filterSites(sites, query)),
    [query, sites, sourceFilter],
  );
  const resultCount = visibleExamples.length + visibleSites.length;
  const isPreview = sourceFilter === "all" && query.trim() === "";
  const sitePreviewCount = siteColumns * SITE_PREVIEW_ROWS;
  const examplePreviewCount = exampleColumns * EXAMPLE_PREVIEW_ROWS;
  const sitesCollapsible = isPreview && visibleSites.length > sitePreviewCount;
  const examplesCollapsible =
    isPreview && visibleExamples.length > examplePreviewCount;
  const shownSites =
    sitesCollapsible && !sitesExpanded
      ? visibleSites.slice(0, sitePreviewCount)
      : visibleSites;
  const shownExamples =
    examplesCollapsible && !examplesExpanded
      ? visibleExamples.slice(0, examplePreviewCount)
      : visibleExamples;
  const sitesAreVisible = sourceFilter !== "examples";
  const showEmptyState =
    resultCount === 0 && !(sitesAreVisible && sitesState === "loading");

  return (
    <section
      className={`${styles.catalogue} not-content`}
      aria-label="Examples catalogue"
    >
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

        <fieldset
          className={styles.filters}
          aria-labelledby="examples-source-label"
        >
          <span id="examples-source-label" className={styles.filterLabel}>
            Source
          </span>
          <div className={styles.filterButtons}>
            {SOURCE_FILTERS.map((filter) => (
              <button
                key={filter.value}
                type="button"
                aria-pressed={sourceFilter === filter.value}
                onClick={() => setSourceFilter(filter.value)}
              >
                {filter.label}
              </button>
            ))}
          </div>
        </fieldset>
      </div>

      <div className={styles.resultsHeader}>
        <p className={styles.resultCount} aria-live="polite">
          {resultCount} {resultCount === 1 ? "result" : "results"}
        </p>
        <p className={styles.attribution}>
          Sites are curated on{" "}
          <a href={ARENA_CHANNEL_URL} target="_blank" rel="noreferrer">
            Are.na
            <ExternalIcon />
          </a>
        </p>
      </div>

      {sitesAreVisible && sitesState === "loading" && (
        <p className={styles.sitesStatus} role="status">
          Loading sites from Are.na…
        </p>
      )}

      {sitesAreVisible && sitesState === "failed" && (
        <aside className={styles.sitesError}>
          <div>
            <strong>Sites could not load.</strong>
            <span>The examples in these docs are still available.</span>
          </div>
          <div className={styles.errorActions}>
            <button
              type="button"
              onClick={() => setRequestVersion((v) => v + 1)}
            >
              Try again
            </button>
            <a href={ARENA_CHANNEL_URL} target="_blank" rel="noreferrer">
              Browse on Are.na
              <ExternalIcon />
            </a>
          </div>
        </aside>
      )}

      <div id="examples-catalogue-results" className={styles.resultGroups}>
        {visibleSites.length > 0 && (
          <section
            className={styles.resultGroup}
            aria-labelledby="sites-heading"
          >
            <div className={styles.groupHeader}>
              <h2 id="sites-heading" className={styles.groupTitle}>
                Community sites
              </h2>
              {sitesCollapsible && (
                <ShowAllButton
                  expanded={sitesExpanded}
                  total={visibleSites.length}
                  onToggle={() => setSitesExpanded((value) => !value)}
                />
              )}
            </div>
            <div ref={setSitesGrid} className={styles.cardGrid}>
              {shownSites.map((site) => (
                <SiteCard key={site.id} site={site} />
              ))}
            </div>
          </section>
        )}

        {visibleExamples.length > 0 && (
          <section
            className={styles.resultGroup}
            aria-labelledby="examples-heading"
          >
            <div className={styles.groupHeader}>
              <h2 id="examples-heading" className={styles.groupTitle}>
                Examples
              </h2>
              {examplesCollapsible && (
                <ShowAllButton
                  expanded={examplesExpanded}
                  total={visibleExamples.length}
                  onToggle={() => setExamplesExpanded((value) => !value)}
                />
              )}
            </div>
            <div ref={setExamplesGrid} className={styles.cardGrid}>
              {shownExamples.map((example) => (
                <ExampleCard key={example.id} example={example} />
              ))}
            </div>
          </section>
        )}
      </div>

      {showEmptyState && (
        <div className={styles.emptyState}>
          <strong>No examples found.</strong>
          <span>Try another search or source.</span>
        </div>
      )}
    </section>
  );
}
