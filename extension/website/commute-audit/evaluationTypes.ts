// ABOUTME: Defines the page evidence, labels, scores, and samples used by the commute evaluation workbench.
// ABOUTME: Keeps observed behavior separate from classifications, judgments, and outside enrichment.

export const CONTENT_CATEGORIES = [
  "Arts & culture",
  "Entertainment",
  "Games",
  "Learning & reference",
  "News & current events",
  "Science & nature",
  "Technology",
  "Work & productivity",
  "Social & community",
  "Shopping & commerce",
  "Travel & places",
  "Food & drink",
  "Health & wellness",
  "Sports",
  "Finance",
  "Government & civic",
  "Other",
] as const;

export const PAGE_TYPES = [
  "Article or essay",
  "Video",
  "Audio or music",
  "Image or gallery",
  "Project or creation",
  "Tool or app",
  "Reference or documentation",
  "Discussion or forum",
  "Social post",
  "Profile or channel",
  "Product or listing",
  "Organization or homepage",
  "Event or place",
  "Feed or index",
  "Search",
  "Account or private workflow",
  "Other",
] as const;

export const EXPOSURE_LABELS = ["Public", "Private or sensitive", "Uncertain"] as const;
export const CHARACTER_LABELS = ["Human-made", "Platform-mediated or mixed", "Automated or SEO-forward", "Uncertain"] as const;
export const PROMOTION_JUDGMENTS = ["Promote", "Do not promote", "Uncertain"] as const;
export const SAMPLE_LANES = [
  "Rare page on rare domain",
  "Hidden item on major platform",
  "Independent convergence",
  "High attention",
  "Current ranking",
  "Low classification confidence",
  "Exposure or character borderline",
  "Random control",
] as const;

export type ContentCategory = (typeof CONTENT_CATEGORIES)[number];
export type PageType = (typeof PAGE_TYPES)[number];
export type ExposureLabel = (typeof EXPOSURE_LABELS)[number];
export type CharacterLabel = (typeof CHARACTER_LABELS)[number];
export type PromotionJudgment = (typeof PROMOTION_JUDGMENTS)[number];
export type SampleLane = (typeof SAMPLE_LANES)[number];
export type EvidenceSource = "url-rule" | "commute-policy" | "cohort" | "stored-metadata" | "public-metadata" | "platform-metadata" | "initial-judgment" | "manual";

export interface EvidenceLabel<T extends string> {
  value: T;
  confidence: number;
  source: EvidenceSource;
  reasons: string[];
  checkedAt?: string;
}

export interface PageObservation {
  visits: number;
  participants: number;
  sessions: number;
  screenTimeMs: number;
  firstSeen: string;
  lastSeen: string;
  domainParticipants: number;
  domainVisits: number;
  domainScreenTimeMs: number;
}

export interface ExternalEvidence {
  status: "not-requested" | "available" | "unavailable" | "failed";
  checkedAt?: string;
  finalUrl?: string;
  title?: string;
  description?: string;
  author?: string;
  publishedAt?: string;
  viewCount?: number;
  likeCount?: number;
  contentType?: string;
  source?: "open-graph" | "json-ld" | "youtube-page" | "http";
  error?: string;
}

export interface ScoreComponents {
  pageRarity: number;
  domainRarity: number;
  externalRarity: number | null;
  attentionQuality: number;
  convergence: number;
  specificity: number;
  humanConfidence: number;
  evidenceConfidence: number;
  freshness: number;
  manipulationPenalty: number;
}

export interface FormulaScores {
  balanced: number;
  longTail: number;
  hiddenPlatform: number;
  humanWeb: number;
}

export interface EvaluationCandidate {
  id: string;
  url: string;
  title: string;
  domain: string;
  lanes: SampleLane[];
  observation: PageObservation;
  category: EvidenceLabel<ContentCategory>;
  pageType: EvidenceLabel<PageType>;
  exposure: EvidenceLabel<ExposureLabel>;
  character: EvidenceLabel<CharacterLabel>;
  initialJudgment: EvidenceLabel<PromotionJudgment>;
  external: ExternalEvidence;
  components: ScoreComponents;
  scores: FormulaScores;
  reasons: string[];
}

export interface CoverageRow {
  dimension: "Content category" | "Page type" | "Exposure" | "Character";
  classified: number;
  uncertain: number;
  total: number;
  averageConfidence: number;
}

export interface SampleLaneSummary {
  lane: SampleLane;
  candidates: number;
  promote: number;
  doNotPromote: number;
  uncertain: number;
}

export interface FormulaSummary {
  formula: keyof FormulaScores;
  promotedInTop50: number;
  doNotPromoteInTop50: number;
  uncertainInTop50: number;
  uniqueDomainsInTop50: number;
  mainstreamShare: number;
}

export interface EvaluationSummary {
  generatedAt: string;
  sourceArchive: string;
  startDate: string;
  endDate: string;
  navigationEvents: number;
  focusVisits: number;
  participants: number;
  domains: number;
  publicPages: number;
  publicVisits: number;
  privateVisits: number;
  excludedVisits: number;
  pairedScreenTimeMs: number;
  outOfOrderEvents: number;
  parseFailures: number;
  metadataPages: number;
  metadataCoverage: number;
  candidates: number;
  enrichmentRequests: number;
  enrichmentAvailable: number;
  enrichmentFailed: number;
}

export interface CommuteEvaluationData {
  version: 2;
  summary: EvaluationSummary;
  coverage: CoverageRow[];
  lanes: SampleLaneSummary[];
  formulas: FormulaSummary[];
  candidates: EvaluationCandidate[];
  notes: string[];
}
