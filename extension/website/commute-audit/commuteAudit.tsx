// ABOUTME: Renders the local Internet Commute history audit dashboard.
// ABOUTME: Supports trend, overlap, reach, domain, and destination exploration.

import "./commuteAudit.scss";

import React, { useEffect, useMemo, useState } from "react";
import ReactDOM from "react-dom/client";

import type {
  AuditCategory,
  CommuteAuditData,
  DomainAggregate,
  RankedPage,
  ReachTier,
} from "./auditTypes";

const CATEGORY_COLORS: Record<AuditCategory, string> = {
  "Arts & culture": "#cf5f46",
  Games: "#7559a8",
  "Learning & reference": "#327d71",
  "News & current events": "#b44545",
  Shopping: "#b07a2d",
  "Social & community": "#366ba8",
  Technology: "#555fbd",
  "Travel & places": "#33868c",
  "Video & audio": "#9b4e7f",
  "Work & tools": "#697030",
  Other: "#77736d",
};

function compact(value: number): string {
  return new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(value);
}

function duration(value: number): string {
  const hours = value / 3_600_000;
  if (hours >= 1_000) return `${compact(hours)} hr`;
  if (hours >= 1) return `${hours.toFixed(hours >= 10 ? 0 : 1)} hr`;
  return `${Math.round(value / 60_000)} min`;
}

function percent(value: number, total: number): string {
  return total > 0 ? `${Math.round((value / total) * 100)}%` : "0%";
}

function Stat({ label, value, detail }: { label: string; value: string; detail: string }) {
  return (
    <article className="stat">
      <p>{label}</p>
      <strong>{value}</strong>
      <small>{detail}</small>
    </article>
  );
}

function EmptyState({ error }: { error?: string }) {
  return (
    <main className="audit-shell audit-shell--empty">
      <p className="eyebrow">Internal research surface</p>
      <h1>Internet Commute history audit</h1>
      <p className="empty-copy">
        {error ?? "No generated audit data was found."} Run <code>bun run --cwd extension/website audit:commute</code>, then reload this page.
      </p>
    </main>
  );
}

function TrendChart({ data, category }: { data: CommuteAuditData; category: AuditCategory | "All" }) {
  const values = data.weeks.map((week) => category === "All" ? week.visits : week.categories[category] ?? 0);
  const max = Math.max(1, ...values);
  const width = Math.max(760, data.weeks.length * 24);
  const height = 190;
  const points = values.map((value, index) => {
    const x = data.weeks.length === 1 ? width / 2 : (index / (data.weeks.length - 1)) * (width - 20) + 10;
    const y = height - 18 - (value / max) * (height - 40);
    return `${x},${y}`;
  }).join(" ");

  return (
    <div className="trend-scroll">
      <svg className="trend-chart" viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`Weekly ${category.toLowerCase()} browsing visits`}>
        <line x1="10" x2={width - 10} y1={height - 18} y2={height - 18} />
        <polyline points={points} fill="none" stroke={category === "All" ? "#20201d" : CATEGORY_COLORS[category]} strokeWidth="3" />
        {values.map((value, index) => {
          const [x, y] = points.split(" ")[index].split(",");
          return <circle key={data.weeks[index].week} cx={x} cy={y} r="3" fill={category === "All" ? "#20201d" : CATEGORY_COLORS[category]}><title>{data.weeks[index].week}: {value.toLocaleString()} visits</title></circle>;
        })}
      </svg>
      <div className="trend-labels"><span>{data.weeks[0]?.week}</span><span>{data.weeks.at(-1)?.week}</span></div>
    </div>
  );
}

function CategoryBars({ data }: { data: CommuteAuditData }) {
  const total = data.categories.reduce((sum, row) => sum + row.screenTimeMs, 0);
  return (
    <div className="bar-list">
      {data.categories.map((row) => (
        <div className="bar-row" key={row.category}>
          <div className="bar-label"><span className="swatch" style={{ background: CATEGORY_COLORS[row.category] }} />{row.category}</div>
          <div className="bar-track"><span style={{ width: percent(row.screenTimeMs, total), background: CATEGORY_COLORS[row.category] }} /></div>
          <strong>{percent(row.screenTimeMs, total)}</strong>
          <small>{duration(row.screenTimeMs)} · {row.domains.toLocaleString()} domains</small>
        </div>
      ))}
    </div>
  );
}

function ReachCards({ data }: { data: CommuteAuditData }) {
  const totalTime = data.reach.reduce((sum, row) => sum + row.screenTimeMs, 0);
  return (
    <div className="reach-grid">
      {data.reach.map((row) => (
        <article key={row.tier}>
          <header><strong>{row.tier}</strong><span>{percent(row.screenTimeMs, totalTime)} of time</span></header>
          <div className="reach-number">{row.domains.toLocaleString()}</div>
          <p>domains · {compact(row.visits)} visits · {duration(row.screenTimeMs)}</p>
          <small>{row.tier === "Solo" ? "seen by 1 person" : row.tier === "Shared" ? "seen by 2–4 people" : "seen by 5+ people"}</small>
        </article>
      ))}
    </div>
  );
}

function OverlapGrid({ data }: { data: CommuteAuditData }) {
  const categories = data.categories.slice(0, 8).map((row) => row.category);
  const values = data.overlap.filter((cell) => categories.includes(cell.first) && categories.includes(cell.second));
  const max = Math.max(1, ...values.map((cell) => cell.participants));
  return (
    <div className="overlap-wrap">
      <div className="overlap-grid" style={{ gridTemplateColumns: `180px repeat(${categories.length}, minmax(42px, 1fr))` }}>
        <span />
        {categories.map((category) => <span className="overlap-column" key={category}>{category}</span>)}
        {categories.map((first) => (
          <React.Fragment key={first}>
            <strong>{first}</strong>
            {categories.map((second) => {
              const value = values.find((cell) => cell.first === first && cell.second === second)?.participants ?? 0;
              const alpha = 0.08 + (value / max) * 0.82;
              return <span className="overlap-cell" key={second} style={{ background: `rgba(50, 125, 113, ${alpha})` }} title={`${value} people browsed both ${first} and ${second}`}>{value}</span>;
            })}
          </React.Fragment>
        ))}
      </div>
    </div>
  );
}

function RankingTable({ pages }: { pages: RankedPage[] }) {
  return (
    <div className="table-wrap">
      <table>
        <thead><tr><th>Rank</th><th>Destination</th><th>Score</th><th>Category</th><th>Site reach</th><th>Evidence</th></tr></thead>
        <tbody>{pages.map((page) => (
          <tr key={page.url}>
            <td className="rank">{page.rank}</td>
            <td><a href={page.url} target="_blank" rel="noreferrer">{page.title}</a><small>{page.domain}</small></td>
            <td><span className="score">{page.score}</span></td>
            <td><span className="category-pill" style={{ borderColor: CATEGORY_COLORS[page.category] }}>{page.category}</span></td>
            <td>{page.reach}</td>
            <td className="evidence">{page.reasons.join(" · ")}</td>
          </tr>
        ))}</tbody>
      </table>
    </div>
  );
}

function DomainTable({ domains }: { domains: DomainAggregate[] }) {
  return (
    <div className="table-wrap">
      <table>
        <thead><tr><th>Domain</th><th>Category</th><th>Reach</th><th>People</th><th>Visits</th><th>Time</th><th>Public / private</th></tr></thead>
        <tbody>{domains.map((domain) => (
          <tr key={domain.domain}>
            <td><strong>{domain.domain}</strong></td>
            <td>{domain.category}</td><td>{domain.reach}</td><td>{domain.participants}</td>
            <td>{domain.visits.toLocaleString()}</td><td>{duration(domain.screenTimeMs)}</td>
            <td><span className="privacy-split"><i style={{ width: percent(domain.publicVisits, domain.visits) }} /></span><small>{domain.publicVisits.toLocaleString()} / {domain.privateVisits.toLocaleString()}</small></td>
          </tr>
        ))}</tbody>
      </table>
    </div>
  );
}

function AuditDashboard({ data }: { data: CommuteAuditData }) {
  const [trendCategory, setTrendCategory] = useState<AuditCategory | "All">("All");
  const [rankCategory, setRankCategory] = useState<AuditCategory | "All">("All");
  const [rankReach, setRankReach] = useState<ReachTier | "All">("All");
  const [domainQuery, setDomainQuery] = useState("");
  const [domainReach, setDomainReach] = useState<ReachTier | "All">("All");

  const rankedPages = useMemo(() => data.rankedPages.filter((page) =>
    (rankCategory === "All" || page.category === rankCategory) &&
    (rankReach === "All" || page.reach === rankReach)
  ).slice(0, 75), [data, rankCategory, rankReach]);
  const domains = useMemo(() => data.domains.filter((domain) =>
    domain.domain.includes(domainQuery.trim().toLowerCase()) &&
    (domainReach === "All" || domain.reach === domainReach)
  ).slice(0, 150), [data, domainQuery, domainReach]);
  const classifiedVisits = data.summary.publicVisits + data.summary.privateVisits;

  return (
    <main className="audit-shell">
      <header className="hero">
        <div><p className="eyebrow">Internal research surface · generated {new Date(data.summary.generatedAt).toLocaleString()}</p><h1>Internet Commute history audit</h1><p className="lede">A cohort-wide look at what people browse, where their paths overlap, and which specific pages might make good stops.</p></div>
        <div className="date-range"><span>{data.summary.startDate.slice(0, 10)}</span><i /><span>{data.summary.endDate.slice(0, 10)}</span></div>
      </header>

      <section className="stats-grid">
        <Stat label="Navigation events" value={compact(data.summary.navigationEvents)} detail="all retained UTC-day intervals" />
        <Stat label="People" value={data.summary.participants.toLocaleString()} detail="anonymous participant IDs" />
        <Stat label="Observed domains" value={data.summary.domains.toLocaleString()} detail={`${data.summary.pages.toLocaleString()} public page candidates`} />
        <Stat label="Paired attention" value={duration(data.summary.pairedScreenTimeMs)} detail={`${compact(data.summary.focusVisits)} focus visits`} />
      </section>

      <section className="panel panel--wide">
        <div className="panel-heading"><div><p className="section-number">01</p><h2>Browsing changed over time</h2><p>Weekly focus visits across the full retained range. Choose a category to isolate its trend.</p></div><select value={trendCategory} onChange={(event) => setTrendCategory(event.target.value as AuditCategory | "All")}><option>All</option>{data.categories.map((row) => <option key={row.category}>{row.category}</option>)}</select></div>
        <TrendChart data={data} category={trendCategory} />
      </section>

      <div className="two-column">
        <section className="panel"><p className="section-number">02</p><h2>Attention by category</h2><p>Share of paired screen time. Unclassified activity stays visible as Other.</p><CategoryBars data={data} /></section>
        <section className="panel"><p className="section-number">03</p><h2>Public versus private</h2><p>Public pages pass the current commute policy with a sanitized URL. Private activity contributes domain-level scenery only.</p><div className="donut-row"><div className="donut" style={{ "--public-share": `${(data.summary.publicVisits / Math.max(1, classifiedVisits)) * 360}deg` } as React.CSSProperties}><span>{percent(data.summary.publicVisits, classifiedVisits)}<small>public</small></span></div><dl><div><dt>Public</dt><dd>{data.summary.publicVisits.toLocaleString()}</dd></div><div><dt>Private</dt><dd>{data.summary.privateVisits.toLocaleString()}</dd></div><div><dt>Excluded</dt><dd>{data.summary.excludedVisits.toLocaleString()}</dd></div></dl></div></section>
      </div>

      <section className="panel panel--wide"><p className="section-number">04</p><h2>Small versus large in this network</h2><p>This measures observed reach, not global traffic. Solo domains appeared for one person, Shared for 2–4 people, and Common for 5 or more.</p><ReachCards data={data} /></section>

      <section className="panel panel--wide"><p className="section-number">05</p><h2>Where people overlap</h2><p>Each cell counts people who browsed both categories at least once.</p><OverlapGrid data={data} /></section>

      <section className="panel panel--wide"><div className="panel-heading"><div><p className="section-number">06</p><h2>Initial commute ranking</h2><p>Specific public pages ranked with visible evidence. This is a research score, not a production recommendation engine.</p></div><div className="filters"><select value={rankCategory} onChange={(event) => setRankCategory(event.target.value as AuditCategory | "All")}><option>All</option>{data.categories.map((row) => <option key={row.category}>{row.category}</option>)}</select><select value={rankReach} onChange={(event) => setRankReach(event.target.value as ReachTier | "All")}><option>All</option><option>Solo</option><option>Shared</option><option>Common</option></select></div></div><RankingTable pages={rankedPages} /></section>

      <div className="two-column">
        <section className="panel"><p className="section-number">07</p><h2>Common category handoffs</h2><p>Consecutive focus visits within the same browser session.</p><ol className="transition-list">{data.transitions.slice(0, 12).map((transition) => <li key={`${transition.from}-${transition.to}`}><span>{transition.from}</span><b>→</b><span>{transition.to}</span><strong>{transition.count.toLocaleString()}</strong></li>)}</ol></section>
        <section className="panel"><p className="section-number">08</p><h2>How to read this</h2><ul className="notes">{data.notes.map((note) => <li key={note}>{note}</li>)}</ul></section>
      </div>

      <section className="panel panel--wide"><div className="panel-heading"><div><p className="section-number">09</p><h2>Domain explorer</h2><p>URLs classified as private never appear here. Domain-level aggregates remain available for comparing attention and reach.</p></div><div className="filters"><input aria-label="Search domains" placeholder="Search domains" value={domainQuery} onChange={(event) => setDomainQuery(event.target.value)} /><select value={domainReach} onChange={(event) => setDomainReach(event.target.value as ReachTier | "All")}><option>All</option><option>Solo</option><option>Shared</option><option>Common</option></select></div></div><DomainTable domains={domains} /></section>
    </main>
  );
}

function App() {
  const [data, setData] = useState<CommuteAuditData | null>(null);
  const [error, setError] = useState<string>();
  useEffect(() => {
    fetch("/commute-audit-data.json", { cache: "no-store" })
      .then((response) => { if (!response.ok) throw new Error(`Audit data request failed (${response.status})`); return response.json(); })
      .then((payload) => setData(payload as CommuteAuditData))
      .catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "Audit data could not be loaded"));
  }, []);
  if (!data) return <EmptyState error={error} />;
  return <AuditDashboard data={data} />;
}

ReactDOM.createRoot(document.getElementById("audit-root") as HTMLElement).render(<App />);
