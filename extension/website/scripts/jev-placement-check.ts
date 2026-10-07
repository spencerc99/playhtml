// ABOUTME: Runs the labeled commute placement set through Jev and writes a report
// ABOUTME: comparing its derived placements against Spencer's human labels.

import { mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { buildTestset, type TestsetItem } from "./jevPlacement/buildTestset";
import { codeVerdictFor, loadPolicy, type CodeVerdict } from "./jevPlacement/codeVerdict";
import { loadEvidence } from "./jevPlacement/evidence";
import { handmadeScore, signalNames, type HandmadeSignals } from "./jevPlacement/handmadeSignals";
import { isPopular, loadPopularityList } from "./jevPlacement/popularity";
import { closeBrowser } from "./jevPlacement/render";
import {
  DEFAULT_THRESHOLDS,
  matchesExpected,
  placementFromAnswers,
  type DerivedPlacement,
  type PlacementThresholds,
} from "./jevPlacement/placementFromAnswers";
import { PROMPT_VERSION, type PlacementAnswers } from "./jevPlacement/questions";
import {
  loadAnswers,
  readCachedAnswers,
  readJevToken,
  type JevResult,
} from "./jevPlacement/typesafeClient";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, "../../..");
const OUT_DIR = join(REPO_ROOT, "internal-docs/jev-check");
const CACHE_DIR = join(OUT_DIR, "cache");
const ENV_PATH = join(REPO_ROOT, "../../.env");

/** TypeSafe input pricing, used only to state what this run cost. */
const USD_PER_MILLION_INPUT_TOKENS = 0.042;

const CONCURRENCY = 4;

const PLACEMENTS: DerivedPlacement[] = [
  "hidden",
  "scenery",
  "regular",
  "featured-candidate",
];

type Row = {
  url: string;
  source: string;
  expected: string;
  got: DerivedPlacement;
  correct: boolean;
  margin: number;
  triggeredBy: string[];
  evidence: "fetched" | "rendered" | "url-only";
  answers: PlacementAnswers;
  renderMs?: number;
  staticTextLength?: number;
  textLength: number;
  /** What the shipped policy does with this URL; `open` leaves it to Jev. */
  codeVerdict: CodeVerdict;
  /** True when the code decided the placement and Jev's answer was set aside. */
  decidedByCode: boolean;
  jevPlacement: DerivedPlacement;
  signals: HandmadeSignals | null;
  signalScore: number;
  popular: boolean;
  title: string | null;
};

function parseArgs(argv: string[]) {
  const limitIndex = argv.indexOf("--limit");
  return {
    limit:
      limitIndex === -1 ? Number.POSITIVE_INFINITY : Number(argv[limitIndex + 1]),
    remap: argv.includes("--remap"),
  };
}

async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      for (;;) {
        const index = next++;
        if (index >= items.length) return;
        results[index] = await worker(items[index], index);
      }
    }),
  );
  return results;
}

function confusion(rows: Row[]): string {
  const expectedLabels = [...new Set(rows.map((row) => row.expected))].sort();
  const header = ["expected \\ got", ...PLACEMENTS, "total", "agree"];
  const lines = [
    `| ${header.join(" | ")} |`,
    `| ${header.map(() => "---").join(" | ")} |`,
  ];
  for (const expected of expectedLabels) {
    const group = rows.filter((row) => row.expected === expected);
    const cells = PLACEMENTS.map(
      (placement) => group.filter((row) => row.got === placement).length,
    );
    const agree = group.filter((row) => row.correct).length;
    const rate = group.length
      ? `${((agree / group.length) * 100).toFixed(0)}%`
      : "n/a";
    lines.push(
      `| ${expected} | ${cells.join(" | ")} | ${group.length} | ${agree}/${group.length} (${rate}) |`,
    );
  }
  return lines.join("\n");
}

function answerSummary(answers: PlacementAnswers): string {
  return [
    `requires_login=${answers.requires_login.noul.toFixed(2)}`,
    `person_bound=${answers.person_bound.noul.toFixed(2)}`,
    `unsafe=${answers.unsafe.noul.toFixed(2)}`,
    `surface_kind=${answers.surface_kind.choice}`,
    `stands_alone=${answers.stands_alone.noul.toFixed(2)}`,
    `human_community=${answers.human_community.noul.toFixed(2)}`,
    `maker=${answers.maker.choice}`,
    `care=${answers.care.score.toFixed(2)}`,
    `selling=${answers.selling.score.toFixed(2)}`,
    `mass_produced=${answers.mass_produced.noul.toFixed(2)}`,
  ].join(", ");
}

/** Distribution of each question's answer, split by the expected placement. */
function perQuestionBreakdown(rows: Row[]): string {
  const expectedLabels = [...new Set(rows.map((row) => row.expected))].sort();
  const sections: string[] = [];

  const nouls: Array<keyof PlacementAnswers> = [
    "requires_login",
    "person_bound",
    "unsafe",
    "stands_alone",
    "human_community",
    "mass_produced",
  ];
  sections.push("Mean probability by expected placement (noul questions):\n");
  sections.push(
    `| question | ${expectedLabels.join(" | ")} |\n| ${["---", ...expectedLabels.map(() => "---")].join(" | ")} |`,
  );
  for (const key of nouls) {
    const cells = expectedLabels.map((expected) => {
      const group = rows.filter((row) => row.expected === expected);
      if (!group.length) return "n/a";
      const mean =
        group.reduce(
          (total, row) =>
            total + (row.answers[key] as { noul: number }).noul,
          0,
        ) / group.length;
      return mean.toFixed(2);
    });
    sections.push(`| ${key} | ${cells.join(" | ")} |`);
  }

  for (const key of ["care", "selling"] as const) {
    sections.push(`\nMean ${key} score by expected placement:\n`);
    sections.push(
      `| question | ${expectedLabels.join(" | ")} |\n| ${["---", ...expectedLabels.map(() => "---")].join(" | ")} |`,
    );
    const cells = expectedLabels.map((expected) => {
      const group = rows.filter((row) => row.expected === expected);
      if (!group.length) return "n/a";
      const mean =
        group.reduce((total, row) => total + row.answers[key].score, 0) /
        group.length;
      return mean.toFixed(2);
    });
    sections.push(`| ${key} | ${cells.join(" | ")} |`);
  }

  for (const key of ["surface_kind", "maker"] as const) {
    sections.push(`\n${key} distribution by expected placement:\n`);
    const options = [
      ...new Set(rows.map((row) => row.answers[key].choice)),
    ].sort();
    sections.push(
      `| expected | ${options.join(" | ")} |\n| ${["---", ...options.map(() => "---")].join(" | ")} |`,
    );
    for (const expected of expectedLabels) {
      const group = rows.filter((row) => row.expected === expected);
      const cells = options.map(
        (option) =>
          group.filter((row) => row.answers[key].choice === option).length,
      );
      sections.push(`| ${expected} | ${cells.join(" | ")} |`);
    }
  }

  return sections.join("\n");
}

/**
 * Sweeps one threshold at a time over the rows already collected. The result is
 * fitted to this small sample and is reported separately from the headline.
 */
function suggestedTuning(rows: Row[]): string {
  const sweeps: Array<{
    name: keyof PlacementThresholds;
    values: number[];
  }> = [
    { name: "requiresLogin", values: [0.2, 0.35, 0.5, 0.65, 0.8] },
    { name: "personBound", values: [0.2, 0.35, 0.5, 0.65, 0.8] },
    { name: "unsafe", values: [0.2, 0.35, 0.5, 0.65, 0.8] },
    { name: "standsAlone", values: [0.3, 0.4, 0.5, 0.6, 0.7] },
    { name: "care", values: [1, 1.5, 2, 2.25, 2.5, 2.75, 3, 3.25, 3.5] },
    { name: "humanCommunity", values: [0.4, 0.5, 0.6, 0.7, 0.8] },
    { name: "massProduced", values: [0.1, 0.2, 0.3, 0.5, 0.7] },
    { name: "selling", values: [0.5, 1, 1.5, 2, 2.5] },
  ];

  const agreementFor = (thresholds: PlacementThresholds) =>
    rows.filter((row) =>
      matchesExpected(
        row.expected,
        placementFromAnswers(row.answers, thresholds).placement,
      ),
    ).length;

  const baseline = agreementFor(DEFAULT_THRESHOLDS);
  const lines = [
    `Baseline agreement with the spec's thresholds: ${baseline}/${rows.length} (${((baseline / rows.length) * 100).toFixed(1)}%).`,
    "",
    "| threshold | spec value | best value on this set | agreement at best |",
    "| --- | --- | --- | --- |",
  ];

  for (const sweep of sweeps) {
    let best = { value: DEFAULT_THRESHOLDS[sweep.name] as number, agree: baseline };
    for (const value of sweep.values) {
      const agree = agreementFor({ ...DEFAULT_THRESHOLDS, [sweep.name]: value });
      if (agree > best.agree) best = { value, agree };
    }
    lines.push(
      `| ${sweep.name} | ${String(DEFAULT_THRESHOLDS[sweep.name])} | ${best.value} | ${best.agree}/${rows.length} (${((best.agree / rows.length) * 100).toFixed(1)}%) |`,
    );
  }

  const combined: PlacementThresholds = { ...DEFAULT_THRESHOLDS };
  for (const sweep of sweeps) {
    let best = {
      value: combined[sweep.name] as number,
      agree: agreementFor(combined),
    };
    for (const value of sweep.values) {
      const agree = agreementFor({ ...combined, [sweep.name]: value });
      if (agree > best.agree) best = { value, agree };
    }
    (combined[sweep.name] as number) = best.value;
  }
  const combinedAgree = agreementFor(combined);
  lines.push(
    "",
    `Greedy combination: ${combinedAgree}/${rows.length} (${((combinedAgree / rows.length) * 100).toFixed(1)}%) with ` +
      sweeps
        .map((sweep) => `${sweep.name}=${String(combined[sweep.name])}`)
        .join(", ") +
      ".",
    "",
    "These values are fitted to a small sample and are not a recommendation to adopt.",
  );
  return lines.join("\n");
}

type LlamaRow = { page_key: string; model: string; suggestion_json: string };

/** Llama's cached one-shot suggestions, as a baseline beside Jev. */
function llamaBaseline(rows: Row[], items: TestsetItem[]): string {
  const path = join(OUT_DIR, "llama-suggestions.json");
  if (!existsSync(path)) return "No cached llama suggestions found.";
  const cached = JSON.parse(readFileSync(path, "utf8")) as LlamaRow[];

  const byKey = new Map<string, string>();
  for (const row of cached) {
    try {
      const parsed = JSON.parse(row.suggestion_json) as { placement?: string };
      if (parsed.placement) byKey.set(row.page_key, parsed.placement);
    } catch {
      // A malformed cached suggestion simply has no baseline to offer.
    }
  }

  const humanItems = items.filter((item) => item.source === "human");
  const lines = [
    "| url | human | llama | llama agrees | jev | jev agrees |",
    "| --- | --- | --- | --- | --- | --- |",
  ];
  let llamaAgree = 0;
  let llamaTotal = 0;
  let jevAgree = 0;

  for (const item of humanItems) {
    const candidates = [
      item.url,
      item.placeKey ?? "",
      `https://${item.placeKey}/`,
      `https://${item.placeKey}`,
    ];
    const llama = candidates.map((key) => byKey.get(key)).find(Boolean);
    if (!llama) continue;
    const row = rows.find((candidate) => candidate.url === item.url);
    if (!row) continue;
    llamaTotal += 1;
    const llamaOk = matchesExpected(
      item.expected,
      llama === "featured" ? "featured-candidate" : (llama as DerivedPlacement),
    );
    if (llamaOk) llamaAgree += 1;
    if (row.correct) jevAgree += 1;
    lines.push(
      `| ${item.url} | ${item.expected} | ${llama} | ${llamaOk ? "yes" : "no"} | ${row.got} | ${row.correct ? "yes" : "no"} |`,
    );
  }

  if (llamaTotal === 0) {
    return "No cached llama suggestion matched a human-labeled row in this run.";
  }

  return [
    `On the ${llamaTotal} human rows that llama also covered: llama ${llamaAgree}/${llamaTotal} (${((llamaAgree / llamaTotal) * 100).toFixed(0)}%), Jev ${jevAgree}/${llamaTotal} (${((jevAgree / llamaTotal) * 100).toFixed(0)}%).`,
    "",
    ...lines,
  ].join("\n");
}


type PriorRow = { url: string; source: string; correct: boolean };

/** Round 1's results, for a side-by-side that shows what the v2 changes moved. */
function versionComparison(rows: Row[]): string {
  const path = join(OUT_DIR, "results-v2.json");
  if (!existsSync(path)) return "No round-1 results found to compare against.";
  const prior = JSON.parse(readFileSync(path, "utf8")) as { rows: PriorRow[] };
  const priorByUrl = new Map(prior.rows.map((row) => [row.url, row]));

  const shared = rows.filter((row) => priorByUrl.has(row.url));
  if (!shared.length) return "No URLs are shared between the two runs.";

  const sources = [...new Set(shared.map((row) => row.source))].sort();
  const lines = [
    "| scope | v1 agreement | v2 agreement | change |",
    "| --- | --- | --- | --- |",
  ];

  const summarize = (label: string, group: Row[]) => {
    const v1 = group.filter((row) => priorByUrl.get(row.url)?.correct).length;
    const v2 = group.filter((row) => row.correct).length;
    const pct = (value: number) =>
      `${value}/${group.length} (${((value / group.length) * 100).toFixed(1)}%)`;
    const delta = v2 - v1;
    lines.push(
      `| ${label} | ${pct(v1)} | ${pct(v2)} | ${delta >= 0 ? "+" : ""}${delta} |`,
    );
  };

  summarize("overall", shared);
  summarize("rows jev decides", shared.filter((row) => !row.decidedByCode));
  for (const source of sources) {
    summarize(source, shared.filter((row) => row.source === source));
  }

  return [
    `Compared on the ${shared.length} URLs present in both runs, at the spec thresholds.`,
    "",
    ...lines,
  ].join("\n");
}

/**
 * The care cutoff is the threshold most likely to be wrong, so it gets its own
 * sweep including what it costs: scenery pages wrongly promoted.
 */
function careCutoffTable(rows: Row[], items: TestsetItem[]): string {
  const humanUrls = new Set(
    items.filter((item) => item.source === "human").map((item) => item.url),
  );
  const humanRows = rows.filter((row) => humanUrls.has(row.url));
  const sceneryRows = rows.filter((row) => row.expected === "scenery");

  const lines = [
    "| care cutoff | overall agreement | agreement on human rows | scenery wrongly featured |",
    "| --- | --- | --- | --- |",
  ];

  for (const cutoff of [1, 2, 3]) {
    const thresholds = { ...DEFAULT_THRESHOLDS, care: cutoff };
    const derive = (row: Row) =>
      placementFromAnswers(row.answers, thresholds).placement;

    const overall = rows.filter((row) =>
      matchesExpected(row.expected, derive(row)),
    ).length;
    const human = humanRows.filter((row) =>
      matchesExpected(row.expected, derive(row)),
    ).length;
    const promoted = sceneryRows.filter(
      (row) => derive(row) === "featured-candidate",
    ).length;

    lines.push(
      `| ${cutoff}${cutoff === 3 ? " (spec)" : ""} | ${overall}/${rows.length} (${((overall / rows.length) * 100).toFixed(1)}%) | ${human}/${humanRows.length} | ${promoted}/${sceneryRows.length} |`,
    );
  }
  return lines.join("\n");
}

/** Every human `featured` row with the new human_community reading. */
function humanFeaturedTable(rows: Row[], items: TestsetItem[]): string {
  const featured = items.filter(
    (item) => item.source === "human" && item.expected === "featured",
  );
  const lines = [
    "| url | human_community | got | agrees | surface_kind | care |",
    "| --- | --- | --- | --- | --- | --- |",
  ];
  let agree = 0;
  for (const item of featured) {
    const row = rows.find((candidate) => candidate.url === item.url);
    if (!row) continue;
    if (row.correct) agree += 1;
    lines.push(
      `| ${item.url} | ${row.answers.human_community.noul.toFixed(2)} | ${row.got} | ${row.correct ? "yes" : "no"} | ${row.answers.surface_kind.choice} | ${row.answers.care.score.toFixed(2)} |`,
    );
  }
  return [
    `${agree}/${featured.length} of the human featured rows now agree.`,
    "",
    ...lines,
  ].join("\n");
}

function renderStats(rows: Row[]): string {
  const rendered = rows.filter((row) => row.evidence === "rendered");
  const timed = rows.filter((row) => typeof row.renderMs === "number");
  const gained = rendered.filter(
    (row) => row.textLength >= 300 && (row.staticTextLength ?? 0) < 300,
  );
  const totalMs = timed.reduce((total, row) => total + (row.renderMs ?? 0), 0);

  return [
    `- Pages rendered in headless Chromium: ${rendered.length}`,
    `- Render attempts (including failures): ${timed.length}`,
    `- Rendered pages that gained real text (under 300 chars to 300 or more): ${gained.length}`,
    `- Average render time per attempted page: ${timed.length ? (totalMs / timed.length / 1000).toFixed(2) : "0.00"}s`,
    `- Total time in the browser: ${(totalMs / 1000).toFixed(1)}s`,
  ].join("\n");
}

/**
 * Pages Spencer called scenery that Jev hid as unsafe are counted apart: these
 * are piracy and streaming sites where the label, not the model, may be what
 * changes.
 */
function unsafeBucket(rows: Row[]): {
  bucket: Row[];
  others: Row[];
} {
  const bucket = rows.filter(
    (row) =>
      !row.correct &&
      row.expected === "scenery" &&
      row.got === "hidden" &&
      row.triggeredBy.includes("unsafe"),
  );
  const inBucket = new Set(bucket.map((row) => row.url));
  return {
    bucket,
    others: rows.filter((row) => !row.correct && !inBucket.has(row.url)),
  };
}


type Queues = {
  suggestFeature: Row[];
  suggestStop: Row[];
  closeCalls: Row[];
};

/**
 * Jev never promotes on its own. These are suggestions for Spencer to confirm,
 * so rows he has already labeled are left out of the queues.
 */
function buildQueues(rows: Row[], items: TestsetItem[]): Queues {
  const labeled = new Set(
    items.filter((item) => item.source === "human").map((item) => item.url),
  );
  const open = rows.filter((row) => !row.decidedByCode && !labeled.has(row.url));

  return {
    suggestFeature: open
      .filter((row) => row.got === "featured-candidate")
      .sort((a, b) => b.margin - a.margin),
    suggestStop: open
      .filter((row) => row.got === "regular")
      .sort((a, b) => b.margin - a.margin),
    closeCalls: [...open].sort((a, b) => a.margin - b.margin).slice(0, 40),
  };
}

/** The two or three facts that drove a row, for a human reading the queue. */
function drivers(row: Row): string[] {
  const reasons: string[] = [];
  for (const key of row.triggeredBy.slice(0, 3)) {
    if (key === "human_community") {
      reasons.push(`human_community=${row.answers.human_community.noul.toFixed(2)}`);
    } else if (key === "care") {
      reasons.push(`care=${row.answers.care.score.toFixed(2)}`);
    } else if (key === "handmade_signals") {
      reasons.push(`handmade=${row.signalScore} (${signalNames(row.signals ?? ({} as HandmadeSignals)).join(", ")})`);
    } else if (key === "maker") {
      reasons.push(`maker=${row.answers.maker.choice}`);
    } else if (key === "selling") {
      reasons.push(`selling=${row.answers.selling.score.toFixed(2)}`);
    } else if (key === "mass_produced") {
      reasons.push(`mass_produced=${row.answers.mass_produced.noul.toFixed(2)}`);
    } else if (key === "stands_alone") {
      reasons.push(`stands_alone=${row.answers.stands_alone.noul.toFixed(2)}`);
    } else if (key === "surface_kind") {
      reasons.push(`surface_kind=${row.answers.surface_kind.choice}`);
    } else {
      reasons.push(key);
    }
  }
  if (row.popular) reasons.push("popularity_cap");
  return reasons;
}

function queueTable(rows: Row[], limit: number): string {
  if (!rows.length) return "None.";
  return [
    "| margin | url | title | why |",
    "| --- | --- | --- | --- |",
    ...rows
      .slice(0, limit)
      .map(
        (row) =>
          `| ${row.margin.toFixed(3)} | ${row.url} | ${(row.title ?? "").slice(0, 60).replace(/\|/g, "/")} | ${drivers(row).join("; ")} |`,
      ),
  ].join("\n");
}

/** What the markup detectors found, split by the label a page carries. */
function signalReport(rows: Row[]): string {
  const withHtml = rows.filter((row) => row.signals !== null);
  const names = [
    "badge88x31",
    "webring",
    "guestbook",
    "feed",
    "relMe",
    "cookieBanner",
    "checkout",
  ] as const;

  const groups: Array<[string, Row[]]> = [
    ["reserve-catalog", withHtml.filter((row) => row.source === "reserve-catalog")],
    ["expected scenery", withHtml.filter((row) => row.expected === "scenery")],
    ["all pages", withHtml],
  ];

  const lines = [
    `Signals were computed for ${withHtml.length} pages with readable markup.`,
    "",
    `| signal | ${groups.map(([name]) => name).join(" | ")} |`,
    `| --- | ${groups.map(() => "---").join(" | ")} |`,
  ];
  for (const name of names) {
    const cells = groups.map(
      ([, group]) => group.filter((row) => Boolean(row.signals?.[name])).length,
    );
    lines.push(`| ${name} | ${cells.join(" | ")} |`);
  }
  const adCells = groups.map(
    ([, group]) => group.filter((row) => (row.signals?.adTrackerCount ?? 0) > 0).length,
  );
  lines.push(`| adTrackers>0 | ${adCells.join(" | ")} |`);

  const rescued = rows.filter(
    (row) =>
      row.source === "reserve-catalog" &&
      row.triggeredBy.includes("handmade_signals"),
  );
  lines.push(
    "",
    `Thin reserve-catalog pages rescued to a featured suggestion by signals alone: ${rescued.length}.`,
  );
  if (rescued.length) {
    lines.push(
      "",
      ...rescued
        .slice(0, 12)
        .map(
          (row) =>
            `- ${row.url} (score ${row.signalScore}: ${signalNames(row.signals ?? ({} as HandmadeSignals)).join(", ")})`,
        ),
    );
  }
  return lines.join("\n");
}

function toQueueEntry(row: Row) {
  return {
    url: row.url,
    title: row.title,
    suggestion: row.got,
    margin: row.margin,
    why: drivers(row),
    signals: row.signals ? signalNames(row.signals) : [],
    source: row.source,
  };
}

async function main(): Promise<void> {
  const { limit, remap } = parseArgs(process.argv.slice(2));

  const all = await buildTestset(REPO_ROOT);
  const items = Number.isFinite(limit) ? all.slice(0, limit) : all;
  mkdirSync(CACHE_DIR, { recursive: true });

  const token = remap ? "" : readJevToken(ENV_PATH);
  await loadPolicy(REPO_ROOT);
  const popularity = loadPopularityList(join(OUT_DIR, "tranco-top10k.csv"));

  let requested = 0;
  let cachedCount = 0;
  const usage = { input_tokens: 0, output_tokens: 0 };
  const skipped: string[] = [];

  const collected = await mapWithConcurrency(
    items,
    CONCURRENCY,
    async (item): Promise<Row | null> => {
      const evidence = await loadEvidence(
        item.url,
        item.title ?? null,
        CACHE_DIR,
        item.synthetic,
      );

      let result: (JevResult & { cached?: boolean }) | null;
      if (remap) {
        result = readCachedAnswers(item.url, CACHE_DIR);
        if (!result) {
          skipped.push(item.url);
          return null;
        }
      } else {
        result = await loadAnswers(item.url, evidence.state, token, CACHE_DIR);
        if (result.cached) cachedCount += 1;
        else {
          requested += 1;
          usage.input_tokens += result.usage.input_tokens;
          usage.output_tokens += result.usage.output_tokens;
        }
      }

      const signals = evidence.signals ?? null;
      const popular = isPopular(item.url, popularity);
      const decision = placementFromAnswers(result.answers, DEFAULT_THRESHOLDS, {
        signals,
        popular,
      });

      // The shipped policy has the final say: Jev may push a page down, never
      // past a code rule that already covers it.
      const codeVerdict = codeVerdictFor(item.url);
      const decidedByCode = codeVerdict !== "open";
      const placement: DerivedPlacement = decidedByCode
        ? (codeVerdict as DerivedPlacement)
        : decision.placement;

      return {
        url: item.url,
        source: item.source,
        expected: item.expected,
        got: placement,
        correct: matchesExpected(item.expected, placement),
        margin: decision.margin,
        triggeredBy: decidedByCode ? ["code_policy"] : decision.triggeredBy,
        evidence: evidence.kind,
        answers: result.answers,
        renderMs: evidence.renderMs,
        staticTextLength: evidence.staticTextLength,
        textLength: evidence.state.page.text_excerpt?.length ?? 0,
        codeVerdict,
        decidedByCode,
        jevPlacement: decision.placement,
        signals,
        signalScore: signals ? handmadeScore(signals) : 0,
        popular,
        title: evidence.state.page.title,
      };
    },
  );

  const rows = collected.filter((row): row is Row => row !== null);
  if (rows.length === 0) {
    throw new Error("no rows were produced; nothing to report");
  }

  const codeRows = rows.filter((row) => row.decidedByCode);
  const jevRows = rows.filter((row) => !row.decidedByCode);
  const agree = jevRows.filter((row) => row.correct).length;
  const codeAgree = codeRows.filter((row) => row.correct).length;
  const queues = buildQueues(rows, items);
  const urlOnly = rows.filter((row) => row.evidence === "url-only").length;
  const costUsd = (usage.input_tokens / 1_000_000) * USD_PER_MILLION_INPUT_TOKENS;

  const sources = [...new Set(rows.map((row) => row.source))].sort();
  const perSource = sources
    .map((source) => {
      const group = jevRows.filter((row) => row.source === source);
      if (!group.length) return `| ${source} | 0/0 | n/a | 0 |`;
      const ok = group.filter((row) => row.correct).length;
      return `| ${source} | ${ok}/${group.length} | ${((ok / group.length) * 100).toFixed(1)}% | ${group.filter((row) => row.evidence === "url-only").length} |`;
    })
    .join("\n");

  const { bucket: unsafeHidden, others } = unsafeBucket(rows);
  const disagreements = others.sort((a, b) => b.margin - a.margin);

  const report = [
    "# Jev commute placement check",
    "",
    `Model \`jev-1.13.0\`, prompt version \`${PROMPT_VERSION}\`, thresholds as written in the spec.`,
    "Jev is advisory here: this run writes nothing to any database.",
    "",
    "## Totals",
    "",
    `- Items scored: ${rows.length}`,
    `- Decided by code policy (Jev's answer recorded, not used): ${codeRows.length}, of which ${codeAgree} match the label`,
    `- Rows Jev decides: ${jevRows.length}`,
    `- Agreement on rows Jev decides: ${agree}/${jevRows.length} (${jevRows.length ? ((agree / jevRows.length) * 100).toFixed(1) : "0.0"}%)`,
    `- Popularity cap: ${popularity.available ? `${popularity.domains.size} domains loaded from ${popularity.path}` : "no list file found, cap not applied (nothing was downloaded)"}`,
    `- Evidence url-only (fetch failed or synthetic fixture): ${urlOnly}`,
    `- Pages rendered in headless Chromium: ${rows.filter((row) => row.evidence === "rendered").length}`,
    `- Expected scenery, hidden as unsafe (counted apart): ${unsafeHidden.length}`,
    `- New API requests this run: ${requested} (cache hits: ${cachedCount})`,
    `- Tokens: ${usage.input_tokens} input, ${usage.output_tokens} output`,
    `- Estimated input cost: $${costUsd.toFixed(4)} at $${USD_PER_MILLION_INPUT_TOKENS} per million input tokens`,
    ...(skipped.length
      ? [`- Rows skipped for want of cached answers: ${skipped.length}`]
      : []),
    "",
    "## Agreement by source",
    "",
    "| source | agree | rate | url-only |",
    "| --- | --- | --- | --- |",
    perSource,
    "",
    "## Confusion, overall",
    "",
    confusion(rows),
    "",
    ...sources.flatMap((source) => [
      `## Confusion, ${source}`,
      "",
      confusion(rows.filter((row) => row.source === source)),
      "",
    ]),
    "## Suggestion queues",
    "",
    "Jev never promotes on its own. These are suggestions for Spencer to confirm by hand; rows he has already labeled are excluded.",
    "",
    `### Suggest feature (${queues.suggestFeature.length})`,
    "",
    queueTable(queues.suggestFeature, 40),
    "",
    `### Suggest allow as stop (${queues.suggestStop.length})`,
    "",
    queueTable(queues.suggestStop, 40),
    "",
    `### Close calls (${queues.closeCalls.length}, smallest margin first)`,
    "",
    queueTable(queues.closeCalls, 40),
    "",
    "## Handmade web signals",
    "",
    signalReport(rows),
    "",
    "## v2 versus v3",
    "",
    versionComparison(rows),
    "",
    "## Care cutoff sweep",
    "",
    "The headline above uses the spec's cutoff of 3. This table shows what moving it costs and gains.",
    "",
    careCutoffTable(rows, items),
    "",
    "## Human featured rows and human_community",
    "",
    humanFeaturedTable(rows, items),
    "",
    "## Rendering",
    "",
    renderStats(rows),
    "",
    "## Expected scenery, hidden as unsafe",
    "",
    `${unsafeHidden.length} pages Spencer labeled scenery were hidden on the unsafe gate. These are counted apart from the other misses; the label may be what changes.`,
    "",
    "| url | unsafe | care | surface_kind |",
    "| --- | --- | --- | --- |",
    ...unsafeHidden.map(
      (row) =>
        `| ${row.url} | ${row.answers.unsafe.noul.toFixed(2)} | ${row.answers.care.score.toFixed(2)} | ${row.answers.surface_kind.choice} |`,
    ),
    "",
    "## Llama baseline",
    "",
    llamaBaseline(rows, items),
    "",
    "## Disagreements, most confident first",
    "",
    `${disagreements.length} disagreements, excluding the ${unsafeHidden.length} scenery-to-hidden-unsafe rows counted above.`,
    "",
    "| margin | url | source | expected | got | triggered by | evidence | answers |",
    "| --- | --- | --- | --- | --- | --- | --- | --- |",
    ...disagreements.map(
      (row) =>
        `| ${row.margin.toFixed(3)} | ${row.url} | ${row.source} | ${row.expected} | ${row.got} | ${row.triggeredBy.join(", ")} | ${row.evidence} | ${answerSummary(row.answers)} |`,
    ),
    "",
    "## Per-question sanity",
    "",
    perQuestionBreakdown(rows),
    "",
    "## Suggested tuning",
    "",
    suggestedTuning(rows),
    "",
  ].join("\n");

  writeFileSync(join(OUT_DIR, "report.md"), report);
  writeFileSync(
    join(OUT_DIR, "promising.json"),
    JSON.stringify(
      {
        note: "Suggestions for Spencer to confirm. Jev never promotes on its own.",
        promptVersion: PROMPT_VERSION,
        popularityCapApplied: popularity.available,
        queues: {
          suggestFeature: queues.suggestFeature.map(toQueueEntry),
          suggestStop: queues.suggestStop.map(toQueueEntry),
          closeCalls: queues.closeCalls.map(toQueueEntry),
        },
      },
      null,
      2,
    ),
  );
  writeFileSync(
    join(OUT_DIR, "results.json"),
    JSON.stringify(
      {
        model: "jev-1.13.0",
        promptVersion: PROMPT_VERSION,
        thresholds: DEFAULT_THRESHOLDS,
        totals: {
          scored: rows.length,
          agree,
          urlOnly,
          rendered: rows.filter((row) => row.evidence === "rendered").length,
          decidedByCode: codeRows.length,
          jevDecided: jevRows.length,
          popularityListAvailable: popularity.available,
          sceneryHiddenUnsafe: unsafeHidden.length,
          requested,
          cached: cachedCount,
          usage,
          estimatedInputCostUsd: costUsd,
        },
        rows,
      },
      null,
      2,
    ),
  );

  process.stdout.write(
    `scored ${rows.length}, code-decided ${codeRows.length}, jev agreement ${agree}/${jevRows.length} (${jevRows.length ? ((agree / jevRows.length) * 100).toFixed(1) : "0.0"}%), feature-queue ${queues.suggestFeature.length}, url-only ${urlOnly}, new requests ${requested}\n`,
  );
}

try {
  await main();
} finally {
  await closeBrowser();
}
