// ABOUTME: Renders the live Internet Commute destination review workbench.
// ABOUTME: Joins sanitized route candidates with audit evidence and durable D1 policies.

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
  CURATION_REASONS,
  CURATION_VERDICTS,
  type CommuteReviewItem,
  type CommuteReviewResponse,
  type CuratedPlace,
  type CurationScope,
  type CurationVerdict,
  getDecisionForReviewItem,
  getReviewTarget,
  mergeCatalogEvidence,
  parseCommuteReviewResponse,
  type PublicPageInspection,
  serializeCurationArtifact,
  upsertCuratedPlace,
} from "./curation";
import {
  deleteCatalogPolicy,
  getCatalog,
  importEvaluationArtifact,
  saveCatalogPolicy,
} from "./catalogApi";
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
const TOKEN_STORAGE_KEY = "wwo-admin-token";

const REASON_LABELS = Object.fromEntries(
  CURATION_REASONS.map((reason) => [
    reason,
    reason.replaceAll("-", " "),
  ]),
) as Record<(typeof CURATION_REASONS)[number], string>;

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

function Login({ onLogin }: { onLogin: (token: string) => void }) {
  const [token, setToken] = useState("");
  return (
    <main className="curation-login">
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (token.trim()) onLogin(token.trim());
        }}
      >
        <span className="eyebrow">WWO / INTERNAL OFFICE</span>
        <h1>Commute Curation</h1>
        <p>Use the Worker admin key to review and change the durable catalog.</p>
        <label>
          <span>Admin key</span>
          <input
            type="password"
            autoComplete="current-password"
            value={token}
            onChange={(event) => setToken(event.target.value)}
            autoFocus
          />
        </label>
        <button type="submit" disabled={!token.trim()}>Enter desk</button>
      </form>
    </main>
  );
}

export function App({ token, onLogout }: { token: string; onLogout: () => void }) {
  const [places, setPlaces] = useState<CuratedPlace[]>([]);
  const [liveItems, setLiveItems] = useState<CommuteReviewItem[]>([]);
  const [evidenceItems, setEvidenceItems] = useState<
    Awaited<ReturnType<typeof getCatalog>>["evidence"]
  >([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [queueStatus, setQueueStatus] = useState<"loading" | "ready" | "error">(
    "loading",
  );
  const [queueGeneratedAt, setQueueGeneratedAt] = useState<number | null>(null);
  const [scope, setScope] = useState<CurationScope>("hostname");
  const [verdict, setVerdict] = useState<CurationVerdict | undefined>();
  const [reason, setReason] = useState("");
  const [comment, setComment] = useState("");
  const [inspectionById, setInspectionById] = useState(
    new Map<string, InspectionState>(),
  );
  const requestedInspectionIds = useRef(new Set<string>());
  const [copyState, setCopyState] = useState("Copy artifact");
  const [showReviewed, setShowReviewed] = useState(false);
  const [catalogError, setCatalogError] = useState("");
  const [saving, setSaving] = useState(false);
  const [importStatus, setImportStatus] = useState("Import audit JSON");
  const reviewItems = useMemo(
    () => mergeCatalogEvidence(liveItems, evidenceItems),
    [evidenceItems, liveItems],
  );

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
      setLiveItems(payload.items);
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

  const loadCatalog = useCallback(async () => {
    setCatalogError("");
    try {
      const catalog = await getCatalog(token);
      setPlaces(catalog.policies);
      setEvidenceItems(catalog.evidence);
    } catch (error) {
      setCatalogError(error instanceof Error ? error.message : String(error));
    }
  }, [token]);

  useEffect(() => {
    void loadQueue();
    void loadCatalog();
  }, [loadCatalog, loadQueue]);

  useEffect(() => {
    if (!selectedItem) return;
    const priorDecision = getDecisionForReviewItem(places, selectedItem);
    setScope(priorDecision?.scope ?? "hostname");
    setVerdict(priorDecision?.verdict);
    setReason(priorDecision?.reason ?? "");
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

  async function fileDecision(event: FormEvent) {
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
      reason,
      comment,
      updatedAt: new Date().toISOString(),
    });
    setSaving(true);
    setCatalogError("");
    try {
      if (
        priorDecision &&
        (priorDecision.scope !== decision.scope ||
          priorDecision.place !== decision.place)
      ) {
        await deleteCatalogPolicy(token, priorDecision);
      }
      const saved = await saveCatalogPolicy(token, decision);
      const otherPlaces = priorDecision
        ? places.filter((place) => place.id !== priorDecision.id)
        : places;
      setPlaces(upsertCuratedPlace(otherPlaces, saved));
    } catch (error) {
      setCatalogError(error instanceof Error ? error.message : String(error));
      setSaving(false);
      return;
    }
    setSaving(false);

    const currentIndex = visibleItems.findIndex(
      (item) => item.id === selectedItem.id,
    );
    const nextItem = visibleItems[currentIndex + 1] ?? visibleItems[0];
    setSelectedId(nextItem?.id ?? null);
  }

  async function removeDecision(item: CommuteReviewItem) {
    const priorDecision = getDecisionForReviewItem(places, item);
    if (!priorDecision) return;
    setSaving(true);
    try {
      await deleteCatalogPolicy(token, priorDecision);
      setPlaces(places.filter((place) => place.id !== priorDecision.id));
    } catch (error) {
      setCatalogError(error instanceof Error ? error.message : String(error));
    } finally {
      setSaving(false);
    }
  }

  async function importAudit(file: File) {
    setImportStatus("Importing…");
    setCatalogError("");
    try {
      const result = await importEvaluationArtifact(
        token,
        JSON.parse(await file.text()) as unknown,
      );
      setImportStatus(`${result.imported} pages imported`);
      await loadCatalog();
    } catch (error) {
      setImportStatus("Import audit JSON");
      setCatalogError(error instanceof Error ? error.message : String(error));
    }
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
          <span>DURABLE CATALOG</span>
          <strong>CHANGES AFFECT THE TRAIN</strong>
          <small>human policy stored in D1</small>
          <button type="button" onClick={onLogout}>Lock desk</button>
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
        {catalogError && <p className="catalog-error">{catalogError}</p>}
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

          {queueStatus === "loading" && !selectedItem && (
            <div className="empty-state">
              <span>LOADING THE TRAIN…</span>
            </div>
          )}
          {queueStatus === "error" && !selectedItem && (
            <div className="empty-state">
              <span>QUEUE UNAVAILABLE</span>
              <p>The review Worker may not be running yet.</p>
              <button type="button" onClick={() => void loadQueue()}>
                Try again
              </button>
            </div>
          )}
          {!selectedItem && queueStatus !== "loading" && queueStatus !== "error" && (
            <div className="empty-state">
              <span>QUEUE COMPLETE</span>
              <p>Show reviewed places or refresh for new arrivals.</p>
            </div>
          )}

          {selectedItem && (
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
                {selectedItem.evidence && (
                  <div className="evaluation-evidence">
                    <div className="evaluation-evidence__heading">
                      <small>AUDIT EVIDENCE</small>
                      <strong>
                        suggestion: {selectedItem.evidence.initialJudgment.value}
                      </strong>
                    </div>
                    <div className="evidence-labels">
                      {[
                        ["Category", selectedItem.evidence.category],
                        ["Page type", selectedItem.evidence.pageType],
                        ["Exposure", selectedItem.evidence.exposure],
                        ["Character", selectedItem.evidence.character],
                      ].map(([label, evidence]) => (
                        <span key={label as string}>
                          <small>{label as string}</small>
                          <b>{(evidence as { value: string }).value}</b>
                        </span>
                      ))}
                    </div>
                    <div className="evidence-observation">
                      <span><b>{selectedItem.evidence.observation.participants}</b> people</span>
                      <span><b>{selectedItem.evidence.observation.visits}</b> visits</span>
                      <span><b>{Math.round(selectedItem.evidence.observation.screenTimeMs / 60_000)}</b> min attention</span>
                      <span><b>{selectedItem.evidence.observation.domainParticipants}</b> domain reach</span>
                    </div>
                    <div className="evidence-scores">
                      {Object.entries(selectedItem.evidence.scores).map(([name, score]) => (
                        <span key={name}><small>{name}</small><b>{score}</b></span>
                      ))}
                    </div>
                    <p>{selectedItem.evidence.lanes.join(" · ")}</p>
                    <small>
                      Machine observation only · {selectedItem.evidenceProvenance}
                    </small>
                  </div>
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

              <label>
                <span>Reason <i>optional</i></span>
                <select value={reason} onChange={(event) => setReason(event.target.value)}>
                  <option value="">Choose a reusable reason</option>
                  {CURATION_REASONS.map((value) => (
                    <option key={value} value={value}>{REASON_LABELS[value]}</option>
                  ))}
                </select>
              </label>

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
                  disabled={saving || (!verdict && !comment.trim())}
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
              <label className="import-control">
                {importStatus}
                <input
                  type="file"
                  accept="application/json,.json"
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    if (file) void importAudit(file);
                    event.target.value = "";
                  }}
                />
              </label>
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
                      onClick={() => void removeDecision(item)}
                      disabled={saving}
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
            <span>
              {liveItems.length} live · {evidenceItems.length} audited
            </span>
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

function CurationDesk() {
  const [token, setToken] = useState(
    () => sessionStorage.getItem(TOKEN_STORAGE_KEY) ?? "",
  );
  if (!token) {
    return <Login onLogin={(nextToken) => {
      sessionStorage.setItem(TOKEN_STORAGE_KEY, nextToken);
      setToken(nextToken);
    }} />;
  }
  return <App token={token} onLogout={() => {
    sessionStorage.removeItem(TOKEN_STORAGE_KEY);
    setToken("");
  }} />;
}

createRoot(document.getElementById("root")!).render(
  <React.StrictMode><CurationDesk /></React.StrictMode>,
);
