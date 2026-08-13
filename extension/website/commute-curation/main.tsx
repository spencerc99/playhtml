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
  type CurationVerdict,
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

const INSPECTION_LABELS: Record<PublicPageInspection["verdict"], string> = {
  public: "Public page",
  gated: "Account gated",
  not_public: "Not public",
  unavailable: "Unavailable",
  unknown: "Unknown",
};

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
  const [queueMode, setQueueMode] = useState<"history" | "snapshot">("history");
  const [verdict, setVerdict] = useState<CurationVerdict>("promoted");
  const [comment, setComment] = useState("");
  const [inspectionById, setInspectionById] = useState(
    new Map<string, InspectionState>(),
  );
  const requestedInspectionIds = useRef(new Set<string>());
  const [copyState, setCopyState] = useState("Copy artifact");
  const [showReviewed, setShowReviewed] = useState(false);

  const decisionsByPlace = useMemo(
    () => new Map(places.map((place) => [place.place, place])),
    [places],
  );
  const visibleItems = useMemo(
    () =>
      showReviewed
        ? reviewItems
        : reviewItems.filter(
            (item) => !decisionsByPlace.has(getReviewTarget(item)),
          ),
    [decisionsByPlace, reviewItems, showReviewed],
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
      let response = COMMUTE_REVIEW_URL
        ? await fetch(COMMUTE_REVIEW_URL, {
            headers: { Accept: "application/json" },
          })
        : null;
      let payload: CommuteReviewResponse;
      if (response?.ok) {
        payload = parseCommuteReviewResponse(await response.json());
        setQueueMode("history");
      } else if (!response || response.status === 404) {
        response = await fetch(COMMUTE_RECENT_URL, {
          headers: { Accept: "application/json" },
        });
        if (!response.ok)
          throw new Error(`Commute route returned ${response.status}`);
        const snapshot = (await response.json()) as {
          generatedAt: number;
          destinations: Array<{
            id: string;
            domain: string;
            url: string;
            title: string | null;
            visitedAt: number;
          }>;
          scenery: Array<{
            id: string;
            domain: string;
            visitedAt: number;
          }>;
        };
        const destinationDomains = new Set(
          snapshot.destinations.map((item) => item.domain),
        );
        payload = parseCommuteReviewResponse({
          generatedAt: snapshot.generatedAt,
          items: [
            ...snapshot.destinations.map((item) => ({
              id: item.url,
              domain: item.domain,
              url: item.url,
              ...(item.title ? { title: item.title } : {}),
              currentDisposition: "stop",
              recentVisitCount: 1,
              recentVisits: [
                {
                  visitedAt: item.visitedAt,
                  ...(item.title ? { title: item.title } : {}),
                },
              ],
            })),
            ...snapshot.scenery
              .filter((item) => !destinationDomains.has(item.domain))
              .map((item) => ({
                id: item.domain,
                domain: item.domain,
                currentDisposition: "scenery",
                recentVisitCount: 1,
                recentVisits: [{ visitedAt: item.visitedAt }],
              })),
          ],
        });
        setQueueMode("snapshot");
      } else {
        throw new Error(`Commute review returned ${response.status}`);
      }
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
    const priorDecision = decisionsByPlace.get(getReviewTarget(selectedItem));
    setVerdict(
      priorDecision?.verdict ??
        (selectedItem.currentDisposition === "stop"
          ? "promoted"
          : "scenery-only"),
    );
    setComment(priorDecision?.comment ?? "");
  }, [decisionsByPlace, selectedItem]);

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
    const target = getReviewTarget(selectedItem);
    const priorDecision = decisionsByPlace.get(target);
    const decision = createCuratedPlace({
      id: priorDecision?.id ?? crypto.randomUUID(),
      input: target,
      verdict,
      comment,
      updatedAt: new Date().toISOString(),
    });
    savePlaces(upsertCuratedPlace(places, decision));

    const currentIndex = visibleItems.findIndex(
      (item) => item.id === selectedItem.id,
    );
    const nextItem = visibleItems[currentIndex + 1] ?? visibleItems[0];
    setSelectedId(nextItem?.id ?? null);
  }

  function removeDecision(item: CommuteReviewItem) {
    const priorDecision = decisionsByPlace.get(getReviewTarget(item));
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
          <span>SHADOW REVIEW</span>
          <strong>DOES NOT CHANGE THE TRAIN</strong>
          <small>decisions stay in this browser</small>
        </div>
      </header>

      <section className="verdict-key" aria-label="Curation totals">
        {CURATION_VERDICTS.map((value, index) => (
          <div className={`verdict-key__item verdict--${value}`} key={value}>
            <span>0{index + 1}</span>
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
                <div className="candidate-card__status">
                  <span
                    className={`source source--${selectedItem.currentDisposition}`}
                  >
                    {selectedItem.currentDisposition === "stop"
                      ? "CURRENT STOP"
                      : "CURRENT SCENERY"}
                  </span>
                  <span>{selectedItem.recentVisitCount} recent visits</span>
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
                {selectedItem.url ? (
                  <a href={selectedItem.url} target="_blank" rel="noreferrer">
                    {selectedItem.url} ↗
                  </a>
                ) : (
                  <p className="domain-only-note">
                    Domain-only by current privacy policy; no page URL is
                    exposed.
                  </p>
                )}
              </div>

              <div className="inspection-card">
                <div>
                  <span>PUBLIC-PAGE INSPECTION</span>
                  <b>SHADOW ONLY</b>
                </div>
                <small>
                  anonymous page response / robots.txt check pending
                </small>
                {!selectedItem.url && <p>Not run for domain-only scenery.</p>}
                {selectedItem.url &&
                  selectedInspection?.status === "loading" && (
                    <p>Inspecting the cached anonymous page response…</p>
                  )}
                {selectedItem.url && selectedInspection?.status === "ready" && (
                  <p>
                    <strong>
                      {INSPECTION_LABELS[selectedInspection.inspection.verdict]}
                    </strong>
                    <span>
                      {selectedInspection.inspection.reason.replaceAll(
                        "_",
                        " ",
                      )}
                    </span>
                  </p>
                )}
                {selectedItem.url &&
                  selectedInspection?.status === "missing" && (
                    <p>
                      Inspector response is not deployed on this Worker yet.
                    </p>
                  )}
                {selectedItem.url && selectedInspection?.status === "error" && (
                  <p>Inspection failed; the result remains unknown.</p>
                )}
              </div>

              <div className="history">
                <span>
                  RECENT SIGHTINGS / {selectedItem.recentVisits.length} SHOWN
                </span>
                <ol>
                  {selectedItem.recentVisits.map((visit, index) => (
                    <li key={`${visit.visitedAt}:${index}`}>
                      <time>{relativeTime(visit.visitedAt)}</time>
                      {visit.title && <span>{visit.title}</span>}
                    </li>
                  ))}
                </ol>
              </div>

              <fieldset>
                <legend>Your decision</legend>
                <div className="verdict-options">
                  {CURATION_VERDICTS.map((value) => (
                    <label
                      className={`verdict-option verdict--${value}`}
                      key={value}
                    >
                      <input
                        type="radio"
                        name="verdict"
                        checked={verdict === value}
                        onChange={() => setVerdict(value)}
                      />
                      <span>{VERDICT_LABELS[value]}</span>
                    </label>
                  ))}
                </div>
              </fieldset>

              <label>
                <span>
                  Reviewer note <i>optional</i>
                </span>
                <textarea
                  value={comment}
                  onChange={(event) => setComment(event.target.value)}
                  placeholder="Why this is ambiguous, or what broader rule it suggests…"
                />
              </label>

              <div className="form-actions">
                <button className="primary-action" type="submit">
                  File decision →
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
              const priorDecision = decisionsByPlace.get(getReviewTarget(item));
              return (
                <li
                  className={`place-card ${selectedItem?.id === item.id ? "place-card--selected" : ""}`}
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
                        <span>{item.currentDisposition}</span>
                      </span>
                      <span className="place-card__subtitle">
                        {item.title ?? `${item.recentVisitCount} recent visits`}
                      </span>
                      {priorDecision && (
                        <b
                          className={`decision-mark verdict--${priorDecision.verdict}`}
                        >
                          {VERDICT_LABELS[priorDecision.verdict]}
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
          {queueMode === "snapshot" && (
            <p className="queue-mode-note">
              Snapshot fallback: full four-sighting history appears after the
              review route is deployed.
            </p>
          )}
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
        <span>WE WERE ONLINE / SHADOW PROTOTYPE</span>
      </footer>
    </main>
  );
}

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
