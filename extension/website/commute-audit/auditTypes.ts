// ABOUTME: Defines the policy-reduced aggregate consumed by the commute audit dashboard.
// ABOUTME: Keeps raw participant identifiers and private URLs out of the generated artifact.

export const AUDIT_CATEGORIES = [
  "Arts & culture",
  "Games",
  "Learning & reference",
  "News & current events",
  "Shopping",
  "Social & community",
  "Technology",
  "Travel & places",
  "Video & audio",
  "Work & tools",
  "Other",
] as const;

export type AuditCategory = (typeof AUDIT_CATEGORIES)[number];
export type ReachTier = "Solo" | "Shared" | "Common";

export interface AuditSummary {
  generatedAt: string;
  startDate: string;
  endDate: string;
  navigationEvents: number;
  focusVisits: number;
  participants: number;
  domains: number;
  pages: number;
  pairedScreenTimeMs: number;
  publicVisits: number;
  privateVisits: number;
  excludedVisits: number;
}

export interface CategoryAggregate {
  category: AuditCategory;
  visits: number;
  screenTimeMs: number;
  participants: number;
  domains: number;
  publicVisits: number;
}

export interface ReachAggregate {
  tier: ReachTier;
  domains: number;
  visits: number;
  screenTimeMs: number;
  participants: number;
}

export interface WeeklyAggregate {
  week: string;
  visits: number;
  screenTimeMs: number;
  participants: number;
  categories: Partial<Record<AuditCategory, number>>;
}

export interface RankedPage {
  rank: number;
  score: number;
  url: string;
  title: string;
  domain: string;
  category: AuditCategory;
  reach: ReachTier;
  visits: number;
  participants: number;
  screenTimeMs: number;
  reasons: string[];
}

export interface DomainAggregate {
  domain: string;
  category: AuditCategory;
  reach: ReachTier;
  visits: number;
  participants: number;
  screenTimeMs: number;
  publicVisits: number;
  privateVisits: number;
}

export interface OverlapCell {
  first: AuditCategory;
  second: AuditCategory;
  participants: number;
}

export interface TransitionAggregate {
  from: AuditCategory;
  to: AuditCategory;
  count: number;
}

export interface CommuteAuditData {
  summary: AuditSummary;
  categories: CategoryAggregate[];
  reach: ReachAggregate[];
  weeks: WeeklyAggregate[];
  rankedPages: RankedPage[];
  domains: DomainAggregate[];
  overlap: OverlapCell[];
  transitions: TransitionAggregate[];
  notes: string[];
}
