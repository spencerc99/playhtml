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
  canPrefillSuggestion,
  createCuratedPlace,
  CURATION_PLACEMENTS,
  CURATION_REASONS,
  type CommuteReviewItem,
  type CommuteReviewResponse,
  type CuratedPlace,
  type CurationScope,
  type CurationPlacement,
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
  getCatalogSuggestion,
  getCatalog,
  importEvaluationArtifact,
  isCatalogUnauthorized,
  saveCatalogPolicy,
} from "./catalogApi";
import {
  parseReserveCatalog,
  type ReserveReviewItem,
  type ReserveSourceMode,
} from "./reserveCatalog";
import "./style.scss";

const PLACEMENT_LABELS: Record<CurationPlacement, string> = {
  hidden: "Hidden",
  scenery: "Scenery only",
  regular: "Regular stop",
  featured: "Featured stop",
  reserve: "Trusted reserve",
};

const SCOPE_LABELS: Record<CurationScope, string> = {
  page: "Exact page",
  hostname: "This hostname",
  site: "Entire site",
};
const CURATION_SCOPES: CurationScope[] = ["page", "hostname", "site"];
const TOKEN_STORAGE_KEY = "wwo-admin-token";
const RESERVE_CATALOG_URL = "/internet-commute-reserve-catalog.json";

type ReviewView = "observed" | "reserve";
type ReviewItem = CommuteReviewItem | ReserveReviewItem;

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
  | CurationPlacement
  | CommuteReviewItem["currentDisposition"]
  | PublicPageInspection["verdict"]
  | "note"
  | "loading";

function StatusIcon({ kind }: { kind: StatusIconKind }) {
  const iconKind =
    kind === "regular" || kind === "featured" || kind === "reserve"
      ? "stop"
      : kind === "scenery"
        ? "scenery"
        : kind === "hidden"
          ? "blocked"
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

function placementTone(placement: CurationPlacement): string {
  if (placement === "featured" || placement === "reserve") return "green";
  if (placement === "scenery") return "blue";
  if (placement === "regular") return "neutral";
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

function Login({
  error,
  onLogin,
}: {
  error: string;
  onLogin: (token: string) => void;
}) {
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
        {error && <p className="curation-login__error">{error}</p>}
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

export function App({
  token,
  onLogout,
  onUnauthorized,
}: {
  token: string;
  onLogout: () => void;
  onUnauthorized: () => void;
}) {
  const [places, setPlaces] = useState<CuratedPlace[]>([]);
  const [liveItems, setLiveItems] = useState<CommuteReviewItem[]>([]);
  const [reserveItems, setReserveItems] = useState<ReserveReviewItem[]>([]);
  const [evidenceItems, setEvidenceItems] = useState<
    Awaited<ReturnType<typeof getCatalog>>["evidence"]
  >([]);
  const [reviewView, setReviewView] = useState<ReviewView>(() =>
    new URLSearchParams(window.location.search).get("view") === "reserve"
      ? "reserve"
      : "observed",
  );
  const [reserveSource, setReserveSource] = useState("all");
  const [reserveMode, setReserveMode] = useState<ReserveSourceMode | "all">(
    "trusted-editorial",
  );
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [queueStatus, setQueueStatus] = useState<"loading" | "ready" | "error">(
    "loading",
  );
  const [queueGeneratedAt, setQueueGeneratedAt] = useState<number | null>(null);
  const [reserveGeneratedAt, setReserveGeneratedAt] = useState<number | null>(
    null,
  );
  const [reserveStatus, setReserveStatus] = useState<
    "loading" | "ready" | "error"
  >("loading");
  const [scope, setScope] = useState<CurationScope>("hostname");
  const [placement, setPlacement] = useState<CurationPlacement | undefined>();
  const [reason, setReason] = useState("");
  const [comment, setComment] = useState("");
  const [inspectionById, setInspectionById] = useState(
    new Map<string, InspectionState>(),
  );
  const requestedInspectionIds = useRef(new Set<string>());
  const selectedItemId = useRef<string | null>(null);
  const [copyState, setCopyState] = useState("Copy artifact");
  const [showReviewed, setShowReviewed] = useState(false);
  const [catalogError, setCatalogError] = useState("");
  const [saving, setSaving] = useState(false);
  const [importStatus, setImportStatus] = useState("Import audit JSON");
  const [suggestionStatus, setSuggestionStatus] = useState<
    "idle" | "loading" | "prefilled" | "unavailable"
  >("idle");
  const formEdited = useRef(false);
  const requestedSuggestionIds = useRef(new Set<string>());
  const observedItems = useMemo(
    () => mergeCatalogEvidence(liveItems, evidenceItems),
    [evidenceItems, liveItems],
  );
  const reserveSources = useMemo(
    () =>
      [...new Set(reserveItems.map((item) => item.reserve.sourceCollection))]
        .sort((first, second) => first.localeCompare(second)),
    [reserveItems],
  );
  const filteredReserveItems = useMemo(
    () =>
      reserveItems.filter(
        (item) =>
          (reserveSource === "all" ||
            item.reserve.sourceCollection === reserveSource) &&
          (reserveMode === "all" || item.reserve.sourceMode === reserveMode),
      ),
    [reserveItems, reserveMode, reserveSource],
  );
  const reviewItems: ReviewItem[] =
    reviewView === "reserve" ? filteredReserveItems : observedItems;

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
  const selectedReserve = selectedItem && "reserve" in selectedItem
    ? selectedItem.reserve
    : undefined;
  selectedItemId.current = selectedItem?.id ?? null;
  const counts = useMemo(
    () =>
      Object.fromEntries(
        CURATION_PLACEMENTS.map((value) => [
          value,
          places.filter((place) => place.placement === value).length,
        ]),
      ) as Record<CurationPlacement, number>,
    [places],
  );
  const artifact = useMemo(
    () => serializeCurationArtifact(places, new Date().toISOString()),
    [places],
  );
  const markFormEdited = useCallback(() => {
    formEdited.current = true;
    setSuggestionStatus("idle");
  }, []);

  const handleCatalogError = useCallback((error: unknown) => {
    if (isCatalogUnauthorized(error)) {
      onUnauthorized();
      return;
    }
    setCatalogError(error instanceof Error ? error.message : String(error));
  }, [onUnauthorized]);

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

  const loadReserveCatalog = useCallback(async () => {
    setReserveStatus("loading");
    try {
      const response = await fetch(RESERVE_CATALOG_URL, {
        headers: { Accept: "application/json" },
      });
      if (!response.ok) {
        throw new Error(`Reserve catalog returned ${response.status}`);
      }
      const catalog = parseReserveCatalog(await response.json());
      setReserveItems(catalog.items);
      setReserveGeneratedAt(Date.parse(catalog.generatedAt));
      setReserveStatus("ready");
    } catch (error) {
      setReserveStatus("error");
      setCatalogError(error instanceof Error ? error.message : String(error));
    }
  }, []);

  const loadCatalog = useCallback(async () => {
    setCatalogError("");
    try {
      const catalog = await getCatalog(token);
      setPlaces(catalog.policies);
      setEvidenceItems(catalog.evidence);
    } catch (error) {
      handleCatalogError(error);
    }
  }, [handleCatalogError, token]);

  useEffect(() => {
    void loadQueue();
    void loadReserveCatalog();
    void loadCatalog();
  }, [loadCatalog, loadQueue, loadReserveCatalog]);

  useEffect(() => {
    setSelectedId(null);
    const url = new URL(window.location.href);
    if (reviewView === "reserve") url.searchParams.set("view", "reserve");
    else url.searchParams.delete("view");
    window.history.replaceState(null, "", url);
  }, [reviewView, reserveMode, reserveSource]);

  useEffect(() => {
    if (!selectedItem) return;
    const priorDecision = getDecisionForReviewItem(places, selectedItem);
    formEdited.current = false;
    setScope(priorDecision?.scope ?? "hostname");
    setPlacement(priorDecision?.placement);
    setReason(priorDecision?.reason ?? "");
    setComment(priorDecision?.comment ?? "");
    setSuggestionStatus(priorDecision || !selectedItem.url ? "idle" : "loading");
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

  useEffect(() => {
    if (
      !selectedItem?.url ||
      getDecisionForReviewItem(places, selectedItem) ||
      requestedSuggestionIds.current.has(selectedItem.id)
    ) {
      return;
    }
    setSuggestionStatus("loading");
    const inspectionState = inspectionById.get(selectedItem.id);
    const suggestionTimer = window.setTimeout(() => {
      if (
        formEdited.current ||
        selectedItemId.current !== selectedItem.id
      ) return;
      requestedSuggestionIds.current.add(selectedItem.id);
      void getCatalogSuggestion({
        token,
        item: selectedItem,
        reserve: "reserve" in selectedItem ? selectedItem.reserve : undefined,
        inspection:
          inspectionState?.status === "ready"
            ? inspectionState.inspection
            : undefined,
      })
        .then(({ suggestion }) => {
          if (!canPrefillSuggestion({
            hasDecision: Boolean(getDecisionForReviewItem(places, selectedItem)),
            formEdited: formEdited.current,
            selectedItemId: selectedItemId.current,
            suggestionItemId: selectedItem.id,
          })) return;
          setScope(suggestion.scope);
          setPlacement(suggestion.placement);
          setReason(
            suggestion.reason && CURATION_REASONS.includes(
              suggestion.reason as (typeof CURATION_REASONS)[number],
            )
              ? suggestion.reason
              : "",
          );
          setSuggestionStatus("prefilled");
        })
        .catch((error) => {
          if (isCatalogUnauthorized(error)) onUnauthorized();
          else setSuggestionStatus("unavailable");
        });
    }, 350);
    return () => window.clearTimeout(suggestionTimer);
  }, [inspectionById, onUnauthorized, places, selectedItem, token]);

  async function fileDecision(event: FormEvent) {
    event.preventDefault();
    if (!selectedItem) return;
    if (!placement && !comment.trim()) return;
    const target = getReviewTarget(selectedItem, scope);
    const priorDecision = getDecisionForReviewItem(places, selectedItem);
    const decision = createCuratedPlace({
      id: priorDecision?.id ?? crypto.randomUUID(),
      input: target,
      scope,
      placement,
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
      handleCatalogError(error);
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
      handleCatalogError(error);
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
      handleCatalogError(error);
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
  const activeQueueStatus =
    reviewView === "reserve" ? reserveStatus : queueStatus;
  const activeGeneratedAt =
    reviewView === "reserve" ? reserveGeneratedAt : queueGeneratedAt;

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
        {CURATION_PLACEMENTS.map((value, index) => (
          <div className={`verdict-key__item placement--${value}`} key={value}>
            <span>0{index + 1}</span>
            <StatusIcon kind={value} />
            <strong>{PLACEMENT_LABELS[value]}</strong>
            <b>{counts[value]}</b>
          </div>
        ))}
      </section>

      <nav className="review-view-switch" aria-label="Review queue">
        <button
          type="button"
          aria-pressed={reviewView === "observed"}
          onClick={() => setReviewView("observed")}
        >
          <span>Observed queue</span>
          <b>{observedItems.length}</b>
          <small>Recent navigation and audit evidence</small>
        </button>
        <button
          type="button"
          aria-pressed={reviewView === "reserve"}
          onClick={() => setReviewView("reserve")}
        >
          <span>Reserve catalog</span>
          <b>{reserveItems.length}</b>
          <small>Editorial, interactive, and poetic sources</small>
        </button>
      </nav>

      <div className="workbench">
        {catalogError && <p className="catalog-error">{catalogError}</p>}
        <section className="intake panel">
          <div className="panel__heading review-heading">
            <div>
              <span>
                {reviewView === "reserve" ? "RESERVE REVIEW 01" : "LIVE REVIEW 01"}
              </span>
              <h2>
                {reviewView === "reserve"
                  ? "Reserve candidate"
                  : "Current candidate"}
              </h2>
            </div>
            <span className="queue-position">
              {visibleItems.length} {showReviewed ? "visible" : "unreviewed"}
            </span>
          </div>

          {activeQueueStatus === "loading" && !selectedItem && (
            <div className="empty-state">
              <span>
                {reviewView === "reserve"
                  ? "LOADING THE RESERVE…"
                  : "LOADING THE TRAIN…"}
              </span>
            </div>
          )}
          {activeQueueStatus === "error" && !selectedItem && (
            <div className="empty-state">
              <span>QUEUE UNAVAILABLE</span>
              <p>
                {reviewView === "reserve"
                  ? "The generated reserve catalog could not be loaded."
                  : "The review Worker may not be running yet."}
              </p>
              <button
                type="button"
                onClick={() => void (
                  reviewView === "reserve"
                    ? loadReserveCatalog()
                    : loadQueue()
                )}
              >
                Try again
              </button>
            </div>
          )}
          {!selectedItem && activeQueueStatus === "ready" && (
            <div className="empty-state">
              <span>QUEUE COMPLETE</span>
              <p>
                {reviewView === "reserve"
                  ? "Change source filters or show reviewed reserve pages."
                  : "Show reviewed places or refresh for new arrivals."}
              </p>
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
                    <small>
                      {selectedReserve ? "RESERVE SOURCE" : "AUTOMATIC ROUTING"}
                    </small>
                    <strong>
                      {selectedReserve
                        ? selectedReserve.sourceMode === "trusted-editorial"
                          ? "Trusted editorial candidate"
                          : "Discovery candidate"
                        : ROUTE_LABELS[selectedItem.currentDisposition]}
                    </strong>
                  </div>
                  <span>
                    {selectedReserve
                      ? "Not automatically promoted"
                      : selectedItem.currentDisposition === "stop"
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
                {selectedReserve && (
                  <div className="reserve-evidence">
                    <div className="reserve-evidence__heading">
                      <small>EDITORIAL PROVENANCE</small>
                      <strong>{selectedReserve.sourceCollection}</strong>
                    </div>
                    <div className="reserve-evidence__facts">
                      <span>
                        <small>Source mode</small>
                        <b>{selectedReserve.sourceMode.replace("-", " ")}</b>
                      </span>
                      <span>
                        <small>Interaction</small>
                        <b>{selectedReserve.interactionLevel}</b>
                      </span>
                      {selectedReserve.issue && (
                        <span>
                          <small>Issue</small>
                          <b>{selectedReserve.issue}</b>
                        </span>
                      )}
                      {selectedReserve.section && (
                        <span>
                          <small>Section</small>
                          <b>{selectedReserve.section}</b>
                        </span>
                      )}
                    </div>
                    <div className="reserve-evidence__tags">
                      {selectedReserve.tags.map((tag) => (
                        <span key={tag}>{tag}</span>
                      ))}
                    </div>
                    <p>{selectedReserve.healthNote}</p>
                    <a
                      href={selectedReserve.sourceUrl}
                      target="_blank"
                      rel="noreferrer"
                    >
                      Open source collection ↗
                    </a>
                  </div>
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
                          onChange={() => {
                            markFormEdited();
                            setScope(value);
                          }}
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
                {suggestionStatus === "loading" && (
                  <p className="decision-help">Drafting a suggestion…</p>
                )}
                {suggestionStatus === "prefilled" && (
                  <p className="decision-help">
                    Suggested fields are prefilled. Change anything before saving.
                  </p>
                )}
                <div className="verdict-options">
                  {CURATION_PLACEMENTS.map((value) => (
                    <label
                      className={`verdict-option placement--${value} status-tone--${placementTone(value)}`}
                      key={value}
                    >
                      <input
                        type="radio"
                        name="placement"
                        checked={placement === value}
                        onChange={() => {
                          markFormEdited();
                          setPlacement(value);
                        }}
                      />
                      <StatusIcon kind={value} />
                      <span>{PLACEMENT_LABELS[value]}</span>
                    </label>
                  ))}
                </div>
                <p className="decision-help">
                  {placement ? (
                    <button type="button" onClick={() => {
                      markFormEdited();
                      setPlacement(undefined);
                    }}>
                      Clear classification
                    </button>
                  ) : (
                    "No classification selected — your note can stand on its own."
                  )}
                </p>
              </fieldset>

              <label>
                <span>Reason <i>optional</i></span>
                <select value={reason} onChange={(event) => {
                  markFormEdited();
                  setReason(event.target.value);
                }}>
                  <option value="">Choose a reusable reason</option>
                  {CURATION_REASONS.map((value) => (
                    <option key={value} value={value}>{REASON_LABELS[value]}</option>
                  ))}
                </select>
              </label>

              <label>
                <span>
                  Reviewer note <i>{placement ? "optional" : "note only"}</i>
                </span>
                <textarea
                  value={comment}
                  onChange={(event) => {
                    markFormEdited();
                    setComment(event.target.value);
                  }}
                  placeholder="Why this is ambiguous, or what broader rule it suggests…"
                />
              </label>

              <div className="form-actions">
                <button
                  className="primary-action"
                  type="submit"
                  disabled={saving || (!placement && !comment.trim())}
                >
                  {placement ? "File decision" : "Save note"} →
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
                {getDecisionForReviewItem(places, selectedItem) && (
                  <button
                    className="text-action"
                    type="button"
                    disabled={saving}
                    onClick={() => void removeDecision(selectedItem)}
                  >
                    Remove saved policy
                  </button>
                )}
              </div>
            </form>
          )}
        </section>

        <section className="queue panel">
          <div className="panel__heading panel__heading--queue">
            <div>
              <span>
                {reviewView === "reserve"
                  ? "RESERVE REGISTER 02"
                  : "LIVE REGISTER 02"}
              </span>
              <h2>
                {reviewView === "reserve" ? "Reserve catalog" : "Commute queue"}
              </h2>
            </div>
            <div className="queue-controls">
              {reviewView === "reserve" ? (
                <>
                  <select
                    aria-label="Reserve source mode"
                    value={reserveMode}
                    onChange={(event) =>
                      setReserveMode(event.target.value as ReserveSourceMode | "all")
                    }
                  >
                    <option value="trusted-editorial">Trusted editorial</option>
                    <option value="discovery-only">Discovery only</option>
                    <option value="all">All source modes</option>
                  </select>
                  <select
                    aria-label="Reserve source collection"
                    value={reserveSource}
                    onChange={(event) => setReserveSource(event.target.value)}
                  >
                    <option value="all">All collections</option>
                    {reserveSources.map((source) => (
                      <option key={source} value={source}>{source}</option>
                    ))}
                  </select>
                </>
              ) : (
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
              )}
              <button
                type="button"
                onClick={() => setShowReviewed((value) => !value)}
              >
                {showReviewed ? "Hide reviewed" : "Show reviewed"}
              </button>
              <button
                type="button"
                onClick={() => void (
                  reviewView === "reserve"
                    ? loadReserveCatalog()
                    : loadQueue()
                )}
              >
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
                          {"reserve" in item
                            ? item.reserve.sourceMode === "trusted-editorial"
                              ? "Trusted source"
                              : "Discovery only"
                            : ROUTE_LABELS[item.currentDisposition]}
                        </span>
                      </span>
                      <span className="place-card__subtitle">
                        {item.title ?? "Scenery domain"}
                      </span>
                      {"reserve" in item && (
                        <span className="place-card__source">
                          {item.reserve.sourceCollection}
                          {item.reserve.issue ? ` · ${item.reserve.issue}` : ""}
                        </span>
                      )}
                      {priorDecision && (
                        <b
                          className={`decision-mark ${
                            priorDecision.placement
                              ? `status-tone--${placementTone(priorDecision.placement)}`
                              : "status-tone--neutral"
                          }`}
                        >
                          <StatusIcon
                            kind={priorDecision.placement ?? "note"}
                          />
                          {priorDecision.placement
                            ? PLACEMENT_LABELS[priorDecision.placement]
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
              {activeGeneratedAt
                ? reviewView === "reserve"
                  ? `Catalog generated ${relativeTime(activeGeneratedAt)}`
                  : `Route sampled ${relativeTime(activeGeneratedAt)}`
                : reviewView === "reserve"
                  ? "No reserve catalog loaded"
                  : "No route loaded"}
            </span>
            <span>
              {reviewView === "reserve"
                ? `${filteredReserveItems.length} shown · ${reserveItems.length} reserve`
                : `${liveItems.length} live · ${evidenceItems.length} audited`}
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
  const [authError, setAuthError] = useState("");
  const logout = useCallback(() => {
    sessionStorage.removeItem(TOKEN_STORAGE_KEY);
    setToken("");
  }, []);
  if (!token) {
    return (
      <Login
        error={authError}
        onLogin={(nextToken) => {
          setAuthError("");
          sessionStorage.setItem(TOKEN_STORAGE_KEY, nextToken);
          setToken(nextToken);
        }}
      />
    );
  }
  return (
    <App
      token={token}
      onLogout={logout}
      onUnauthorized={() => {
        setAuthError("That admin key was rejected. Check the current Worker key and try again.");
        logout();
      }}
    />
  );
}

createRoot(document.getElementById("root")!).render(
  <React.StrictMode><CurationDesk /></React.StrictMode>,
);
