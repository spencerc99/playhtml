// ABOUTME: Renders the local Internet Commute classification and promotion evaluation workbench.
// ABOUTME: Supports evidence review, correction export, formula comparison, and cohort context.
/* eslint-disable react-refresh/only-export-components -- This Vite entry owns both the page components and root mount. */

import "./commuteAudit.scss";

import React, { useEffect, useMemo, useState } from "react";
import ReactDOM from "react-dom/client";

import type { CommuteAuditData } from "./auditTypes";
import {
  CHARACTER_LABELS,
  CONTENT_CATEGORIES,
  EXPOSURE_LABELS,
  PAGE_TYPES,
  PROMOTION_JUDGMENTS,
  SAMPLE_LANES,
  type CharacterLabel,
  type CommuteEvaluationData,
  type ContentCategory,
  type EvaluationCandidate,
  type ExposureLabel,
  type FormulaScores,
  type PageType,
  type PromotionJudgment,
  type SampleLane,
} from "./evaluationTypes";

const CORRECTIONS_KEY = "commute-evaluation-corrections-v2";
const FORMULA_LABELS: Record<keyof FormulaScores, string> = {
  balanced: "Balanced",
  longTail: "Rare domains",
  hiddenPlatform: "Hidden platform items",
  humanWeb: "Human web",
};

interface Correction {
  category?: ContentCategory;
  pageType?: PageType;
  exposure?: ExposureLabel;
  character?: CharacterLabel;
  judgment?: PromotionJudgment;
  updatedAt: string;
}

type Corrections = Record<string, Correction>;

function compact(value: number): string {
  return new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(value);
}

function duration(value: number): string {
  const hours = value / 3_600_000;
  if (hours >= 1_000) return `${compact(hours)} hr`;
  if (hours >= 1) return `${hours.toFixed(hours >= 10 ? 0 : 1)} hr`;
  return `${Math.round(value / 60_000)} min`;
}

function percent(value: number): string {
  return `${Math.round(value * 100)}%`;
}

function downloadJson(filename: string, payload: unknown): void {
  const link = document.createElement("a");
  link.href = URL.createObjectURL(new Blob([`${JSON.stringify(payload, null, 2)}\n`], { type: "application/json" }));
  link.download = filename;
  link.click();
  URL.revokeObjectURL(link.href);
}

function EmptyState({ error }: { error?: string }) {
  return (
    <main className="audit-shell audit-shell--empty">
      <p className="eyebrow">Internal research surface</p>
      <h1>Internet Commute evaluation</h1>
      <p className="empty-copy">
        {error ?? "No generated evaluation data was found."} Run <code>bun run --cwd extension/website audit:commute</code>, then reload this page.
      </p>
    </main>
  );
}

function Stat({ label, value, detail }: { label: string; value: string; detail: string }) {
  return <article className="stat"><p>{label}</p><strong>{value}</strong><small>{detail}</small></article>;
}

function FormulaComparison({ data, corrections }: { data: CommuteEvaluationData; corrections: Corrections }) {
  const reviewed = new Set(Object.entries(corrections).filter(([, correction]) => correction.judgment).map(([id]) => id));
  return (
    <div className="formula-grid">
      {data.formulas.map((summary) => {
        const rows = [...data.candidates].sort((first, second) => second.scores[summary.formula] - first.scores[summary.formula]).slice(0, 50);
        const judged = rows.filter((candidate) => reviewed.has(candidate.id) && corrections[candidate.id].judgment !== "Uncertain");
        const promoted = judged.filter((candidate) => corrections[candidate.id].judgment === "Promote").length;
        return (
          <article key={summary.formula}>
            <header><h3>{FORMULA_LABELS[summary.formula]}</h3><strong>{judged.length === 0 ? "—" : percent(promoted / judged.length)}</strong></header>
            <p>manual precision in reviewed sample top 50</p>
            <dl>
              <div><dt>Bootstrap promote</dt><dd>{summary.promotedInTop50}/50</dd></div>
              <div><dt>Unique domains</dt><dd>{summary.uniqueDomainsInTop50}</dd></div>
              <div><dt>Major platforms</dt><dd>{percent(summary.mainstreamShare)}</dd></div>
              <div><dt>Reviewed</dt><dd>{judged.length}</dd></div>
            </dl>
          </article>
        );
      })}
    </div>
  );
}

function CoverageTable({ data }: { data: CommuteEvaluationData }) {
  return (
    <div className="coverage-table">
      {data.coverage.map((row) => (
        <div key={row.dimension}>
          <strong>{row.dimension}</strong>
          <span className="coverage-track"><i style={{ width: percent(row.classified / Math.max(1, row.total)) }} /></span>
          <span>{percent(row.classified / Math.max(1, row.total))} classified</span>
          <small>{row.uncertain.toLocaleString()} uncertain · {percent(row.averageConfidence)} mean confidence</small>
        </div>
      ))}
    </div>
  );
}

function CandidateList({ candidates, selectedId, formula, corrections, onSelect }: {
  candidates: EvaluationCandidate[];
  selectedId?: string;
  formula: keyof FormulaScores;
  corrections: Corrections;
  onSelect(id: string): void;
}) {
  return (
    <div className="candidate-list" role="list">
      {candidates.map((candidate, index) => {
        const judgment = corrections[candidate.id]?.judgment ?? candidate.initialJudgment.value;
        return (
          <button type="button" className={candidate.id === selectedId ? "candidate-row candidate-row--selected" : "candidate-row"} onClick={() => onSelect(candidate.id)} key={candidate.id}>
            <span className="candidate-rank">{index + 1}</span>
            <span className="candidate-name"><strong>{candidate.title}</strong><small>{candidate.domain} · {candidate.pageType.value}</small></span>
            <span className={`judgment judgment--${judgment.toLowerCase().replaceAll(" ", "-")}`}>{judgment}</span>
            <span className="candidate-score">{candidate.scores[formula]}</span>
          </button>
        );
      })}
      {candidates.length === 0 && <p className="no-results">No candidates match these filters.</p>}
    </div>
  );
}

function LabelSelect<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: readonly T[]; onChange(value: T): void }) {
  return <label><span>{label}</span><select value={value} onChange={(event) => onChange(event.target.value as T)}>{options.map((option) => <option key={option}>{option}</option>)}</select></label>;
}

function CandidateDetail({ candidate, correction, onChange, onRevert }: { candidate: EvaluationCandidate; correction?: Correction; onChange(patch: Partial<Correction>): void; onRevert(): void }) {
  const category = correction?.category ?? candidate.category.value;
  const pageType = correction?.pageType ?? candidate.pageType.value;
  const exposure = correction?.exposure ?? candidate.exposure.value;
  const character = correction?.character ?? candidate.character.value;
  const judgment = correction?.judgment ?? candidate.initialJudgment.value;
  const componentRows: Array<[string, number | null]> = [
    ["Page rarity", candidate.components.pageRarity], ["Domain rarity", candidate.components.domainRarity],
    ["External rarity", candidate.components.externalRarity], ["Attention", candidate.components.attentionQuality],
    ["Convergence", candidate.components.convergence], ["Specificity", candidate.components.specificity],
    ["Human signal", candidate.components.humanConfidence], ["Evidence", candidate.components.evidenceConfidence],
  ];

  return (
    <aside className="candidate-detail">
      <div className="detail-heading"><div><p className="eyebrow">Evidence review</p><h3>{candidate.title}</h3><a href={candidate.url} target="_blank" rel="noreferrer">{candidate.domain} ↗</a></div><span className="detail-score">{candidate.scores.balanced}<small>balanced</small></span></div>
      <div className="observation-grid">
        <div><strong>{candidate.observation.participants}</strong><span>people</span></div>
        <div><strong>{candidate.observation.visits}</strong><span>visits</span></div>
        <div><strong>{duration(candidate.observation.screenTimeMs)}</strong><span>paired attention</span></div>
        <div><strong>{candidate.observation.domainParticipants}</strong><span>people on domain</span></div>
      </div>
      <div className="label-grid">
        <LabelSelect label="Content" value={category} options={CONTENT_CATEGORIES} onChange={(value) => onChange({ category: value })} />
        <LabelSelect label="Page type" value={pageType} options={PAGE_TYPES} onChange={(value) => onChange({ pageType: value })} />
        <LabelSelect label="Exposure" value={exposure} options={EXPOSURE_LABELS} onChange={(value) => onChange({ exposure: value })} />
        <LabelSelect label="Character" value={character} options={CHARACTER_LABELS} onChange={(value) => onChange({ character: value })} />
      </div>
      <div className="judgment-control"><span>Should this be promoted?</span><div>{PROMOTION_JUDGMENTS.map((value) => <button type="button" aria-pressed={judgment === value} onClick={() => onChange({ judgment: value })} key={value}>{value}</button>)}</div>{correction && <button type="button" className="revert-correction" onClick={onRevert}>Revert this correction</button>}</div>
      <section className="evidence-section"><h4>Why the system said this</h4><ul>{candidate.category.reasons.concat(candidate.pageType.reasons, candidate.character.reasons, candidate.initialJudgment.reasons).map((reason, index) => <li key={`${reason}-${index}`}>{reason}</li>)}</ul></section>
      <section className="evidence-section"><h4>Score anatomy</h4><div className="component-list">{componentRows.map(([label, value]) => <div key={label}><span>{label}</span><i><b style={{ width: value === null ? "0" : percent(value) }} /></i><strong>{value === null ? "—" : Math.round(value * 100)}</strong></div>)}</div></section>
      <section className="evidence-section"><h4>Sample lanes</h4><p>{candidate.lanes.join(" · ")}</p><small>Last seen {new Date(candidate.observation.lastSeen).toLocaleDateString()} · external evidence {candidate.external.status}</small></section>
    </aside>
  );
}

function ContextSnapshot({ data }: { data?: CommuteAuditData }) {
  if (!data) return <p className="context-missing">The older trend snapshot is not present. Generate it with <code>bun run --cwd extension/website audit:commute:history</code>.</p>;
  const totalReachTime = data.reach.reduce((sum, row) => sum + row.screenTimeMs, 0);
  return (
    <div className="context-grid">
      <div><h3>Attention by observed site reach</h3>{data.reach.map((row) => <div className="context-bar" key={row.tier}><span>{row.tier}</span><i><b style={{ width: percent(row.screenTimeMs / Math.max(1, totalReachTime)) }} /></i><strong>{percent(row.screenTimeMs / Math.max(1, totalReachTime))}</strong><small>{row.domains.toLocaleString()} domains</small></div>)}</div>
      <div><h3>Largest attention categories</h3>{data.categories.slice(0, 7).map((row) => <div className="context-category" key={row.category}><span>{row.category}</span><strong>{duration(row.screenTimeMs)}</strong><small>{row.domains.toLocaleString()} domains</small></div>)}</div>
    </div>
  );
}

function Workbench({ data, history }: { data: CommuteEvaluationData; history?: CommuteAuditData }) {
  const [corrections, setCorrections] = useState<Corrections>(() => {
    try { return JSON.parse(localStorage.getItem(CORRECTIONS_KEY) ?? "{}"); } catch { return {}; }
  });
  const [formula, setFormula] = useState<keyof FormulaScores>("balanced");
  const [lane, setLane] = useState<SampleLane | "All">("All");
  const [judgment, setJudgment] = useState<PromotionJudgment | "All">("All");
  const [domainCap, setDomainCap] = useState(3);
  const [query, setQuery] = useState("");
  const filtered = useMemo(() => {
    const domainCounts = new Map<string, number>();
    return data.candidates
      .filter((candidate) => lane === "All" || candidate.lanes.includes(lane))
      .filter((candidate) => judgment === "All" || (corrections[candidate.id]?.judgment ?? candidate.initialJudgment.value) === judgment)
      .filter((candidate) => `${candidate.title} ${candidate.domain} ${corrections[candidate.id]?.category ?? candidate.category.value} ${corrections[candidate.id]?.pageType ?? candidate.pageType.value}`.toLowerCase().includes(query.trim().toLowerCase()))
      .sort((first, second) => second.scores[formula] - first.scores[formula])
      .filter((candidate) => {
        const count = domainCounts.get(candidate.domain) ?? 0;
        if (count >= domainCap) return false;
        domainCounts.set(candidate.domain, count + 1);
        return true;
      });
  }, [corrections, data, domainCap, formula, judgment, lane, query]);
  const [selectedId, setSelectedId] = useState<string>();
  const selected = filtered.find((candidate) => candidate.id === selectedId) ?? filtered[0];
  const reviewed = Object.values(corrections).filter((correction) => correction.judgment).length;
  const falsePositives = data.candidates.filter((candidate) => candidate.initialJudgment.value === "Promote" && corrections[candidate.id]?.judgment === "Do not promote").length;
  const falseNegatives = data.candidates.filter((candidate) => candidate.initialJudgment.value !== "Promote" && corrections[candidate.id]?.judgment === "Promote").length;

  function updateCorrection(id: string, patch: Partial<Correction>): void {
    setCorrections((current) => {
      const next = { ...current, [id]: { ...current[id], ...patch, updatedAt: new Date().toISOString() } };
      localStorage.setItem(CORRECTIONS_KEY, JSON.stringify(next));
      return next;
    });
  }

  function revertCorrection(id: string): void {
    setCorrections((current) => {
      const next = { ...current };
      delete next[id];
      localStorage.setItem(CORRECTIONS_KEY, JSON.stringify(next));
      return next;
    });
  }

  async function importCorrections(file?: File): Promise<void> {
    if (!file) return;
    const payload = JSON.parse(await file.text()) as { corrections?: Corrections };
    if (!payload.corrections || typeof payload.corrections !== "object") throw new Error("Correction file is missing corrections");
    const candidateIds = new Set(data.candidates.map((candidate) => candidate.id));
    const imported = Object.fromEntries(Object.entries(payload.corrections).filter(([id]) => candidateIds.has(id)));
    const next = { ...corrections, ...imported };
    localStorage.setItem(CORRECTIONS_KEY, JSON.stringify(next));
    setCorrections(next);
  }

  return (
    <main className="audit-shell">
      <header className="hero"><div><p className="eyebrow">Internal evaluation workbench · generated {new Date(data.summary.generatedAt).toLocaleString()}</p><h1>Finding the human web</h1><p className="lede">Test which evidence can classify pages consistently and surface hidden gems without mistaking a large platform for a popular item.</p></div><div className="date-range"><span>{data.summary.startDate.slice(0, 10)}</span><i /><span>{data.summary.endDate.slice(0, 10)}</span></div></header>
      <section className="stats-grid">
        <Stat label="Unique public pages" value={compact(data.summary.publicPages)} detail={`${compact(data.summary.navigationEvents)} navigation events processed`} />
        <Stat label="Evaluation sample" value={data.summary.candidates.toLocaleString()} detail="eight overlapping diagnostic lanes" />
        <Stat label="Manual judgments" value={reviewed.toLocaleString()} detail={`${falsePositives} false positive · ${falseNegatives} false negative`} />
        <Stat label="Metadata coverage" value={percent(data.summary.metadataCoverage)} detail={`${data.summary.enrichmentAvailable} candidates externally enriched`} />
      </section>

      <section className="panel panel--wide"><p className="section-number">01 · Compare objectives</p><h2>No single “quality” score</h2><p>Each formula expresses a different product choice. Precision remains blank until you review candidates; domain diversity and platform share expose what each objective rewards.</p><FormulaComparison data={data} corrections={corrections} /></section>

      <section className="panel panel--wide"><div className="panel-heading"><div><p className="section-number">02 · Build ground truth</p><h2>Review the hard cases</h2><p>The queue combines rare domains, hidden platform items, independent convergence, low-confidence pages, and controls. Corrections stay in this browser until exported.</p></div><div className="review-actions"><strong>{reviewed} reviewed</strong><label className="import-corrections">Import corrections<input type="file" accept="application/json" onChange={(event) => { void importCorrections(event.target.files?.[0]); event.target.value = ""; }} /></label><button type="button" onClick={() => downloadJson("commute-evaluation-corrections.json", { version: 1, generatedAt: new Date().toISOString(), sourceGeneratedAt: data.summary.generatedAt, corrections })}>Export corrections</button></div></div>
        <div className="queue-filters"><input aria-label="Search candidates" placeholder="Search title, domain, or label" value={query} onChange={(event) => setQuery(event.target.value)} /><select aria-label="Ranking formula" value={formula} onChange={(event) => setFormula(event.target.value as keyof FormulaScores)}>{Object.entries(FORMULA_LABELS).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select><select aria-label="Sample lane" value={lane} onChange={(event) => setLane(event.target.value as SampleLane | "All")}><option>All</option>{SAMPLE_LANES.map((value) => <option key={value}>{value}</option>)}</select><select aria-label="Promotion judgment" value={judgment} onChange={(event) => setJudgment(event.target.value as PromotionJudgment | "All")}><option>All</option>{PROMOTION_JUDGMENTS.map((value) => <option key={value}>{value}</option>)}</select><select aria-label="Maximum pages per domain" value={domainCap} onChange={(event) => setDomainCap(Number(event.target.value))}><option value="1">1 per domain</option><option value="3">3 per domain</option><option value="10">10 per domain</option><option value="999">No domain cap</option></select></div>
        <div className="workbench-grid"><CandidateList candidates={filtered} selectedId={selected?.id} formula={formula} corrections={corrections} onSelect={setSelectedId} />{selected && <CandidateDetail candidate={selected} correction={corrections[selected.id]} onChange={(patch) => updateCorrection(selected.id, patch)} onRevert={() => revertCorrection(selected.id)} />}</div>
      </section>

      <div className="two-column">
        <section className="panel"><p className="section-number">03 · Coverage</p><h2>Where rules still guess</h2><p>Uncertainty is retained rather than collapsed into a convenient category.</p><CoverageTable data={data} /></section>
        <section className="panel"><p className="section-number">04 · Sample design</p><h2>What enters review</h2><p>Lane overlap is intentional: it reveals candidates that satisfy multiple definitions of a hidden gem.</p><div className="lane-list">{data.lanes.map((row) => <div key={row.lane}><strong>{row.lane}</strong><span>{row.candidates}</span><small>{row.promote} promote · {row.doNotPromote} reject · {row.uncertain} uncertain</small></div>)}</div></section>
      </div>

      <section className="panel panel--wide"><p className="section-number">05 · Cohort context</p><h2>Small and large sites in the browsing network</h2><p>These are supporting trends, not ranking inputs. Site size means reach inside this cohort; external popularity is a separate signal.</p><ContextSnapshot data={history} /></section>

      <section className="panel panel--wide methodology"><p className="section-number">06 · Interpretation</p><h2>What this test can answer</h2><ul>{data.notes.map((note) => <li key={note}>{note}</li>)}</ul><p><strong>Cost path:</strong> URL and stored metadata rules run for every page. Public-page fetches and platform metadata are reserved for ambiguous or high-value review candidates. Manual corrections become the benchmark for measuring future rules and models.</p></section>
    </main>
  );
}

function App() {
  const [data, setData] = useState<CommuteEvaluationData>();
  const [history, setHistory] = useState<CommuteAuditData>();
  const [error, setError] = useState<string>();
  useEffect(() => {
    fetch("/commute-evaluation-data.json", { cache: "no-store" })
      .then((response) => { if (!response.ok) throw new Error(`Evaluation data request failed (${response.status})`); return response.json(); })
      .then((payload) => setData(payload as CommuteEvaluationData))
      .catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "Evaluation data could not be loaded"));
    fetch("/commute-audit-data.json", { cache: "no-store" }).then((response) => response.ok ? response.json() : undefined).then((payload) => setHistory(payload as CommuteAuditData | undefined)).catch(() => undefined);
  }, []);
  if (!data) return <EmptyState error={error} />;
  return <Workbench data={data} history={history} />;
}

ReactDOM.createRoot(document.getElementById("audit-root") as HTMLElement).render(<App />);
