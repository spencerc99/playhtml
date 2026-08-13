// ABOUTME: Renders the live Internet Commute destination review workbench.
// ABOUTME: Joins sanitized route candidates with shadow inspection and local decisions.

import React, {
  FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createRoot } from "react-dom/client";
import {
  COMMUTE_RECENT_URL,
  COMMUTE_REVIEW_URL,
  PAGE_INSPECTION_URL,
} from "@movement/config";
import {
  createCuratedPlace,
  CURATION_STORAGE_KEY,
  CURATION_VERDICTS,
  type CommuteReviewItem,
  type CommuteReviewResponse,
  type CuratedPlace,
  type CurationScope,
  type CurationVerdict,
  getDecisionForReviewItem,
  getReviewTarget,
  parseCommuteReviewResponse,
  parseStoredCuration,
  type PublicPageInspection,
  serializeCurationArtifact,
  upsertCuratedPlace,
} from "./curation";
import "./style.scss";

const VERDICT_LABELS: Record<CurationVerdict, string> = {
  promoted: "Promoted stop",
  "scenery-only": "Scenery only",
  blocked: "Blocked",
};

const SCOPE_LABELS: Record<CurationScope, string> = {
  page: "Exact page",
  hostname: "This hostname",
  site: "Entire site",
};
const CURATION_SCOPES: CurationScope[] = ["page", "hostname", "site"];

const INSPECTION_LABELS: Record<PublicPageInspection["verdict"], string> = {
  public: "Public page",
  gated: "Account gated",
  not_public: "Not public",
  unavailable: "Unavailable",
  unknown: "Unknown",
};

const ROUTE_LABELS: Record<CommuteReviewItem["currentDisposition"], string> = {
  stop: "Stop candidate",
  scenery: "Scenery only",
};

type StatusIconKind =
  | CurationVerdict
  | CommuteReviewItem["currentDisposition"]
  | PublicPageInspection["verdict"]
  | "note"
  | "loading";

function StatusIcon({ kind }: { kind: StatusIconKind }) {
  const iconKind =
    kind === "promoted"
      ? "stop"
      : kind === "scenery-only"
        ? "scenery"
        : kind;

  return (
    <svg
      className="status-icon"
      viewBox="0 0 24 24"
      aria-hidden="true"
    >
      {iconKind === "stop" && (
        <>
          <circle cx="12" cy="9" r="5.5" />
          <circle cx="12" cy="9" r="1.8" className="status-icon__fill" />
          <path d="M12 14.5V21M8.5 21h7" />
        </>
      )}
      {iconKind === "scenery" && (
        <>
          <rect x="3" y="4" width="18" height="16" rx="1" />
          <path d="m5.5 17 4.2-5 3.1 3.2 2.4-2.7 3.3 4.5M16.5 8h.01" />
        </>
      )}
      {(iconKind === "blocked" || iconKind === "not_public") && (
        <>
          <circle cx="12" cy="12" r="8.5" />
          <path d="m6 18 12-12" />
        </>
      )}
      {iconKind === "public" && <path d="m4.5 12 4.5 4.5L19.5 6" />}
      {iconKind === "gated" && (
        <>
          <rect x="5" y="10" width="14" height="10" rx="1" />
          <path d="M8 10V7.5a4 4 0 0 1 8 0V10M12 14v2" />
        </>
      )}
      {iconKind === "unavailable" && (
        <>
          <path d="M4 8h16M4 16h16M8 4v16M16 4v16" />
          <path d="m5 19 14-14" />
        </>
      )}
      {iconKind === "unknown" && (
        <>
          <circle cx="12" cy="12" r="9" />
          <path d="M9.5 9a2.6 2.6 0 1 1 3.2 2.5c-.7.3-.7.8-.7 1.5M12 17h.01" />
        </>
      )}
      {iconKind === "note" && (
        <>
          <path d="M5 4h14v12H9l-4 4V4Z" />
          <path d="M8 8h8M8 12h5" />
        </>
      )}
      {iconKind === "loading" && (
        <path d="M12 3a9 9 0 1 1-8.2 5.3" />
      )}
    </svg>
  );
}

function verdictTone(verdict: CurationVerdict): string {
  if (verdict === "promoted") return "green";
  if (verdict === "scenery-only") return "blue";
  return "orange";
}

function inspectionTone(
  verdict: PublicPageInspection["verdict"],
): string {
  if (verdict === "public") return "green";
  if (verdict === "unknown") return "blue";
  if (verdict === "unavailable") return "neutral";
  return "orange";
}

type InspectionState =
  | { status: "loading" }
  | { status: "ready"; inspection: PublicPageInspection }
  | { status: "missing" }
  | { status: "error" };

function loadPlaces(): CuratedPlace[] {
  return parseStoredCuration(localStorage.getItem(CURATION_STORAGE_KEY));
}

function relativeTime(timestamp: number): string {
  const elapsedSeconds = Math.max(
    0,
    Math.round((Date.now() - timestamp) / 1_000),
  );
  if (elapsedSeconds < 60) return `${elapsedSeconds}s ago`;
  const elapsedMinutes = Math.round(elapsedSeconds / 60);
  if (elapsedMinutes < 60) return `${elapsedMinutes}m ago`;
  const elapsedHours = Math.round(elapsedMinutes / 60);
  if (elapsedHours < 24) return `${elapsedHours}h ago`;
  return `${Math.round(elapsedHours / 24)}d ago`;
}

export function App() {
  const [places, setPlaces] = useState<CuratedPlace[]>(loadPlaces);
  const [reviewItems, setReviewItems] = useState<CommuteReviewItem[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [queueStatus, setQueueStatus] = useState<"loading" | "ready" | "error">(
    "loading",
  );
  const [queueGeneratedAt, setQueueGeneratedAt] = useState<number | null>(null);
  const [scope, setScope] = useState<CurationScope>("hostname");
  const [verdict, setVerdict] = useState<CurationVerdict | undefined>();
  const [comment, setComment] = useState("");
  const [inspectionById, setInspectionById] = useState(
    new Map<string, InspectionState>(),
  );
  const requestedInspectionIds = useRef(new Set<string>());
  const [copyState, setCopyState] = useState("Copy artifact");
  const [showReviewed, setShowReviewed] = useState(false);

  const visibleItems = useMemo(
    () =>
      showReviewed
        ? reviewItems
        : reviewItems.filter((item) => !getDecisionForReviewItem(places, item)),
    [places, reviewItems, showReviewed],
  );
  const selectedItem = useMemo(
    () =>
      visibleItems.find((item) => item.id === selectedId) ??
      visibleItems[0] ??
      null,
    [selectedId, visibleItems],
  );
  const counts = useMemo(
    () =>
      Object.fromEntries(
        CURATION_VERDICTS.map((value) => [
          value,
          places.filter((place) => place.verdict === value).length,
        ]),
      ) as Record<CurationVerdict, number>,
    [places],
  );
  const artifact = useMemo(
    () => serializeCurationArtifact(places, new Date().toISOString()),
    [places],
  );

  const loadQueue = useCallback(async () => {
    setQueueStatus("loading");
    try {
      const response = await fetch(COMMUTE_REVIEW_URL ?? COMMUTE_RECENT_URL, {
        headers: { Accept: "application/json" },
      });
      if (!response.ok)
        throw new Error(`Commute route returned ${response.status}`);
      const payload: CommuteReviewResponse = parseCommuteReviewResponse(
        await response.json(),
      );
      setReviewItems(payload.items);
      setQueueGeneratedAt(payload.generatedAt);
      setSelectedId((current) =>
        payload.items.some((item) => item.id === current)
          ? current
          : (payload.items[0]?.id ?? null),
      );
      setQueueStatus("ready");
    } catch {
      setQueueStatus("error");
    }
  }, []);

  useEffect(() => {
    void loadQueue();
  }, [loadQueue]);

  useEffect(() => {
    if (!selectedItem) return;
    const priorDecision = getDecisionForReviewItem(places, selectedItem);
    setScope(priorDecision?.scope ?? "hostname");
    setVerdict(priorDecision?.verdict);
    setComment(priorDecision?.comment ?? "");
  }, [places, selectedItem]);

  useEffect(() => {
    if (
      !selectedItem?.url ||
      requestedInspectionIds.current.has(selectedItem.id)
    ) {
      return;
    }
    requestedInspectionIds.current.add(selectedItem.id);
    setInspectionById((current) =>
      new Map(current).set(selectedItem.id, { status: "loading" }),
    );

    void fetch(
      `${PAGE_INSPECTION_URL}?url=${encodeURIComponent(selectedItem.url)}`,
      {
        headers: { Accept: "application/json" },
      },
    )
      .then(async (response) => {
        if (!response.ok)
          throw new Error(`Page inspection returned ${response.status}`);
        const payload = (await response.json()) as {
          inspection?: PublicPageInspection;
        };
        setInspectionById((current) =>
          new Map(current).set(
            selectedItem.id,
            payload.inspection
              ? { status: "ready", inspection: payload.inspection }
              : { status: "missing" },
          ),
        );
      })
      .catch(() => {
        setInspectionById((current) =>
          new Map(current).set(selectedItem.id, { status: "error" }),
        );
      });
  }, [selectedItem]);

  function savePlaces(nextPlaces: CuratedPlace[]) {
    setPlaces(nextPlaces);
    localStorage.setItem(CURATION_STORAGE_KEY, JSON.stringify(nextPlaces));
  }

  function fileDecision(event: FormEvent) {
    event.preventDefault();
    if (!selectedItem) return;
    if (!verdict && !comment.trim()) return;
    const target = getReviewTarget(selectedItem, scope);
    const priorDecision = getDecisionForReviewItem(places, selectedItem);
    const decision = createCuratedPlace({
      id: priorDecision?.id ?? crypto.randomUUID(),
      input: target,
      scope,
      verdict,
      comment,
      updatedAt: new Date().toISOString(),
    });
    const otherPlaces = priorDecision
      ? places.filter((place) => place.id !== priorDecision.id)
      : places;
    savePlaces(upsertCuratedPlace(otherPlaces, decision));

    const currentIndex = visibleItems.findIndex(
      (item) => item.id === selectedItem.id,
    );
    const nextItem = visibleItems[currentIndex + 1] ?? visibleItems[0];
    setSelectedId(nextItem?.id ?? null);
  }

  function removeDecision(item: CommuteReviewItem) {
    const priorDecision = getDecisionForReviewItem(places, item);
    if (!priorDecision) return;
    savePlaces(places.filter((place) => place.id !== priorDecision.id));
  }

  async function copyArtifact() {
    try {
      await navigator.clipboard.writeText(artifact);
      setCopyState("Copied for Codex");
      window.setTimeout(() => setCopyState("Copy artifact"), 1_800);
    } catch {
      setCopyState("Select text below");
    }
  }

  const selectedInspection = selectedItem
    ? inspectionById.get(selectedItem.id)
    : undefined;

  return (
    <main>
      <header className="masthead">
        <div className="masthead__identity">
          <img src="/icon.png" alt="" />
          <div>
            <span className="eyebrow">WWO / INTERNAL OFFICE</span>
            <h1>
              Internet Commute
              <br />
              Curation Desk
            </h1>
          </div>
        </div>
        <div className="masthead__notice">
          <span>LOCAL DRAFT</span>
          <strong>REVIEW LIVE CANDIDATES</strong>
          <small>saved in this browser</small>
        </div>
      </header>

      <section className="verdict-key" aria-label="Curation totals">
        {CURATION_VERDICTS.map((value, index) => (
          <div className={`verdict-key__item verdict--${value}`} key={value}>
            <span>0{index + 1}</span>
            <StatusIcon kind={value} />
            <strong>{VERDICT_LABELS[value]}</strong>
            <b>{counts[value]}</b>
          </div>
        ))}
      </section>

      <div className="workbench">
        <section className="intake panel">
          <div className="panel__heading review-heading">
            <div>
              <span>LIVE REVIEW 01</span>
              <h2>Current candidate</h2>
            </div>
            <span className="queue-position">
              {visibleItems.length} {showReviewed ? "visible" : "unreviewed"}
            </span>
          </div>

          {queueStatus === "loading" && (
            <div className="empty-state">
              <span>LOADING THE TRAIN…</span>
            </div>
          )}
          {queueStatus === "error" && (
            <div className="empty-state">
              <span>QUEUE UNAVAILABLE</span>
              <p>The review Worker may not be running yet.</p>
              <button type="button" onClick={() => void loadQueue()}>
                Try again
              </button>
            </div>
          )}
          {queueStatus === "ready" && !selectedItem && (
            <div className="empty-state">
              <span>QUEUE COMPLETE</span>
              <p>Show reviewed places or refresh for new arrivals.</p>
            </div>
          )}

          {queueStatus === "ready" && selectedItem && (
            <form className="review-form" onSubmit={fileDecision}>
              <div className="candidate-card">
                <div
                  className={`route-summary route-summary--${selectedItem.currentDisposition}`}
                >
                  <StatusIcon kind={selectedItem.currentDisposition} />
                  <div>
                    <small>AUTOMATIC ROUTING</small>
                    <strong>
                      {ROUTE_LABELS[selectedItem.currentDisposition]}
                    </strong>
                  </div>
                  <span>
                    {selectedItem.currentDisposition === "stop"
                      ? "Eligible to arrive"
                      : "Visible from the train"}
                  </span>
                </div>
                <div className="candidate-card__identity">
                  <img
                    src={`https://www.google.com/s2/favicons?domain=${selectedItem.domain}&sz=64`}
                    alt=""
                  />
                  <div>
                    <h3>{selectedItem.domain}</h3>
                    {selectedItem.title && <p>{selectedItem.title}</p>}
                  </div>
                </div>
                <a
                  href={
                    selectedItem.url ?? `https://${selectedItem.domain}/`
                  }
                  target="_blank"
                  rel="noreferrer"
                >
                  {selectedItem.url ?? `https://${selectedItem.domain}/`} ↗
                </a>
                {!selectedItem.url && (
                  <p className="domain-only-note">
                    The observed path stays private; this opens the domain
                    homepage.
                  </p>
                )}
              </div>

              <div
                className={`inspection-card inspection-card--${
                  selectedInspection?.status === "ready"
                    ? inspectionTone(selectedInspection.inspection.verdict)
                    : "neutral"
                }`}
              >
                <small>PUBLIC-PAGE INSPECTION</small>
                {!selectedItem.url ? (
                  <div className="inspection-card__result">
                    <StatusIcon kind="unknown" />
                    <div>
                      <strong>Not inspected</strong>
                      <span>Domain-only scenery has no exposed page path</span>
                    </div>
                  </div>
                ) : selectedInspection?.status === "ready" ? (
                  <div className="inspection-card__result">
                    <StatusIcon kind={selectedInspection.inspection.verdict} />
                    <div>
                      <strong>
                        {INSPECTION_LABELS[
                          selectedInspection.inspection.verdict
                        ]}
                      </strong>
                      <span>
                        {selectedInspection.inspection.reason.replaceAll(
                          "_",
                          " ",
                        )}
                      </span>
                    </div>
                  </div>
                ) : selectedInspection?.status === "loading" ? (
                  <div className="inspection-card__result">
                    <StatusIcon kind="loading" />
                    <div>
                      <strong>Inspecting page</strong>
                      <span>Checking the anonymous response</span>
                    </div>
                  </div>
                ) : (
                  <div className="inspection-card__result">
                    <StatusIcon kind="unknown" />
                    <div>
                      <strong>Unknown</strong>
                      <span>
                        {selectedInspection?.status === "missing"
                          ? "Inspector response is not deployed"
                          : "Inspection failed"}
                      </span>
                    </div>
                  </div>
                )}
                <p>
                  Informational only; does not change routing. robots.txt check
                  pending.
                </p>
              </div>

              <fieldset>
                <legend>Decision scope</legend>
                <div className="scope-options">
                  {CURATION_SCOPES.map((value) => {
                    const disabled = value === "page" && !selectedItem.url;
                    return (
                      <label
                        className={`scope-option${disabled ? " scope-option--disabled" : ""}`}
                        key={value}
                      >
                        <input
                          type="radio"
                          name="scope"
                          checked={scope === value}
                          disabled={disabled}
                          onChange={() => setScope(value)}
                        />
                        <span>{SCOPE_LABELS[value]}</span>
                        <small>
                          {disabled
                            ? "No page path exposed"
                            : getReviewTarget(selectedItem, value)}
                        </small>
                      </label>
                    );
                  })}
                </div>
              </fieldset>

              <fieldset>
                <legend>
                  Your decision <i>optional</i>
                </legend>
                <div className="verdict-options">
                  {CURATION_VERDICTS.map((value) => (
                    <label
                      className={`verdict-option verdict--${value} status-tone--${verdictTone(value)}`}
                      key={value}
                    >
                      <input
                        type="radio"
                        name="verdict"
                        checked={verdict === value}
                        onChange={() => setVerdict(value)}
                      />
                      <StatusIcon kind={value} />
                      <span>{VERDICT_LABELS[value]}</span>
                    </label>
                  ))}
                </div>
                <p className="decision-help">
                  {verdict ? (
                    <button type="button" onClick={() => setVerdict(undefined)}>
                      Clear classification
                    </button>
                  ) : (
                    "No classification selected — your note can stand on its own."
                  )}
                </p>
              </fieldset>

              <label>
                <span>
                  Reviewer note <i>{verdict ? "optional" : "note only"}</i>
                </span>
                <textarea
                  value={comment}
                  onChange={(event) => setComment(event.target.value)}
                  placeholder="Why this is ambiguous, or what broader rule it suggests…"
                />
              </label>

              <div className="form-actions">
                <button
                  className="primary-action"
                  type="submit"
                  disabled={!verdict && !comment.trim()}
                >
                  {verdict ? "File decision" : "Save note"} →
                </button>
                <button
                  className="text-action"
                  type="button"
                  onClick={() => {
                    const index = visibleItems.findIndex(
                      (item) => item.id === selectedItem.id,
                    );
                    setSelectedId(
                      visibleItems[index + 1]?.id ??
                        visibleItems[0]?.id ??
                        null,
                    );
                  }}
                >
                  Skip for now
                </button>
              </div>
            </form>
          )}
        </section>

        <section className="queue panel">
          <div className="panel__heading panel__heading--queue">
            <div>
              <span>LIVE REGISTER 02</span>
              <h2>Commute queue</h2>
            </div>
            <div className="queue-controls">
              <button
                type="button"
                onClick={() => setShowReviewed((value) => !value)}
              >
                {showReviewed ? "Hide reviewed" : "Show reviewed"}
              </button>
              <button type="button" onClick={() => void loadQueue()}>
                Refresh
              </button>
            </div>
          </div>

          <ol className="place-list live-place-list">
            {visibleItems.map((item, index) => {
              const priorDecision = getDecisionForReviewItem(places, item);
              return (
                <li
                  className={`place-card place-card--route-${item.currentDisposition} ${selectedItem?.id === item.id ? "place-card--selected" : ""}`}
                  key={item.id}
                >
                  <button
                    className="place-card__select"
                    type="button"
                    onClick={() => setSelectedId(item.id)}
                  >
                    <span className="place-card__index">
                      {String(index + 1).padStart(3, "0")}
                    </span>
                    <span className="place-card__body">
                      <span className="place-card__topline">
                        <strong>{item.domain}</strong>
                        <span
                          className={`route-chip route-chip--${item.currentDisposition}`}
                        >
                          <StatusIcon kind={item.currentDisposition} />
                          {ROUTE_LABELS[item.currentDisposition]}
                        </span>
                      </span>
                      <span className="place-card__subtitle">
                        {item.title ?? "Scenery domain"}
                      </span>
                      {priorDecision && (
                        <b
                          className={`decision-mark ${
                            priorDecision.verdict
                              ? `status-tone--${verdictTone(priorDecision.verdict)}`
                              : "status-tone--neutral"
                          }`}
                        >
                          <StatusIcon
                            kind={priorDecision.verdict ?? "note"}
                          />
                          {priorDecision.verdict
                            ? VERDICT_LABELS[priorDecision.verdict]
                            : "Note only"}
                        </b>
                      )}
                    </span>
                  </button>
                  {priorDecision && (
                    <button
                      className="place-card__remove"
                      type="button"
                      onClick={() => removeDecision(item)}
                    >
                      Clear
                    </button>
                  )}
                </li>
              );
            })}
          </ol>
          <div className="queue-footer">
            <span>
              {queueGeneratedAt
                ? `Route sampled ${relativeTime(queueGeneratedAt)}`
                : "No route loaded"}
            </span>
            <span>{reviewItems.length} sanitized places</span>
          </div>
        </section>
      </div>

      <section className="export-panel panel">
        <div className="panel__heading">
          <span>OUTPUT 03</span>
          <h2>Policy handoff</h2>
        </div>
        <div className="export-panel__intro">
          <p>
            Copy this artifact into a Codex task. Notes can become broader URL
            policy; individual decisions can remain catalog entries.
          </p>
          <button type="button" onClick={copyArtifact}>
            {copyState}
          </button>
        </div>
        <textarea
          className="artifact"
          readOnly
          value={artifact}
          aria-label="Curation artifact"
        />
      </section>

      <footer>
        <span>INTERNET COMMUTE DESTINATION CONTROL</span>
        <span>WE WERE ONLINE / CURATION PROTOTYPE</span>
      </footer>
    </main>
  );
}

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
