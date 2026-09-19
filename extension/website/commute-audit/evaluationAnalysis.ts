// ABOUTME: Reduces every exported navigation event into privacy-safe evaluation candidates and metrics.
// ABOUTME: Samples distinct hidden-gem lanes while keeping raw private URLs out of the browser artifact.

import { buildPageRef, canonicalizeUrl, type CollectionEvent } from "@playhtml/extension-types";
import { getDomain } from "tldts";

import { buildCommuteResponse } from "../../worker/src/routes/commutePolicy";
import {
  classifyCharacter,
  classifyContent,
  classifyPageType,
  exposureLabel,
  formulaScores,
  initialJudgment,
  isLowTrustPromotionDomain,
  isMajorPlatform,
  scoreComponents,
} from "./evaluationModel";
import {
  CONTENT_CATEGORIES,
  PAGE_TYPES,
  SAMPLE_LANES,
  type CharacterLabel,
  type CommuteEvaluationData,
  type ContentCategory,
  type CoverageRow,
  type EvaluationCandidate,
  type ExternalEvidence,
  type FormulaScores,
  type PageType,
  type SampleLane,
} from "./evaluationTypes";
import type { ExportPageMetadata, ExportScanSummary } from "../scripts/postgresCopy";

const MIN_SCREEN_TIME_MS = 1_000;
const MAX_SCREEN_TIME_MS = 8 * 60 * 60 * 1_000;
const LANE_LIMIT = 80;
const MAJOR_PLATFORM_LANE_LIMIT = 12;
const LOW_TRUST_LANE_LIMIT = 24;
const DEFAULT_DOMAIN_CAP = 3;
const DIAGNOSTIC_DOMAIN_CAP = 2;
const UNCOMMON_DOMAIN_PARTICIPANT_LIMIT = 4;
const UNCOMMON_DOMAIN_MIN_PARTICIPANTS = 2;
const UNCOMMON_DOMAIN_MIN_ATTENTION_MS = 90_000;
const UNCOMMON_DOMAIN_MIN_VISITS = 2;
const PRIVATE_WORKFLOW_DOMAINS = new Set([
  "clickup.com",
  "cryptpad.fr",
  "duck.ai",
  "edstem.org",
  "education.tas.gov.au",
  "feather-lite.dev",
  "feather.computer",
  "mckinseyaccelerate.com",
  "ngwebsolutions.com",
  "inoreader.com",
  "icloud.com",
  "trello.com",
  "whatsapp.com",
]);

interface MutablePage {
  rawUrl: string;
  canonicalUrl: string;
  domain: string;
  pageRef: string;
  title: string;
  visits: number;
  screenTimeMs: number;
  participants: Set<number>;
  sessions: Set<number>;
  firstSeen: number;
  lastSeen: number;
}

interface MutableDomain {
  domain: string;
  visits: number;
  screenTimeMs: number;
  participants: Set<number>;
}

interface PendingFocus {
  pageKey: string;
  ts: number;
}

export type AttentionEventName = "focus" | "blur";
export type AttentionSink = (sessionId: number, ts: number, eventName: AttentionEventName, pageId: number) => void;

interface MetadataValue {
  title: string;
  validFrom: number;
  isCurrent: boolean;
}

interface RankedCandidate {
  candidate: EvaluationCandidate;
  metric: number;
}

interface CoverageCounter {
  total: number;
  uncertain: number;
  confidence: number;
}

function registrableDomain(rawUrl: string): string | null {
  try {
    const hostname = new URL(rawUrl).hostname.toLowerCase().replace(/^www\./, "");
    return getDomain(hostname, { allowPrivateDomains: true }) ?? hostname;
  } catch {
    return null;
  }
}

function hash(value: string): number {
  let result = 0x811c9dc5;
  for (let index = 0; index < value.length; index++) {
    result ^= value.charCodeAt(index);
    result = Math.imul(result, 0x01000193);
  }
  return result >>> 0;
}

function candidateId(url: string): string {
  const forward = hash(url).toString(16).padStart(8, "0");
  const reverse = hash([...url].reverse().join("")).toString(16).padStart(8, "0");
  return `page_${forward}${reverse}`;
}

export function isSensitiveDestination(rawUrl: string, title: string): boolean {
  const domain = registrableDomain(rawUrl);
  if (!domain) return true;
  if (PRIVATE_WORKFLOW_DOMAINS.has(domain)) return true;
  if (/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i.test(title)) return true;
  if (classifyPageType(rawUrl, title).value === "Account or private workflow") return true;
  if (/\b(google keep|inbox|microsoft teams|newsfeed|notebooklm|profil|session timeout|verification appointment)\b/i.test(title)) return true;
  if (/\b(application web|course and fees|review and pay|student application)\b/i.test(title)) return true;
  try {
    const url = new URL(rawUrl);
    if (["classroom.google.com", "keep.google.com", "messages.google.com", "notebooklm.google.com"].includes(url.hostname)) return true;
    if (domain === "overleaf.com" && url.pathname.startsWith("/project/")) return true;
    if (domain === "aternos.org" && /^\/server\b/.test(url.pathname)) return true;
  } catch {
    return true;
  }
  return false;
}

function boundedInsert(
  rows: RankedCandidate[],
  candidate: EvaluationCandidate,
  metric: number,
  limit = LANE_LIMIT,
  domainCap = DEFAULT_DOMAIN_CAP,
): void {
  if (rows.length >= limit && metric <= rows[rows.length - 1].metric) return;
  const domainRows = rows.filter((row) => row.candidate.domain === candidate.domain);
  if (domainRows.length >= domainCap && metric <= domainRows[domainRows.length - 1].metric) return;
  rows.push({ candidate, metric });
  rows.sort((first, second) => second.metric - first.metric || first.candidate.id.localeCompare(second.candidate.id));
  const domainCounts = new Map<string, number>();
  const kept: RankedCandidate[] = [];
  for (const row of rows) {
    const count = domainCounts.get(row.candidate.domain) ?? 0;
    if (count >= domainCap) continue;
    kept.push(row);
    domainCounts.set(row.candidate.domain, count + 1);
    if (kept.length >= limit) break;
  }
  rows.splice(0, rows.length, ...kept);
}

function mergeSet<T>(target: Set<T>, source: Set<T>): void {
  for (const value of source) target.add(value);
}

function currentRankingMetric(candidate: EvaluationCandidate): number {
  return Math.log1p(candidate.observation.screenTimeMs) * 0.45 + Math.log1p(candidate.observation.participants) * 0.3 + Math.log1p(candidate.observation.visits) * 0.25;
}

function uncommonEngagementMetric(candidate: EvaluationCandidate): number {
  return candidate.scores.longTail
    + Math.log1p(candidate.observation.screenTimeMs / 60_000) * 8
    + Math.log1p(candidate.observation.visits) * 4;
}

function reasonList(candidate: Omit<EvaluationCandidate, "initialJudgment" | "reasons">): string[] {
  const reasons = [
    `${candidate.observation.participants} ${candidate.observation.participants === 1 ? "person" : "people"}`,
    `${candidate.observation.visits} focus ${candidate.observation.visits === 1 ? "visit" : "visits"}`,
    `${Math.round(candidate.observation.screenTimeMs / 60_000)} min paired attention`,
    `${candidate.observation.domainParticipants} people on domain`,
  ];
  if (candidate.external.viewCount !== undefined) reasons.push(`${candidate.external.viewCount.toLocaleString()} external views`);
  return reasons;
}

function coverageRow(
  dimension: CoverageRow["dimension"],
  counter: CoverageCounter,
): CoverageRow {
  return {
    dimension,
    classified: counter.total - counter.uncertain,
    uncertain: counter.uncertain,
    total: counter.total,
    averageConfidence: counter.total === 0 ? 0 : counter.confidence / counter.total,
  };
}

function isCategoryUncertain(value: ContentCategory): boolean {
  return value === "Other";
}

function isPageTypeUncertain(value: PageType): boolean {
  return value === "Other";
}

function isCharacterUncertain(value: CharacterLabel): boolean {
  return value === "Uncertain";
}

export class CommuteEvaluationBuilder {
  private navigationEvents = 0;
  private focusVisits = 0;
  private excludedVisits = 0;
  private pairedScreenTimeMs = 0;
  private outOfOrderEvents = 0;
  private lastEventTs = 0;
  private startTs = Number.POSITIVE_INFINITY;
  private endTs = 0;
  private readonly participantIds = new Map<string, number>();
  private readonly sessionIds = new Map<string, number>();
  private readonly pages = new Map<string, MutablePage>();
  private readonly pageIds = new Map<string, number>();
  private readonly pageKeys: string[] = [];
  private readonly domains = new Map<string, MutableDomain>();
  private readonly pendingFocus = new Map<number, PendingFocus>();
  private readonly metadataByRef = new Map<string, MetadataValue>();

  constructor(private readonly attentionSink?: AttentionSink) {}

  private intern(map: Map<string, number>, value: string): number {
    const existing = map.get(value);
    if (existing !== undefined) return existing;
    const id = map.size;
    map.set(value, id);
    return id;
  }

  addNavigation(event: CollectionEvent): void {
    this.navigationEvents++;
    if (this.lastEventTs > event.ts) this.outOfOrderEvents++;
    this.lastEventTs = event.ts;
    this.startTs = Math.min(this.startTs, event.ts);
    this.endTs = Math.max(this.endTs, event.ts);

    const pid = event.meta?.pid;
    const sid = event.meta?.sid;
    const rawUrl = event.meta?.url;
    if (!pid || !sid || !rawUrl) {
      this.excludedVisits++;
      return;
    }
    const domain = registrableDomain(rawUrl);
    if (!domain) {
      this.excludedVisits++;
      return;
    }
    const data = event.data as Record<string, unknown> | null;
    const eventName = typeof data?.event === "string" ? data.event : "";
    const participantId = this.intern(this.participantIds, pid);
    const sessionId = this.intern(this.sessionIds, `${pid}\u0000${sid}`);

    if (eventName === "focus") {
      const canonicalUrl = canonicalizeUrl(rawUrl);
      const pageKey = canonicalUrl;
      const storedPageRef = typeof data?.page_ref === "string" ? data.page_ref : buildPageRef(canonicalUrl);
      const storedTitle = typeof data?.title === "string" ? data.title.replace(/\s+/g, " ").trim() : "";
      const page = this.pages.get(pageKey) ?? {
        rawUrl,
        canonicalUrl,
        domain,
        pageRef: storedPageRef,
        title: storedTitle,
        visits: 0,
        screenTimeMs: 0,
        participants: new Set<number>(),
        sessions: new Set<number>(),
        firstSeen: event.ts,
        lastSeen: event.ts,
      };
      page.visits++;
      page.participants.add(participantId);
      page.sessions.add(sessionId);
      page.firstSeen = Math.min(page.firstSeen, event.ts);
      page.lastSeen = Math.max(page.lastSeen, event.ts);
      if (!page.title && storedTitle) page.title = storedTitle;
      this.pages.set(pageKey, page);
      let pageId = this.pageIds.get(pageKey);
      if (pageId === undefined) {
        pageId = this.pageKeys.length;
        this.pageIds.set(pageKey, pageId);
        this.pageKeys.push(pageKey);
      }

      const domainRow = this.domains.get(domain) ?? {
        domain,
        visits: 0,
        screenTimeMs: 0,
        participants: new Set<number>(),
      };
      domainRow.visits++;
      domainRow.participants.add(participantId);
      this.domains.set(domain, domainRow);

      if (this.attentionSink) this.attentionSink(sessionId, event.ts, "focus", pageId);
      else this.pendingFocus.set(sessionId, { pageKey, ts: event.ts });
      this.focusVisits++;
      return;
    }

    if (eventName === "blur" || eventName === "beforeunload") {
      if (this.attentionSink) this.attentionSink(sessionId, event.ts, "blur", -1);
      else this.addOrderedAttention(sessionId, event.ts, "blur", -1);
    }
  }

  addOrderedAttention(sessionId: number, ts: number, eventName: AttentionEventName, pageId: number): void {
    if (eventName === "focus") {
      const pageKey = this.pageKeys[pageId];
      if (pageKey !== undefined) this.pendingFocus.set(sessionId, { pageKey, ts });
      return;
    }
    const pending = this.pendingFocus.get(sessionId);
    if (!pending) return;
    const durationMs = ts - pending.ts;
    if (durationMs >= MIN_SCREEN_TIME_MS && durationMs <= MAX_SCREEN_TIME_MS) {
      const page = this.pages.get(pending.pageKey);
      if (page) {
        page.screenTimeMs += durationMs;
        const domainRow = this.domains.get(page.domain);
        if (domainRow) domainRow.screenTimeMs += durationMs;
        this.pairedScreenTimeMs += durationMs;
      }
    }
    this.pendingFocus.delete(sessionId);
  }

  addMetadata(metadata: ExportPageMetadata): void {
    const existing = this.metadataByRef.get(metadata.pageRef);
    const isCurrent = metadata.validTo === null;
    if (!existing || (isCurrent && !existing.isCurrent) || (isCurrent === existing.isCurrent && metadata.validFrom > existing.validFrom)) {
      this.metadataByRef.set(metadata.pageRef, { title: metadata.title.replace(/\s+/g, " ").trim(), validFrom: metadata.validFrom, isCurrent });
    }
  }

  finalize(sourceArchive: string, scan: ExportScanSummary, externalByUrl = new Map<string, ExternalEvidence>()): CommuteEvaluationData {
    const publicPages = new Map<string, MutablePage>();
    let publicVisits = 0;
    let privateVisits = 0;

    for (const page of this.pages.values()) {
      const title = this.metadataByRef.get(page.pageRef)?.title || page.title;
      const policyEvent: CollectionEvent = {
        id: page.pageRef,
        type: "navigation",
        ts: page.lastSeen,
        data: { event: "focus", title },
        meta: { pid: "audit", sid: "audit", url: page.rawUrl, vw: 0, vh: 0, tz: "UTC" },
      };
      const publicUrl = buildCommuteResponse([policyEvent], [], page.lastSeen).destinations[0]?.url;
      if (!publicUrl || isSensitiveDestination(publicUrl, title)) {
        privateVisits += page.visits;
        continue;
      }
      publicVisits += page.visits;
      const canonicalPublicUrl = canonicalizeUrl(publicUrl);
      const existing = publicPages.get(canonicalPublicUrl);
      if (!existing) {
        publicPages.set(canonicalPublicUrl, { ...page, rawUrl: publicUrl, canonicalUrl: canonicalPublicUrl, title });
        continue;
      }
      existing.visits += page.visits;
      existing.screenTimeMs += page.screenTimeMs;
      mergeSet(existing.participants, page.participants);
      mergeSet(existing.sessions, page.sessions);
      existing.firstSeen = Math.min(existing.firstSeen, page.firstSeen);
      existing.lastSeen = Math.max(existing.lastSeen, page.lastSeen);
      if (!existing.title && title) existing.title = title;
    }

    const laneBuckets = new Map<SampleLane, RankedCandidate[]>(SAMPLE_LANES.map((lane) => [lane, []]));
    const formulaBuckets = new Map<keyof FormulaScores, RankedCandidate[]>([
      ["balanced", []],
      ["longTail", []],
      ["hiddenPlatform", []],
      ["humanWeb", []],
    ]);
    const categoryCoverage: CoverageCounter = { total: 0, uncertain: 0, confidence: 0 };
    const pageTypeCoverage: CoverageCounter = { total: 0, uncertain: 0, confidence: 0 };
    const characterCoverage: CoverageCounter = { total: 0, uncertain: 0, confidence: 0 };

    for (const page of publicPages.values()) {
      const domain = this.domains.get(page.domain);
      if (!domain) continue;
      const observation = {
        visits: page.visits,
        participants: page.participants.size,
        sessions: page.sessions.size,
        screenTimeMs: page.screenTimeMs,
        firstSeen: new Date(page.firstSeen).toISOString(),
        lastSeen: new Date(page.lastSeen).toISOString(),
        domainParticipants: domain.participants.size,
        domainVisits: domain.visits,
        domainScreenTimeMs: domain.screenTimeMs,
      };
      const external = externalByUrl.get(page.canonicalUrl) ?? { status: "not-requested" };
      const evidenceText = [external.title, page.title, external.description].filter(Boolean).join(" · ");
      const category = classifyContent(page.canonicalUrl, evidenceText);
      const pageType = classifyPageType(page.canonicalUrl, evidenceText);
      const character = classifyCharacter(page.canonicalUrl, evidenceText, external);
      const components = scoreComponents(page.canonicalUrl, observation, category, pageType, character, external);
      const scores = formulaScores(components);
      const base = {
        id: candidateId(page.canonicalUrl),
        url: page.canonicalUrl,
        title: external.title || page.title || page.domain,
        domain: page.domain,
        lanes: [] as SampleLane[],
        observation,
        category,
        pageType,
        exposure: exposureLabel(true),
        character,
        external,
        components,
        scores,
      } satisfies Omit<EvaluationCandidate, "initialJudgment" | "reasons">;
      const candidate: EvaluationCandidate = {
        ...base,
        initialJudgment: initialJudgment(base),
        reasons: reasonList(base),
      };

      categoryCoverage.total++;
      categoryCoverage.confidence += category.confidence;
      if (isCategoryUncertain(category.value)) categoryCoverage.uncertain++;
      pageTypeCoverage.total++;
      pageTypeCoverage.confidence += pageType.confidence;
      if (isPageTypeUncertain(pageType.value)) pageTypeCoverage.uncertain++;
      characterCoverage.total++;
      characterCoverage.confidence += character.confidence;
      if (isCharacterUncertain(character.value)) characterCoverage.uncertain++;

      for (const formula of formulaBuckets.keys()) {
        boundedInsert(formulaBuckets.get(formula) as RankedCandidate[], candidate, scores[formula], 50, 50);
      }
      const majorPlatform = isMajorPlatform(page.domain);
      const lowTrust = isLowTrustPromotionDomain(page.domain);
      const humanReviewCandidate = !majorPlatform && !lowTrust;
      if (
        humanReviewCandidate
        && observation.participants >= UNCOMMON_DOMAIN_MIN_PARTICIPANTS
        && observation.domainParticipants <= UNCOMMON_DOMAIN_PARTICIPANT_LIMIT
        && observation.screenTimeMs >= UNCOMMON_DOMAIN_MIN_ATTENTION_MS
        && observation.visits >= UNCOMMON_DOMAIN_MIN_VISITS
      ) {
        boundedInsert(laneBuckets.get("Engaged uncommon domain") as RankedCandidate[], candidate, uncommonEngagementMetric(candidate));
      }
      if (humanReviewCandidate && observation.domainParticipants <= 2 && observation.participants <= 2 && observation.screenTimeMs >= 30_000 && components.specificity >= 0.34) {
        boundedInsert(laneBuckets.get("Rare page on rare domain") as RankedCandidate[], candidate, scores.longTail);
      }
      if (majorPlatform && observation.participants <= 2 && components.specificity >= 0.34) {
        boundedInsert(
          laneBuckets.get("Hidden item on major platform") as RankedCandidate[],
          candidate,
          scores.hiddenPlatform,
          MAJOR_PLATFORM_LANE_LIMIT,
          DIAGNOSTIC_DOMAIN_CAP,
        );
      }
      if (humanReviewCandidate && observation.participants >= 2 && observation.participants <= 4) {
        boundedInsert(laneBuckets.get("Independent convergence") as RankedCandidate[], candidate, scores.balanced);
      }
      if (humanReviewCandidate) {
        boundedInsert(laneBuckets.get("High attention") as RankedCandidate[], candidate, observation.screenTimeMs);
        boundedInsert(laneBuckets.get("Current ranking") as RankedCandidate[], candidate, currentRankingMetric(candidate));
      }
      if (humanReviewCandidate && (category.value === "Other" || pageType.value === "Other" || character.value === "Uncertain")) {
        boundedInsert(laneBuckets.get("Low classification confidence") as RankedCandidate[], candidate, observation.screenTimeMs);
      }
      if (humanReviewCandidate && (character.value === "Uncertain" || character.confidence < 0.5)) {
        boundedInsert(laneBuckets.get("Exposure or character borderline") as RankedCandidate[], candidate, scores.balanced);
      }
      boundedInsert(laneBuckets.get("Random control") as RankedCandidate[], candidate, hash(`control:${page.canonicalUrl}`) / 0xffffffff, LANE_LIMIT, 1);
      if (lowTrust) {
        boundedInsert(
          laneBuckets.get("Low-trust diagnostic") as RankedCandidate[],
          candidate,
          observation.screenTimeMs,
          LOW_TRUST_LANE_LIMIT,
          DIAGNOSTIC_DOMAIN_CAP,
        );
      }
    }

    const selected = new Map<string, EvaluationCandidate>();
    const selectedDomainCounts = new Map<string, number>();
    for (const [lane, rows] of laneBuckets) {
      for (const row of rows) {
        const existing = selected.get(row.candidate.id);
        if (!existing) {
          const domainCap = isMajorPlatform(row.candidate.domain) || isLowTrustPromotionDomain(row.candidate.domain)
            ? DIAGNOSTIC_DOMAIN_CAP
            : DEFAULT_DOMAIN_CAP;
          const selectedCount = selectedDomainCounts.get(row.candidate.domain) ?? 0;
          if (selectedCount >= domainCap) continue;
          selectedDomainCounts.set(row.candidate.domain, selectedCount + 1);
        }
        const candidate = existing ?? row.candidate;
        if (!candidate.lanes.includes(lane)) candidate.lanes.push(lane);
        selected.set(candidate.id, candidate);
      }
    }
    const candidates = [...selected.values()].sort((first, second) => second.scores.balanced - first.scores.balanced || first.id.localeCompare(second.id));
    const lanes = SAMPLE_LANES.map((lane) => {
      const matching = candidates.filter((candidate) => candidate.lanes.includes(lane));
      return {
        lane,
        candidates: matching.length,
        promote: matching.filter((candidate) => candidate.initialJudgment.value === "Promote").length,
        doNotPromote: matching.filter((candidate) => candidate.initialJudgment.value === "Do not promote").length,
        uncertain: matching.filter((candidate) => candidate.initialJudgment.value === "Uncertain").length,
      };
    });
    const formulas = [...formulaBuckets.entries()].map(([formula, rows]) => ({
      formula,
      promotedInTop50: rows.filter((row) => row.candidate.initialJudgment.value === "Promote").length,
      doNotPromoteInTop50: rows.filter((row) => row.candidate.initialJudgment.value === "Do not promote").length,
      uncertainInTop50: rows.filter((row) => row.candidate.initialJudgment.value === "Uncertain").length,
      uniqueDomainsInTop50: new Set(rows.map((row) => row.candidate.domain)).size,
      mainstreamShare: rows.length === 0 ? 0 : rows.filter((row) => isMajorPlatform(row.candidate.domain)).length / rows.length,
    }));
    const exposureTotal = publicPages.size + (this.pages.size - publicPages.size);
    const coverage = [
      coverageRow("Content category", categoryCoverage),
      coverageRow("Page type", pageTypeCoverage),
      {
        dimension: "Exposure" as const,
        classified: exposureTotal,
        uncertain: 0,
        total: exposureTotal,
        averageConfidence: 0.92,
      },
      coverageRow("Character", characterCoverage),
    ];
    const enrichmentRows = candidates.map((candidate) => candidate.external);

    return {
      version: 2,
      summary: {
        generatedAt: new Date().toISOString(),
        sourceArchive,
        startDate: new Date(this.startTs).toISOString(),
        endDate: new Date(this.endTs).toISOString(),
        navigationEvents: this.navigationEvents,
        focusVisits: this.focusVisits,
        participants: this.participantIds.size,
        domains: this.domains.size,
        publicPages: publicPages.size,
        publicVisits,
        privateVisits,
        excludedVisits: this.excludedVisits,
        pairedScreenTimeMs: this.pairedScreenTimeMs,
        outOfOrderEvents: this.outOfOrderEvents,
        parseFailures: scan.parseFailures,
        metadataPages: this.metadataByRef.size,
        metadataCoverage: publicPages.size === 0 ? 0 : [...publicPages.values()].filter((page) => Boolean(this.metadataByRef.get(page.pageRef)?.title || page.title)).length / publicPages.size,
        candidates: candidates.length,
        enrichmentRequests: enrichmentRows.filter((row) => row.status !== "not-requested").length,
        enrichmentAvailable: enrichmentRows.filter((row) => row.status === "available").length,
        enrichmentFailed: enrichmentRows.filter((row) => row.status === "failed").length,
      },
      coverage,
      lanes,
      formulas,
      candidates,
      notes: [
        "The candidate sample is stratified for evaluation. It is not a feed and it is not representative of overall browsing volume.",
        "Public means the current commute policy produced a sanitized destination. It is an eligibility decision, not proof that a page is safe or worthwhile.",
        "Page rarity and domain rarity are separate. A rare item on YouTube can rank without treating YouTube itself as obscure.",
        "Human-made and automated character labels remain uncertain when URL, title, and metadata do not support a defensible judgment.",
        "Initial judgments are bootstrap labels. Manual corrections in the workbench are the evaluation ground truth.",
        `The full classifier covers ${CONTENT_CATEGORIES.length} content categories and ${PAGE_TYPES.length} page types.`,
      ],
    };
  }
}
