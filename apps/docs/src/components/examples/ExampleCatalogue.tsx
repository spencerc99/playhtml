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
        {visibleExamples.length > 0 && (
          <section
            className={styles.resultGroup}
            aria-labelledby="examples-heading"
          >
            <h2 id="examples-heading" className={styles.groupTitle}>
              Examples
            </h2>
            <div className={styles.cardGrid}>
              {visibleExamples.map((example) => (
                <ExampleCard key={example.id} example={example} />
              ))}
            </div>
          </section>
        )}

        {visibleSites.length > 0 && (
          <section
            className={styles.resultGroup}
            aria-labelledby="sites-heading"
          >
            <h2 id="sites-heading" className={styles.groupTitle}>
              Community sites
            </h2>
            <div className={styles.cardGrid}>
              {visibleSites.map((site) => (
                <SiteCard key={site.id} site={site} />
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
