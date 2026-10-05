// ABOUTME: Quest lab: groups exported scraps into browsing quests and asks Clef how to collage each one.
// ABOUTME: Three prototypes over the same scraps: base-shape picker, free layout, and shape-guided layout.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import type { ScrapItem } from "@movement/components/ScrapCollage";
import {
  COLLAGE_FORMATS,
  DEFAULT_PAPER,
  FORMAT_NAMES,
  type CollageFormatName,
} from "@extension/entrypoints/scraps/collageFormats";
import { DEFAULT_CUTOUT_TOLERANCE } from "@extension/entrypoints/scraps/backgroundCutout";
import {
  CONTEST_LABELS,
  IMAGE_KINDS,
  heroContestQuestion,
  randomAnswers,
  scrapQuestions,
  scrapState,
  type ImageScrap,
  type QuestContext,
  type ScrapAnswers,
} from "./questions";
import { isNoise, splitQuests, type NoiseRules, type Quest } from "./sessions";
import { clefImage, cutoutOf, imageUrl, silhouetteUrl, type Cutout } from "./imageWork";
import {
  castRoles,
  downloadCollage,
  frameOf,
  freeLayout,
  hashId,
  seededRandom,
  shapeLayout,
  type Frame,
  type Judged,
  type Placement,
  type RoleSizing,
} from "./layouts";

type ClefModel = "clef-flash" | "clef";
const TABS = ["scraps", "base", "compare"] as const;
type Tab = (typeof TABS)[number];

/** Every layout style the compare view can show, each a row of its own. */
const LAYOUTS = [
  { id: "free-layered", label: "free canvas · layered collage", kind: "free", arrangement: "layered" },
  { id: "free-pack", label: "free canvas · packed snugly", kind: "free", arrangement: "pack" },
  { id: "free-gather", label: "free canvas · gathered around heroes", kind: "free", arrangement: "gather" },
  { id: "shape-pack", label: "shape · packed snugly by outline", kind: "shape", mode: "pack" },
  { id: "shape-fill", label: "shape · overlapping rectangles", kind: "shape", mode: "fill" },
  { id: "shape-edge", label: "shape · tracing the outline", kind: "shape", mode: "edge" },
] as const;
type LayoutId = (typeof LAYOUTS)[number]["id"];
type AnswerSource = "clef" | "random";

interface LayoutResult {
  placements: Placement[];
  /** Share of the area covered, when the layout measures it. */
  coverage: number | null;
  spill: number | null;
  skipped: number;
  silhouette?: { mask: Uint8ClampedArray; width: number; height: number };
  silhouetteBox?: { x: number; y: number; width: number; height: number };
}

/** Pieces sent to the side-by-side hero contest, ordered by Clef's hero odds. */
function contestSize(heroCount: number): number {
  return Math.min(16, Math.max(8, heroCount * 4));
}

/** What one scrap's request carried, kept so the page can show it. */
interface Sent {
  state: unknown;
  image: string;
}


interface LabConfig {
  exportPath: string | null;
  clefReady: boolean;
}

/**
 * What Clef is told about the quest: its sites and page titles, most visited
 * first. The raw browsing stands in for a goal, so nothing is summarized or
 * guessed on the way to Clef.
 */
function questContext(quest: Quest): QuestContext {
  const counts = new Map<string, number>();
  for (const scrap of quest.scraps) counts.set(scrap.pageTitle, (counts.get(scrap.pageTitle) ?? 0) + 1);
  return {
    sites: quest.domains.slice(0, 10).map((d) => `${d.domain} (${d.count})`),
    pageTitles: [...counts].sort((a, b) => b[1] - a[1]).slice(0, 25).map(([title]) => title),
  };
}

interface Loaded {
  file: string;
  exportedAt: number;
  days: number;
  scraps: ImageScrap[];
}

async function api<T>(route: string, body?: unknown): Promise<T> {
  const response = await fetch(`/api/quest-lab/${route}`, {
    method: body === undefined ? "GET" : "POST",
    headers: body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = await response.json();
  if (!response.ok) throw new Error(json.error ?? `${route} failed with ${response.status}`);
  return json as T;
}

function useRemembered<T>(key: string, initial: T): [T, (value: T) => void] {
  const [value, setValue] = useState<T>(() => {
    try {
      const stored = localStorage.getItem(`quest-lab:${key}`);
      return stored === null ? initial : (JSON.parse(stored) as T);
    } catch {
      return initial;
    }
  });
  const set = useCallback(
    (next: T) => {
      setValue(next);
      try {
        localStorage.setItem(`quest-lab:${key}`, JSON.stringify(next));
      } catch {
        // Remembering is a convenience; the lab works without it.
      }
    },
    [key],
  );
  return [value, set];
}

/** Runs tasks a few at a time so Clef and the image proxy are not flooded. */
async function inBatches<T>(items: T[], width: number, work: (item: T) => Promise<void>) {
  const queue = [...items];
  await Promise.all(
    Array.from({ length: width }, async () => {
      for (let item = queue.shift(); item !== undefined; item = queue.shift()) await work(item);
    }),
  );
}

function formatTime(ts: number): string {
  return new Date(ts).toLocaleString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function baseRank(answers: ScrapAnswers): number {
  const shape = answers.silhouette.score / 4;
  const fit = 0.4 + 0.6 * (answers.questFit.score / 3);
  return shape * (0.3 + 0.7 * answers.isolated.noul) * fit;
}

/**
 * The value once it has stopped changing for a moment. Layouts read settled
 * answers and cutouts, so a packing runs once per burst of arrivals rather
 * than once per arrival.
 */
function useSettled<T>(value: T, ms: number): T {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setSettled(value), ms);
    return () => clearTimeout(timer);
  }, [value, ms]);
  return settled;
}

function useCutouts(
  scraps: ImageScrap[],
  toleranceFor: (scrap: ImageScrap) => number,
): Map<string, Cutout> {
  const [cutouts, setCutouts] = useState(new Map<string, Cutout>());
  const key = scraps.map((scrap) => `${scrap.id}@${toleranceFor(scrap)}`).join(",");
  useEffect(() => {
    let live = true;
    for (const scrap of scraps) {
      cutoutOf(scrap, toleranceFor(scrap))
        .then((cutout) => {
          if (live) setCutouts((current) => new Map(current).set(scrap.id, cutout));
        })
        .catch((error) => console.error(error));
    }
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return cutouts;
}

function Bar({ label, value, max = 1, hint }: { label: string; value: number; max?: number; hint?: string }) {
  return (
    <div className="bar" title={hint}>
      <span>{label}</span>
      <div className="bar-track">
        <div className="bar-fill" style={{ width: `${(value / max) * 100}%` }} />
      </div>
      <span className="bar-value">{value.toFixed(2)}</span>
    </div>
  );
}

function pieceTitle(placement: Placement): string {
  return [placement.scrap.alt || placement.scrap.pageTitle, ...placement.trace].join("\n");
}

function CollageCanvas({
  frame,
  placements,
  cutouts,
  ghost,
}: {
  frame: Frame;
  placements: Placement[];
  cutouts: Map<string, Cutout>;
  ghost?: { url: string; box: { x: number; y: number; width: number; height: number } };
}) {
  const pct = (value: number, of: number) => `${(value / of) * 100}%`;
  return (
    <div
      className="collage"
      style={{ aspectRatio: `${frame.width} / ${frame.height}`, background: DEFAULT_PAPER.color }}
    >
      {ghost && (
        <img
          className="ghost"
          src={ghost.url}
          style={{
            left: pct(ghost.box.x, frame.width),
            top: pct(ghost.box.y, frame.height),
            width: pct(ghost.box.width, frame.width),
            height: pct(ghost.box.height, frame.height),
          }}
        />
      )}
      {placements.map((placement) => {
        const cut = placement.cutout ? cutouts.get(placement.scrap.id) : undefined;
        const box = {
          left: pct(placement.x, frame.width),
          top: pct(placement.y, frame.height),
          width: pct(placement.width, frame.width),
          height: pct(placement.height, frame.height),
          transform: `rotate(${placement.rotation}deg)`,
          zIndex: placement.z + 1,
        };
        const src = cut ? cut.url : imageUrl(placement.scrap);
        if (placement.crop) {
          // A cropped piece shows part of its image: the image is scaled up inside a clipping box.
          const crop = placement.crop;
          return (
            <div key={placement.key} className="piece cropped" title={pieceTitle(placement)} style={box}>
              <img
                src={src}
                style={{
                  width: `${100 / crop.width}%`,
                  height: `${100 / crop.height}%`,
                  left: `${(-crop.x / crop.width) * 100}%`,
                  top: `${(-crop.y / crop.height) * 100}%`,
                }}
              />
            </div>
          );
        }
        return (
          <img
            key={placement.key}
            className={placement.cutout ? "piece cut" : "piece"}
            src={src}
            title={pieceTitle(placement)}
            style={box}
          />
        );
      })}
    </div>
  );
}

function Json({ value }: { value: unknown }) {
  return <pre className="json">{JSON.stringify(value, null, 2)}</pre>;
}

function PlacementTrace({ placements }: { placements: Placement[] }) {
  return (
    <details className="trace">
      <summary>how each piece was placed ({placements.length})</summary>
      <ol>
        {[...placements]
          .sort((a, b) => b.width * b.height - a.width * a.height)
          .map((placement) => (
            <li key={placement.key}>
              <img src={imageUrl(placement.scrap)} />
              <div>
                <b>{placement.scrap.alt || placement.scrap.pageTitle}</b>
                <ul>
                  {placement.trace.map((line) => (
                    <li key={line} className={line.includes("(code, not Clef)") ? "code-step" : ""}>{line}</li>
                  ))}
                </ul>
              </div>
            </li>
          ))}
      </ol>
    </details>
  );
}

function LayoutView({
  frame,
  result,
  cutouts,
  showGhost,
}: {
  frame: Frame;
  result: LayoutResult;
  cutouts: Map<string, Cutout>;
  showGhost: boolean;
}) {
  const ghost = useMemo(
    () => (showGhost && result.silhouette && result.silhouetteBox
      ? { url: silhouetteUrl(result.silhouette, "#3d3833"), box: result.silhouetteBox }
      : undefined),
    [showGhost, result.silhouette, result.silhouetteBox],
  );
  return <CollageCanvas frame={frame} placements={result.placements} cutouts={cutouts} ghost={ghost} />;
}

function layoutStats(result: LayoutResult): string {
  return [
    `${result.placements.length} pieces`,
    result.coverage !== null ? `covers ${Math.round(result.coverage * 100)}%` : "",
    result.spill ? `spills ${Math.round(result.spill * 100)}%` : "",
    result.skipped ? `${result.skipped} found no room` : "",
  ]
    .filter(Boolean)
    .join(" · ");
}

function Slider(props: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (value: number) => void;
}) {
  return (
    <label className="control">
      <span>
        {props.label} <b>{props.value}</b>
      </span>
      <input
        type="range"
        min={props.min}
        max={props.max}
        step={props.step}
        value={props.value}
        onChange={(event) => props.onChange(Number(event.target.value))}
      />
    </label>
  );
}

function App() {
  const [config, setConfig] = useState<LabConfig | null>(null);
  const [pathDraft, setPathDraft] = useState("");
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [gapMinutes, setGapMinutes] = useRemembered("gap", 20);
  const [minScraps, setMinScraps] = useRemembered("min", 6);
  const [noise, setNoise] = useRemembered<NoiseRules>("noise", { dropSvg: true, minSide: 80 });
  const [questId, setQuestId] = useRemembered<string | null>("quest", null);
  const [model, setModel] = useRemembered<ClefModel>("model", "clef-flash");
  const [maxPieces, setMaxPieces] = useRemembered("maxPieces", 40);
  const [useAll, setUseAll] = useRemembered("useAll", true);
  const [storedTab, setTab] = useRemembered<string>("tab", "compare");
  const tab: Tab = (TABS as readonly string[]).includes(storedTab) ? (storedTab as Tab) : "compare";
  const [format, setFormat] = useRemembered<CollageFormatName>("format", "postcard");
  const [seed, setSeed] = useState(1);
  const [density, setDensity] = useRemembered("density", 1.1);
  const [cutoutThreshold, setCutoutThreshold] = useRemembered("cutoutThreshold", 0.5);
  const [spreadRounds, setSpreadRounds] = useRemembered("spread", 12);
  const [fill, setFill] = useRemembered("shapeFill", 1.8);
  const [packFill, setPackFill] = useRemembered("packFill", 0.9);
  const [shownLayouts, setShownLayouts] = useRemembered<LayoutId[]>("shownLayouts", ["free-layered", "free-pack", "shape-pack"]);
  const [showRandom, setShowRandom] = useRemembered("showRandom", false);
  const [focused, setFocused] = useState<{ id: LayoutId; source: AnswerSource } | null>(null);
  const [cutAll, setCutAll] = useRemembered("cutAll", true);
  const [maxRotation, setMaxRotation] = useRemembered("maxRotation", 25);
  const [gap, setGap] = useRemembered("gap", 1);
  const [showGhost, setShowGhost] = useRemembered("ghost", true);
  const [largestPartOnly, setLargestPartOnly] = useRemembered("largestPart", true);
  const [fillHoles, setFillHoles] = useRemembered("fillHoles", true);
  const [inset, setInset] = useRemembered("inset", 0.8);
  const [heroCount, setHeroCount] = useRemembered("heroCount", 3);
  const [heroSide, setHeroSide] = useRemembered("heroSide", 0.35);
  const [contrast, setContrast] = useRemembered("contrast", 2.5);
  const [accentSide, setAccentSide] = useRemembered("accentSide", 0.09);
  const [wallpaperTiles, setWallpaperTiles] = useRemembered("wallpaperTiles", 7);
  const [accentRepeats, setAccentRepeats] = useRemembered("accentRepeats", 4);
  const [layeredSupporting, setLayeredSupporting] = useRemembered("layeredSupporting", 24);
  const [layeredDensity, setLayeredDensity] = useRemembered("layeredDensity", 0.4);
  const sizing: RoleSizing = useMemo(
    () => ({ heroCount, heroSide, accentSide, contrast }),
    [heroCount, heroSide, accentSide, contrast],
  );
  const [baseByQuest, setBaseByQuest] = useRemembered<Record<string, string>>("bases", {});
  const [defaultTolerance, setDefaultTolerance] = useRemembered("tolerance", DEFAULT_CUTOUT_TOLERANCE);
  const [tolerances, setTolerances] = useRemembered<Record<string, number>>("tolerances", {});
  const [sent, setSent] = useState(new Map<string, Sent>());
  const toleranceFor = useCallback(
    (scrap: ImageScrap) => tolerances[scrap.id] ?? defaultTolerance,
    [tolerances, defaultTolerance],
  );

  const [answers, setAnswers] = useState(new Map<string, ScrapAnswers>());
  const [progress, setProgress] = useState<{ done: number; total: number; failed: number } | null>(null);
  const askRun = useRef(0);
  const [contests, setContests] = useState(new Map<string, Map<string, number>>());
  const [contestStatus, setContestStatus] = useState<string | null>(null);
  const contestRun = useRef(0);

  const loadScraps = useCallback(async () => {
    const data = await api<{ file: string; exportedAt: number; days: number; scraps: ScrapItem[] }>("scraps");
    setLoaded({
      file: data.file,
      exportedAt: data.exportedAt,
      days: data.days,
      scraps: data.scraps.filter((scrap): scrap is ImageScrap => scrap.kind === "image"),
    });
  }, []);

  useEffect(() => {
    api<LabConfig>("config")
      .then((next) => {
        setConfig(next);
        setPathDraft(next.exportPath ?? "~/Downloads");
        if (next.exportPath) return loadScraps();
      })
      .catch((e: Error) => setError(e.message));
  }, [loadScraps]);

  const savePath = async () => {
    setError(null);
    try {
      await api("config", { exportPath: pathDraft });
      setConfig((current) => current && { ...current, exportPath: pathDraft });
      await loadScraps();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const clean = useMemo(
    () => (loaded ? loaded.scraps.filter((scrap) => !isNoise(scrap, noise)) : []),
    [loaded, noise],
  );
  const quests = useMemo(() => splitQuests(clean, gapMinutes, minScraps), [clean, gapMinutes, minScraps]);
  const quest: Quest | undefined = quests.find((q) => q.id === questId) ?? quests[0];
  const context = useMemo(() => (quest ? questContext(quest) : null), [quest]);
  const pieceLimit = useAll && quest ? quest.scraps.length : maxPieces;
  const working = useMemo(() => (quest ? quest.scraps.slice(0, pieceLimit) : []), [quest, pieceLimit]);

  const ask = useCallback(async () => {
    if (!quest || !context) return;
    const run = ++askRun.current;
    const questions = scrapQuestions();
    setProgress({ done: 0, total: working.length, failed: 0 });
    setError(null);
    await inBatches(working, 8, async (scrap) => {
      try {
        const image = await clefImage(scrap);
        const state = scrapState(scrap, context);
        if (run === askRun.current) setSent((current) => new Map(current).set(scrap.id, { state, image }));
        const result = await api<{ answers: ScrapAnswers }>("ask", {
          model,
          state,
          questions,
          images: [image],
        });
        if (run !== askRun.current) return;
        setAnswers((current) => new Map(current).set(scrap.id, result.answers));
        setProgress((p) => p && { ...p, done: p.done + 1 });
      } catch (e) {
        if (run !== askRun.current) return;
        console.error(scrap.src, e);
        // A dead image link is counted as failed; only other failures need the banner.
        if (!(e as Error).message.startsWith("Could not load")) setError((e as Error).message);
        setProgress((p) => p && { ...p, done: p.done + 1, failed: p.failed + 1 });
      }
    });
  }, [quest, context, working, model]);

  // Answers are cached on disk, so re-asking a quest already seen is instant and free.
  useEffect(() => {
    if (config?.clefReady && quest) void ask();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config?.clefReady, quest?.id, model, pieceLimit]);
  const judged: Judged[] = useMemo(
    () => working.flatMap((scrap) => {
      const a = answers.get(scrap.id);
      return a ? [{ scrap, answers: a }] : [];
    }),
    [working, answers],
  );
  // The same scraps with coin-flip answers, so a layout from them shows what
  // the layout code does with no judgment at all.
  const judgedRandom: Judged[] = useMemo(
    () => judged.map(({ scrap }) => ({
      scrap,
      answers: randomAnswers(seededRandom(hashId(scrap.id) ^ seed)),
    })),
    [judged, seed],
  );
  const contestKey = quest ? `${quest.id}|${model}` : "";
  const contest = contests.get(contestKey);

  // Once every scrap is answered, the strongest hero candidates meet side by
  // side, up to 4 per request, so heroes come from comparison rather than
  // from odds Clef gave each image alone.
  const answeredAll = !!progress && progress.done === progress.total;
  useEffect(() => {
    if (!answeredAll || !quest || contests.has(contestKey)) return;
    const run = ++contestRun.current;
    const casting = castRoles(judged, sizing);
    const candidates = casting.cast
      .map((member) => member.item)
      .sort((a, b) => (b.answers.role.probabilities.hero ?? 0) - (a.answers.role.probabilities.hero ?? 0))
      .slice(0, contestSize(heroCount))
      .map((item) => item.scrap);
    if (candidates.length < 2) return;
    const groups: ImageScrap[][] = [];
    for (let pass = 0; pass < 2; pass += 1) {
      const random = seededRandom(pass + 1);
      const shuffled = [...candidates].sort(() => random() - 0.5);
      for (let at = 0; at < shuffled.length; at += 4) {
        const group = shuffled.slice(at, at + 4);
        // A lone leftover gets company, since a contest of one says nothing.
        if (group.length === 1) group.push(...shuffled.filter((s) => s !== group[0]).slice(0, 3));
        groups.push(group);
      }
    }
    setContestStatus(`hero contest: 0/${groups.length} rounds`);
    const wins = new Map<string, number>();
    const seen = new Map<string, number>();
    let done = 0;
    void inBatches(groups, 4, async (group) => {
      const images = await Promise.all(group.map((scrap) => clefImage(scrap)));
      const result = await api<{ answers: { hero: { probabilities: Record<string, number> } } }>("ask", {
        model,
        state: { quest: context },
        questions: heroContestQuestion(group.length),
        images,
      });
      group.forEach((scrap, i) => {
        // 1 means the image won exactly its fair share of its group.
        const share = (result.answers.hero.probabilities[CONTEST_LABELS[i]] ?? 0) * group.length;
        wins.set(scrap.id, (wins.get(scrap.id) ?? 0) + share);
        seen.set(scrap.id, (seen.get(scrap.id) ?? 0) + 1);
      });
      done += 1;
      if (run === contestRun.current) setContestStatus(`hero contest: ${done}/${groups.length} rounds`);
    })
      .then(() => {
        if (run !== contestRun.current) return;
        const average = new Map([...wins].map(([id, total]) => [id, total / (seen.get(id) ?? 1)]));
        const best = Math.max(...average.values());
        setContests((current) => new Map(current).set(contestKey, new Map([...average].map(([id, v]) => [id, v / best]))));
        setContestStatus(`hero contest: ${groups.length} rounds over ${candidates.length} candidates`);
      })
      .catch((e: Error) => {
        if (run === contestRun.current) setContestStatus(`hero contest failed: ${e.message}`);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [answeredAll, contestKey]);

  const ranked = useMemo(
    () => [...judged].sort((a, b) => baseRank(b.answers) - baseRank(a.answers)),
    [judged],
  );
  const baseId = quest ? baseByQuest[quest.id] ?? ranked[0]?.scrap.id : undefined;
  const base = judged.find((item) => item.scrap.id === baseId);

  // Cutouts are made only where they are seen: the top base candidates, the
  // base itself, and pieces Clef wants cut out.
  const cutoutTargets = useMemo(() => {
    const wanted = new Map<string, ImageScrap>();
    for (const { scrap } of ranked.slice(0, 24)) wanted.set(scrap.id, scrap);
    if (base) wanted.set(base.scrap.id, base.scrap);
    for (const { scrap, answers: a } of judged) if (cutAll || a.cutout.noul >= cutoutThreshold) wanted.set(scrap.id, scrap);
    return [...wanted.values()];
  }, [ranked, base, judged, cutoutThreshold, cutAll]);
  const allCutouts = useCutouts(cutoutTargets, toleranceFor);
  const frame = frameOf(format);

  const settledJudged = useSettled(judged, 800);
  const settledRandom = useSettled(judgedRandom, 800);
  const casting = useMemo(() => castRoles(settledJudged, sizing, contest), [settledJudged, sizing, contest]);
  const settledCutouts = useSettled(allCutouts, 800);
  const outlineOf = useCallback(
    (scrap: ImageScrap) => {
      const cut = settledCutouts.get(scrap.id);
      return cut ? { mask: cut.mask, width: cut.width, height: cut.height } : null;
    },
    [settledCutouts],
  );
  const visibleShare = useCallback((scrap: ImageScrap) => settledCutouts.get(scrap.id)?.keptShare ?? 1, [settledCutouts]);
  const rules = useMemo(
    () => ({ cutoutThreshold, cutAll, toleranceFor, maxRotation }),
    [cutoutThreshold, cutAll, toleranceFor, maxRotation],
  );
  const baseCutout = base ? allCutouts.get(base.scrap.id) : undefined;
  const freeOptions = useMemo(
    () => ({ ...rules, seed, density, spreadRounds, sizing, outlineOf, visibleShare, gap, wallpaperTiles, accentRepeats, layeredSupporting, layeredDensity }),
    [rules, seed, density, spreadRounds, sizing, outlineOf, visibleShare, gap, wallpaperTiles, accentRepeats, layeredSupporting, layeredDensity],
  );
  const shapeOptions = useMemo(
    () => ({ ...rules, visibleShare, outlineOf, gap, seed, fill, packFill, tries: 60, largestPartOnly, fillHoles, inset, sizing }),
    [rules, visibleShare, outlineOf, gap, seed, fill, packFill, largestPartOnly, fillHoles, inset, sizing],
  );

  /** One layout style from one set of answers; shape styles fill the base, which Clef's ranking (or your pick) chose. */
  const runLayout = useCallback(
    (id: LayoutId, items: Judged[], heroes?: Map<string, number>): LayoutResult | null => {
      const style = LAYOUTS.find((layout) => layout.id === id) as (typeof LAYOUTS)[number];
      if (style.kind === "free") {
        const result = freeLayout(castRoles(items, sizing, heroes), frame, { ...freeOptions, arrangement: style.arrangement });
        return {
          placements: result.placements,
          coverage: style.arrangement === "pack" ? result.coverage : null,
          spill: null,
          skipped: result.skipped.length,
        };
      }
      // A cut that removed every pixel leaves no shape to fill.
      if (!base || !baseCutout || baseCutout.keptShare === 0) return null;
      const others = items.filter((item) => item.scrap.id !== base.scrap.id);
      if (others.length === 0) return null;
      const result = shapeLayout(baseCutout, castRoles(others, sizing, heroes), frame, { ...shapeOptions, mode: style.mode });
      return {
        placements: result.placements,
        coverage: result.coverage,
        spill: result.spill,
        skipped: result.skipped.length,
        silhouette: result.shape,
        silhouetteBox: result.silhouetteBox,
      };
    },
    [base, baseCutout, sizing, frame.width, frame.height, freeOptions, shapeOptions],
  );

  // Layouts are only worked out while the compare view shows them; packing is not free.
  const results = useMemo(
    () =>
      tab !== "compare"
        ? []
        : LAYOUTS.filter((layout) => shownLayouts.includes(layout.id)).map((layout) => ({
            layout,
            clef: runLayout(layout.id, settledJudged, contest),
            random: showRandom ? runLayout(layout.id, settledRandom) : null,
          })),
    [tab, shownLayouts, showRandom, runLayout, settledJudged, settledRandom, contest],
  );
  const focusedRow = focused ? results.find((row) => row.layout.id === focused.id) : undefined;
  const focusedResult = focusedRow ? focusedRow[focused?.source ?? "clef"] : null;

  const title = quest
    ? `${quest.domains[0]?.domain || "quest"} ${new Date(quest.start).toISOString().slice(0, 10)}`
    : "quest";
  const shapeMissing =
    baseCutout && baseCutout.keptShare === 0
      ? "The base shape's cutout removed the whole image. Lower its cutout edge in base shapes, or pick another base."
      : "Pick a base shape in the base shapes tab (its cutout is still loading, or none is chosen).";

  return (
    <div className="lab">
      <header>
        <h1>quest lab</h1>
        <div className="path">
          <input
            value={pathDraft}
            onChange={(event) => setPathDraft(event.target.value)}
            placeholder="~/Downloads or a wwo-scraps-export.json path"
          />
          <button onClick={savePath}>{config?.exportPath ? "reload" : "remember"}</button>
        </div>
        <div className="status">
          {loaded ? (
            <>
              {loaded.scraps.length} images from <code>{loaded.file}</code> · exported {formatTime(loaded.exportedAt)} · last {loaded.days} days
            </>
          ) : (
            <>No export loaded. Run <code>quest-lab/exportScraps.js</code> on the scraps page, then point this at the file or its folder.</>
          )}
          {config && !config.clefReady && (
            <div className="warn">
              Clef is not set up: add <code>CLOUDFLARE_ACCOUNT_ID</code> and <code>CLOUDFLARE_API_TOKEN</code> to <code>extension/website/.env.local</code> and restart the dev server.
            </div>
          )}
          {error && <div className="warn">{error}</div>}
        </div>
      </header>

      <div className="body">
        <aside>
          <h2>quests</h2>
          <Slider label="break between quests (min)" value={gapMinutes} min={5} max={120} step={5} onChange={setGapMinutes} />
          <Slider label="smallest quest" value={minScraps} min={2} max={30} step={1} onChange={setMinScraps} />
          <Slider label="drop images smaller than (px)" value={noise.minSide} min={0} max={300} step={10} onChange={(minSide) => setNoise({ ...noise, minSide })} />
          <label className="check">
            <input type="checkbox" checked={noise.dropSvg} onChange={(e) => setNoise({ ...noise, dropSvg: e.target.checked })} />
            drop SVGs
          </label>
          <p className="muted">{clean.length} images after noise · {quests.length} quests</p>
          <ol className="quests">
            {quests.map((q) => (
              <li key={q.id}>
                <button className={q.id === quest?.id ? "active" : ""} onClick={() => setQuestId(q.id)}>
                  <b>{formatTime(q.start)}</b>
                  <span>
                    {Math.max(1, Math.round((q.end - q.start) / 60_000))} min · {q.scraps.length} images
                  </span>
                  <span className="muted">{q.domains.slice(0, 3).map((d) => d.domain).join(", ")}</span>
                  <span className="strip">
                    {q.scraps.slice(0, 8).map((s) => (
                      <img key={s.id} src={imageUrl(s)} loading="lazy" />
                    ))}
                  </span>
                </button>
              </li>
            ))}
          </ol>
        </aside>

        <main>
          {quest && (
            <>
              <section className="quest-head">
                <label className="control">
                  <span>model</span>
                  <select value={model} onChange={(e) => setModel(e.target.value as ClefModel)}>
                    <option value="clef-flash">clef-flash (9B, fast)</option>
                    <option value="clef">clef (27B)</option>
                  </select>
                </label>
                <label className="check">
                  <input type="checkbox" checked={useAll} onChange={(e) => setUseAll(e.target.checked)} />
                  use every scrap in the quest ({quest.scraps.length})
                </label>
                {!useAll && (
                  <Slider label="use the first N scraps of the quest" value={maxPieces} min={5} max={600} step={5} onChange={setMaxPieces} />
                )}
                <button onClick={() => void ask()} disabled={!config?.clefReady}>
                  ask Clef again
                </button>
                {progress && (
                  <span className="muted">
                    {progress.done}/{progress.total} answered{progress.failed ? ` · ${progress.failed} failed` : ""}
                    {contestStatus && <><br />{contestStatus}</>}
                  </span>
                )}
              </section>

              <details className="trace">
                <summary>what we send Clef</summary>
                <p>
                  Clef only sorts. One request per scrap to <code>@cf/cloudflare/{model}</code>, with the scrap's image
                  (shrunk to at most 768px, JPEG), the text state below (the scrap, plus the quest's sites and page titles in
                  place of a goal), and the same {Object.keys(scrapQuestions()).length} questions. Sizes, spots, and angles are
                  all decided by the layout code. Open a card's "sent and answered" in base shapes to see one scrap's exact
                  state and answers.
                </p>
                <p>
                  Then the hero contest: the {contestSize(heroCount)} scraps with the highest hero odds are shuffled into groups of up to 4,
                  twice, and each group goes to Clef as one request with all its images and this question. A scrap's strength is how often
                  it won compared with its fair share; the strongest become heroes.
                </p>
                <Json value={heroContestQuestion(4)} />
                <h3>state (example: first scrap)</h3>
                <Json value={working[0] && context ? scrapState(working[0], context) : null} />
                <h3>questions</h3>
                <Json value={scrapQuestions()} />
              </details>


              <nav className="tabs">
                {(
                  [
                    ["scraps", "scraps"],
                    ["base", "base shapes"],
                    ["compare", "compare layouts"],
                  ] as const
                ).map(([id, label]) => (
                  <button key={id} className={tab === id ? "active" : ""} onClick={() => setTab(id)}>
                    {label}
                  </button>
                ))}
              </nav>

              {tab === "scraps" && (
                <section className="scrap-grid">
                  {quest.scraps.map((scrap, index) => {
                    const a = answers.get(scrap.id);
                    const member = casting.cast.find((m) => m.item.scrap.id === scrap.id);
                    return (
                      <figure key={scrap.id} className={index >= pieceLimit ? "unused" : ""}>
                        <img src={imageUrl(scrap)} loading="lazy" title={`${scrap.alt || scrap.pageTitle}\n${scrap.domain}`} />
                        <figcaption>
                          {index >= pieceLimit ? "not used" : member ? member.role : a ? "" : "..."}
                        </figcaption>
                      </figure>
                    );
                  })}
                </section>
              )}

              {tab === "compare" && (
                <section className="settings">
                  <fieldset>
                    <legend>show</legend>
                    {LAYOUTS.map((layout) => (
                      <label key={layout.id} className="check">
                        <input
                          type="checkbox"
                          checked={shownLayouts.includes(layout.id)}
                          onChange={(e) =>
                            setShownLayouts(
                              e.target.checked
                                ? [...shownLayouts, layout.id]
                                : shownLayouts.filter((id) => id !== layout.id),
                            )
                          }
                        />
                        {layout.label}
                      </label>
                    ))}
                    <label className="check">
                      <input type="checkbox" checked={showRandom} onChange={(e) => setShowRandom(e.target.checked)} />
                      add a random-answers column (no AI) beside Clef's
                    </label>
                    <button onClick={() => setSeed(seed + 1)}>reroll (seed {seed})</button>
                  </fieldset>
                  <fieldset>
                    <legend>pieces</legend>
                    <label className="check">
                      <input type="checkbox" checked={cutAll} onChange={(e) => setCutAll(e.target.checked)} />
                      cut out every piece
                    </label>
                    {!cutAll && (
                      <Slider label="cut out when Clef says yes at" value={cutoutThreshold} min={0} max={1} step={0.05} onChange={setCutoutThreshold} />
                    )}
                    <Slider label="cutout edge (all scraps)" value={defaultTolerance} min={0} max={0.6} step={0.01} onChange={setDefaultTolerance} />
                    <Slider label="rotation, either way (degrees)" value={maxRotation} min={0} max={90} step={5} onChange={setMaxRotation} />
                    <Slider label="gap between packed pieces" value={gap} min={0} max={4} step={1} onChange={setGap} />
                  </fieldset>
                  <fieldset>
                    <legend>heroes and roles</legend>
                    <Slider label="heroes (strongest in Clef's contest)" value={heroCount} min={0} max={8} step={1} onChange={setHeroCount} />
                    <Slider label="lead hero size (share of short side)" value={heroSide} min={0.1} max={0.7} step={0.05} onChange={setHeroSide} />
                    <Slider label="accent size (share of short side)" value={accentSide} min={0.03} max={0.25} step={0.01} onChange={setAccentSide} />
                    <Slider label="supporting size contrast (0 = equal)" value={contrast} min={0} max={6} step={0.25} onChange={setContrast} />
                  </fieldset>
                  <fieldset>
                    <legend>free canvas</legend>
                    <label className="control">
                      <span>format</span>
                      <select value={format} onChange={(e) => setFormat(e.target.value as CollageFormatName)}>
                        {FORMAT_NAMES.map((name) => (
                          <option key={name} value={name}>{COLLAGE_FORMATS[name].label}</option>
                        ))}
                      </select>
                    </label>
                    <Slider label="density" value={density} min={0.3} max={2.5} step={0.1} onChange={setDensity} />
                    <Slider label="spread (gathered only)" value={spreadRounds} min={0} max={60} step={2} onChange={setSpreadRounds} />
                    <Slider label="wallpaper tiles (layered)" value={wallpaperTiles} min={0} max={16} step={1} onChange={setWallpaperTiles} />
                    <Slider label="accent repeats, at most (layered)" value={accentRepeats} min={1} max={9} step={1} onChange={setAccentRepeats} />
                    <Slider label="supporting pieces on top (layered)" value={layeredSupporting} min={0} max={200} step={2} onChange={setLayeredSupporting} />
                    <Slider label="area pieces cover (layered)" value={layeredDensity} min={0.1} max={1.2} step={0.05} onChange={setLayeredDensity} />
                  </fieldset>
                  <fieldset>
                    <legend>inside the shape</legend>
                    <Slider label="fill when packed (about 1 fills it)" value={packFill} min={0.3} max={1.5} step={0.05} onChange={setPackFill} />
                    <Slider label="fill when overlapping" value={fill} min={0.4} max={3} step={0.1} onChange={setFill} />
                    <Slider label="keep big pieces off the outline" value={inset} min={0} max={1.5} step={0.1} onChange={setInset} />
                    <label className="check">
                      <input type="checkbox" checked={largestPartOnly} onChange={(e) => setLargestPartOnly(e.target.checked)} />
                      biggest part only
                    </label>
                    <label className="check">
                      <input type="checkbox" checked={fillHoles} onChange={(e) => setFillHoles(e.target.checked)} />
                      fill holes
                    </label>
                    <label className="check">
                      <input type="checkbox" checked={showGhost} onChange={(e) => setShowGhost(e.target.checked)} />
                      show base ghost
                    </label>
                  </fieldset>
                </section>
              )}

              {tab === "base" && (
                <section className="bases">
                  {ranked.map(({ scrap, answers: a }) => {
                    const cut = allCutouts.get(scrap.id);
                    const chosen = scrap.id === baseId;
                    return (
                      <article key={scrap.id} className={chosen ? "base chosen" : "base"}>
                        <div className="pair">
                          <img src={imageUrl(scrap)} />
                          {cut && <img className="sil" src={silhouetteUrl(cut, "#3d3833")} />}
                        </div>
                        <div className="meta">
                          <b>{baseRank(a).toFixed(2)}</b> {scrap.alt || scrap.pageTitle}
                          <span className="muted">{scrap.domain} · {IMAGE_KINDS[a.kind.choice as keyof typeof IMAGE_KINDS] ?? a.kind.choice}</span>
                        </div>
                        <Bar label="silhouette" value={a.silhouette.score} max={4} />
                        <Bar label="isolated" value={a.isolated.noul} />
                        <Bar label="fits the quest" value={a.questFit.score} max={3} />
                        {cut && <Bar label="edge cut kept" value={cut.keptShare} hint="share of pixels the editor's edge cut keeps; 1.00 means it removed nothing" />}
                        <label className="control">
                          <span>
                            cutout edge <b>{toleranceFor(scrap).toFixed(2)}</b>
                            {tolerances[scrap.id] !== undefined && (
                              <button
                                className="link"
                                onClick={() => {
                                  const { [scrap.id]: _, ...rest } = tolerances;
                                  setTolerances(rest);
                                }}
                              >
                                reset
                              </button>
                            )}
                          </span>
                          <input
                            type="range"
                            min={0}
                            max={0.6}
                            step={0.01}
                            value={toleranceFor(scrap)}
                            onChange={(e) => setTolerances({ ...tolerances, [scrap.id]: Number(e.target.value) })}
                          />
                        </label>
                        <details className="trace">
                          <summary>sent and answered</summary>
                          {sent.get(scrap.id) && (
                            <>
                              <img className="sent" src={sent.get(scrap.id)?.image} />
                              <Json value={sent.get(scrap.id)?.state} />
                            </>
                          )}
                          <Json value={a} />
                        </details>
                        <button
                          disabled={chosen}
                          onClick={() => setBaseByQuest({ ...baseByQuest, [quest.id]: scrap.id })}
                        >
                          {chosen ? "base shape" : "use as base"}
                        </button>
                      </article>
                    );
                  })}
                </section>
              )}

              {tab === "compare" && focused && focusedResult && (
                <section className="focus">
                  <div className="focus-head">
                    <h3>
                      {focusedRow?.layout.label} · {focused.source === "clef" ? "Clef" : "random answers"}
                    </h3>
                    <span className="muted">{layoutStats(focusedResult)}</span>
                    <button
                      onClick={() =>
                        void downloadCollage(`${title} ${focused.id}`, format, focusedResult.placements)
                      }
                    >
                      download for the collage editor
                    </button>
                    <button onClick={() => setFocused(null)}>close</button>
                  </div>
                  <LayoutView frame={frame} result={focusedResult} cutouts={allCutouts} showGhost={showGhost} />
                  <PlacementTrace placements={focusedResult.placements} />
                </section>
              )}

              {tab === "compare" && (
                <section className={showRandom ? "layout-grid two" : "layout-grid"}>
                  {showRandom && (
                    <>
                      <h3>Clef's answers</h3>
                      <h3>random answers (no AI)</h3>
                    </>
                  )}
                  {results.map((row) => (
                    <div key={row.layout.id} className="layout-row">
                      {(showRandom ? (["clef", "random"] as const) : (["clef"] as const)).map((source) => {
                        const result = row[source];
                        return (
                          <figure key={source} className="layout-cell">
                            <figcaption>
                              <b>{row.layout.label}</b>
                              {result && <span className="muted"> · {layoutStats(result)}</span>}
                            </figcaption>
                            {result ? (
                              <button className="open" onClick={() => setFocused({ id: row.layout.id, source })} title="open big">
                                <LayoutView frame={frame} result={result} cutouts={allCutouts} showGhost={showGhost} />
                              </button>
                            ) : (
                              <p className="muted">{row.layout.kind === "shape" ? shapeMissing : "No answers yet."}</p>
                            )}
                          </figure>
                        );
                      })}
                    </div>
                  ))}
                </section>
              )}
            </>
          )}
        </main>
      </div>
    </div>
  );
}

createRoot(document.getElementById("root") as HTMLElement).render(<App />);
