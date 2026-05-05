// ABOUTME: Interactive examples index for the docs examples page.
// ABOUTME: Filters registry entries and renders the selected example specimen.
import { type ReactNode, useMemo, useState } from "react";
import { PlayContext, playhtml } from "@playhtml/react";
import {
  exampleEntries,
  type ExampleEntry,
  type ExampleSource,
  type ExampleType,
} from "@/examples/example-registry";
import { InteractiveToggleDemo } from "@/components/react/InteractiveToggleDemo";
import { LampToggleDemo } from "@/components/react/LampToggleDemo";
import { DocsGuestbook } from "@/components/react/capability-demos/DocsGuestbook";
import { DocsSpinner } from "@/components/react/capability-demos/DocsSpinner";
import { DuplicateRabbitDemo } from "@/components/react/capability-demos/DuplicateRabbitDemo";
import { GrowBalloonDemo } from "@/components/react/capability-demos/GrowBalloonDemo";
import { HoverCursorColorsDemo } from "@/components/react/capability-demos/HoverCursorColorsDemo";
import { MoveHatCatDemo } from "@/components/react/capability-demos/MoveHatCatDemo";
import { SmileyRow } from "@/components/react/capability-demos/SmileyRow";
import { SpinWheelDemo } from "@/components/react/capability-demos/SpinWheelDemo";
import { LiveReactionsDemo } from "@/components/react/data-demos/LiveReactionsDemo";
import { OnlineIndicatorDemo } from "@/components/react/data-demos/OnlineIndicatorDemo";
import { RainSprinklerDemo } from "@/components/react/data-demos/RainSprinklerDemo";

const typeLabels: Record<ExampleType, string> = {
  capability: "Capability",
  data: "Data",
  presence: "Presence",
  event: "Event",
  react: "React",
};

const sourceLabels: Record<ExampleSource, string> = {
  docs: "Docs demo",
  react: "React example",
  "docs-and-react": "Docs + React",
};

const statusLabels: Record<ExampleEntry["status"], string> = {
  stable: "Stable",
  experimental: "Experimental",
  reference: "Reference",
};

function DocsPlayContextProvider({ children }: { children: ReactNode }) {
  const value = useMemo(
    () => ({
      setupPlayElements: () => playhtml.setupPlayElements(),
      dispatchPlayEvent: playhtml.dispatchPlayEvent,
      registerPlayEventListener: playhtml.registerPlayEventListener,
      removePlayEventListener: playhtml.removePlayEventListener,
      deleteElementData: playhtml.deleteElementData,
      hasSynced: true,
      isLoading: false,
      isProviderMissing: false,
      configureCursors: () => {},
      getMyPlayerIdentity: () => playhtml.cursorClient?.getMyPlayerIdentity() ?? null,
      triggerCursorAnimation: (
        stableId: string,
        animationClass: string,
        durationMs?: number,
      ) =>
        playhtml.cursorClient?.triggerCursorAnimation(
          stableId,
          animationClass,
          durationMs,
        ) ?? false,
      registerCursorZone: (element: HTMLElement, options?: any) => {
        playhtml.cursorClient?.registerZone(element, options);
      },
      unregisterCursorZone: (elementId: string) => {
        playhtml.cursorClient?.unregisterZone(elementId);
      },
      cursors: {
        allColors: playhtml.cursorClient?.getSnapshot().allColors ?? [],
        color: playhtml.cursorClient?.getSnapshot().color ?? "",
        name: playhtml.cursorClient?.getSnapshot().name,
      },
      cursorPresences: playhtml.cursorClient?.getCursorPresences() ?? new Map(),
    }),
    [],
  );

  return <PlayContext.Provider value={value}>{children}</PlayContext.Provider>;
}

function matchesEntry(
  entry: ExampleEntry,
  query: string,
  activeType: string,
): boolean {
  const haystack = [
    entry.name,
    entry.type,
    entry.status,
    entry.framework,
    entry.source,
    entry.description,
    ...entry.capabilities,
    ...entry.tags,
  ]
    .join(" ")
    .toLowerCase();

  return haystack.includes(query) && (activeType === "all" || entry.type === activeType);
}

function ExamplePreview({ entry }: { entry: ExampleEntry }) {
  if (entry.preview === "docs-toggle") {
    return (
      <div className="ph-example-preview ph-example-preview--compact">
        <InteractiveToggleDemo id="ph-example-index-toggle" />
      </div>
    );
  }

  if (entry.preview === "docs-lamp") {
    return (
      <div className="ph-example-preview ph-example-preview--lamp">
        <LampToggleDemo id="ph-example-index-lamp" />
      </div>
    );
  }

  if (entry.preview === "docs-move") {
    return (
      <div className="ph-example-preview">
        <MoveHatCatDemo />
      </div>
    );
  }

  if (entry.preview === "docs-grow") {
    return (
      <div className="ph-example-preview">
        <GrowBalloonDemo />
      </div>
    );
  }

  if (entry.preview === "docs-spin") {
    return (
      <div className="ph-example-preview">
        <SpinWheelDemo />
      </div>
    );
  }

  if (entry.preview === "docs-hover") {
    return (
      <div className="ph-example-preview">
        <HoverCursorColorsDemo />
      </div>
    );
  }

  if (entry.preview === "docs-duplicate") {
    return (
      <div className="ph-example-preview ph-example-preview--wide">
        <DuplicateRabbitDemo />
      </div>
    );
  }

  if (entry.preview === "docs-guestbook") {
    return (
      <div className="ph-example-preview ph-example-preview--wide">
        <DocsGuestbook />
      </div>
    );
  }

  if (entry.preview === "docs-spinner") {
    return (
      <div className="ph-example-preview">
        <DocsSpinner />
      </div>
    );
  }

  if (entry.preview === "docs-smiley") {
    return (
      <div className="ph-example-preview ph-example-preview--wide">
        <SmileyRow />
      </div>
    );
  }

  if (entry.preview === "docs-presence") {
    return (
      <div className="ph-example-preview ph-example-preview--compact">
        <OnlineIndicatorDemo />
      </div>
    );
  }

  if (entry.preview === "docs-rain") {
    return (
      <div className="ph-example-preview">
        <RainSprinklerDemo />
      </div>
    );
  }

  if (entry.preview === "docs-reactions") {
    return (
      <div className="ph-example-preview">
        <LiveReactionsDemo />
      </div>
    );
  }

  return (
    <div className="ph-example-preview ph-example-preview--static">
      <p>{entry.description}</p>
      <p>
        This is listed as a source example rather than mounted inline. Open the
        source to inspect the complete component.
      </p>
    </div>
  );
}

function ExampleSnippet({ entry }: { entry: ExampleEntry }) {
  const snippet = entry.html ?? entry.react;
  if (!snippet) return null;
  const label = entry.html ? "HTML" : "React";

  return (
    <div className="ph-example-code-block">
      <span>{label}</span>
      <pre className="ph-example-code">
        <code>{snippet}</code>
      </pre>
    </div>
  );
}

export function ExampleIndex() {
  const [query, setQuery] = useState("");
  const [activeType, setActiveType] = useState<string>("all");
  const [selectedSlug, setSelectedSlug] = useState(exampleEntries[0].slug);

  const normalizedQuery = query.trim().toLowerCase();
  const entries = useMemo(
    () =>
      exampleEntries.filter((entry) =>
        matchesEntry(entry, normalizedQuery, activeType),
      ),
    [activeType, normalizedQuery],
  );

  const selected =
    entries.find((entry) => entry.slug === selectedSlug) ??
    exampleEntries.find((entry) => entry.slug === selectedSlug) ??
    exampleEntries[0];

  const typeOptions = [
    "all",
    ...Array.from(new Set(exampleEntries.map((entry) => entry.type))),
  ];
  const hasPlayRecipe = Boolean(selected.playRecipeId);

  return (
    <div className="ph-example-index">
      <section className="ph-example-index__list" aria-label="Example index">
        <div
          className="ph-example-index__tabs"
          role="group"
          aria-label="Example type"
        >
          {typeOptions.map((type) => (
            <button
              key={type}
              type="button"
              className={type === activeType ? "is-active" : ""}
              aria-pressed={type === activeType}
              onClick={() => setActiveType(type)}
            >
              {type === "all" ? "All" : typeLabels[type as ExampleType]}
            </button>
          ))}
        </div>

        <label className="ph-example-index__search">
          <span>Filter examples</span>
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="filter by name, tag, or capability..."
          />
        </label>

        <div className="ph-example-table" role="list" aria-label="Examples">
          {entries.length === 0 ? (
            <p className="ph-example-empty">No examples match these filters.</p>
          ) : (
            entries.map((entry) => (
              <button
                key={entry.slug}
                type="button"
                role="listitem"
                className={
                  "ph-example-row" +
                  (entry.slug === selected.slug ? " is-selected" : "")
                }
                onClick={() => setSelectedSlug(entry.slug)}
              >
                <span className="ph-example-row__name">{entry.name}</span>
                <span className="ph-example-row__tags">
                  {entry.capabilities.slice(0, 2).map((capability) => (
                    <span key={capability}>{capability}</span>
                  ))}
                </span>
                <span className={`ph-example-status ph-example-status--${entry.status}`}>
                  {statusLabels[entry.status]}
                </span>
              </button>
            ))
          )}
        </div>

        <div className="ph-example-index__footer">
          <span>{entries.length} items</span>
          <button
            type="button"
            onClick={() => {
              setQuery("");
              setActiveType("all");
            }}
          >
            Clear filters
          </button>
        </div>
      </section>

      <section className="ph-example-specimen" aria-live="polite">
        <div className="ph-example-specimen__crumbs">
          examples <span aria-hidden="true">›</span> {selected.slug}
        </div>
        <div className="ph-example-specimen__head">
          <div>
            <p className="ph-example-specimen__type">{typeLabels[selected.type]}</p>
            <h2>{selected.name}</h2>
          </div>
          <span className={`ph-example-status ph-example-status--${selected.status}`}>
            {statusLabels[selected.status]}
          </span>
        </div>
        <p className="ph-example-specimen__description">{selected.description}</p>

        <DocsPlayContextProvider>
          <ExamplePreview entry={selected} />
        </DocsPlayContextProvider>

        <div className="ph-example-meta" aria-label="Example metadata">
          <span>{selected.framework}</span>
          <span>{sourceLabels[selected.source]}</span>
          {selected.capabilities.map((capability) => (
            <span key={capability}>{capability}</span>
          ))}
          {selected.tags.map((tag) => (
            <span key={tag}>{tag}</span>
          ))}
        </div>

        <ExampleSnippet entry={selected} />

        <div className="ph-example-actions" aria-label="Example links">
          {hasPlayRecipe && (
            <button
              type="button"
              className="ph-example-actions__primary"
              disabled
              title="This will link to the named /play recipe when editor recipes are implemented."
            >
              Open in /play
            </button>
          )}
          {selected.links.map((link) => (
            <a key={`${link.kind}-${link.href}`} href={link.href}>
              {link.label}
            </a>
          ))}
        </div>
      </section>
    </div>
  );
}
