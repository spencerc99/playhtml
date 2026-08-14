// ABOUTME: Reduces production navigation events into policy-classified browsing aggregates.
// ABOUTME: Applies the current commute policy, deterministic categories, and explainable ranking.

import type { CollectionEvent } from "@playhtml/extension-types";
import { getDomain } from "tldts";

import { buildCommuteResponse } from "../../worker/src/routes/commutePolicy";
import {
  AUDIT_CATEGORIES,
  type AuditCategory,
  type CategoryAggregate,
  type CommuteAuditData,
  type DomainAggregate,
  type OverlapCell,
  type RankedPage,
  type ReachAggregate,
  type ReachTier,
  type TransitionAggregate,
  type WeeklyAggregate,
} from "./auditTypes";

const MIN_SCREEN_TIME_MS = 1_000;
const MAX_SCREEN_TIME_MS = 8 * 60 * 60 * 1_000;

const CATEGORY_RULES: Array<{
  category: AuditCategory;
  domains: string[];
  terms: string[];
}> = [
  { category: "Arts & culture", domains: ["artforum.com", "artsy.net", "letterboxd.com", "moma.org", "museum", "tumblr.com"], terms: ["art", "artist", "cinema", "design", "film", "literature", "museum", "poetry"] },
  { category: "Games", domains: ["itch.io", "roblox.com", "steampowered.com", "twitch.tv"], terms: ["game", "gaming", "playthrough", "steam"] },
  { category: "Learning & reference", domains: ["archive.org", "britannica.com", "coursera.org", "jstor.org", "wikipedia.org"], terms: ["archive", "course", "dictionary", "encyclopedia", "history of", "research", "tutorial", "wiki"] },
  { category: "News & current events", domains: ["apnews.com", "bbc.com", "cnn.com", "nytimes.com", "reuters.com", "theguardian.com", "washingtonpost.com"], terms: ["breaking news", "election", "newsletter", "politics", "world news"] },
  { category: "Shopping", domains: ["amazon.com", "ebay.com", "etsy.com", "shopify.com", "target.com", "walmart.com"], terms: ["buy", "cart", "price", "product", "shop", "store"] },
  { category: "Social & community", domains: ["bsky.app", "discord.com", "facebook.com", "instagram.com", "linkedin.com", "reddit.com", "x.com"], terms: ["community", "forum", "profile", "social"] },
  { category: "Technology", domains: ["github.com", "github.io", "hackernews", "npmjs.com", "stackoverflow.com", "vercel.app"], terms: ["api", "code", "developer", "github", "javascript", "programming", "software"] },
  { category: "Travel & places", domains: ["airbnb.com", "atlasobscura.com", "maps.google.com", "tripadvisor.com"], terms: ["flight", "hotel", "map", "travel", "trip"] },
  { category: "Video & audio", domains: ["bandcamp.com", "netflix.com", "soundcloud.com", "spotify.com", "vimeo.com", "youtube.com"], terms: ["album", "listen", "music", "podcast", "video", "watch"] },
  { category: "Work & tools", domains: ["airtable.com", "calendar.google.com", "docs.google.com", "figma.com", "notion.so", "slack.com"], terms: ["calendar", "dashboard", "document", "meeting", "project", "workspace"] },
];

interface MutablePage {
  url: string;
  title: string;
  domain: string;
  category: AuditCategory;
  visits: number;
  screenTimeMs: number;
  participants: Set<string>;
}

interface MutableDomain {
  domain: string;
  categoryVisits: Map<AuditCategory, number>;
  visits: number;
  screenTimeMs: number;
  publicVisits: number;
  privateVisits: number;
  participants: Set<string>;
}

interface PendingFocus {
  ts: number;
  pageKey: string;
}

interface MutableWeek {
  visits: number;
  screenTimeMs: number;
  participants: Set<string>;
  categories: Map<AuditCategory, number>;
}

function domainMatches(domain: string, candidate: string): boolean {
  return domain === candidate || domain.endsWith(`.${candidate}`);
}

function eventTitle(event: CollectionEvent): string {
  const title = (event.data as Record<string, unknown>)?.title;
  return typeof title === "string" ? title.replace(/\s+/g, " ").trim() : "";
}

function getHostname(rawUrl: string): string | null {
  try {
    return new URL(rawUrl).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return null;
  }
}

export function categorizePage(rawUrl: string, title = ""): AuditCategory {
  const domain = getHostname(rawUrl) ?? "";
  const haystack = `${domain} ${rawUrl} ${title}`.toLowerCase();

  for (const rule of CATEGORY_RULES) {
    if (
      rule.domains.some((candidate) => domainMatches(domain, candidate) || domain.includes(candidate)) ||
      rule.terms.some((term) => haystack.includes(term))
    ) {
      return rule.category;
    }
  }
  return "Other";
}

function getPublicUrl(event: CollectionEvent): string | null {
  return buildCommuteResponse([event], [], event.ts).destinations[0]?.url ?? null;
}

function weekStart(timestamp: number): string {
  const date = new Date(timestamp);
  const day = date.getUTCDay();
  date.setUTCDate(date.getUTCDate() - ((day + 6) % 7));
  return date.toISOString().slice(0, 10);
}

function reachTier(participants: number): ReachTier {
  if (participants === 1) return "Solo";
  if (participants <= 4) return "Shared";
  return "Common";
}

function registrableDomain(hostname: string): string {
  return getDomain(hostname, { allowPrivateDomains: true }) ?? hostname;
}

function dominantCategory(categoryVisits: Map<AuditCategory, number>): AuditCategory {
  return [...categoryVisits.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "Other";
}

function formatReasonValue(value: number): string {
  return new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(value);
}

export class HistoryAuditBuilder {
  private navigationEvents = 0;
  private focusVisits = 0;
  private publicVisits = 0;
  private privateVisits = 0;
  private excludedVisits = 0;
  private pairedScreenTimeMs = 0;
  private readonly participants = new Set<string>();
  private readonly pages = new Map<string, MutablePage>();
  private readonly domains = new Map<string, MutableDomain>();
  private readonly pendingFocus = new Map<string, PendingFocus>();
  private readonly weeks = new Map<string, MutableWeek>();
  private readonly participantCategories = new Map<string, Set<AuditCategory>>();
  private readonly previousCategory = new Map<string, AuditCategory>();
  private readonly transitions = new Map<string, number>();
  private readonly publicUrlByPage = new Map<string, string | null>();

  addEvents(events: CollectionEvent[]): void {
    for (const event of events) {
      if (event.type !== "navigation") continue;
      this.navigationEvents++;

      const pid = event.meta?.pid;
      const sid = event.meta?.sid;
      const rawUrl = event.meta?.url;
      if (!pid || !sid || !rawUrl) {
        this.excludedVisits++;
        continue;
      }

      const hostname = getHostname(rawUrl);
      if (!hostname) {
        this.excludedVisits++;
        continue;
      }

      this.participants.add(pid);
      const data = event.data as Record<string, unknown>;
      const eventName = typeof data.event === "string" ? data.event : "";
      const sessionKey = `${pid}:${sid}`;

      if (eventName === "focus") {
        const title = eventTitle(event);
        const category = categorizePage(rawUrl, title);
        const policyKey = `${rawUrl}\u0000${title}`;
        let publicUrl = this.publicUrlByPage.get(policyKey);
        if (publicUrl === undefined) {
          publicUrl = getPublicUrl(event);
          this.publicUrlByPage.set(policyKey, publicUrl);
        }
        const domain = registrableDomain(hostname);
        const pageKey = publicUrl ?? `private:${domain}:${category}`;
        const page = this.pages.get(pageKey) ?? {
          url: publicUrl ?? "",
          title: publicUrl ? title : "Private or non-commutable activity",
          domain,
          category,
          visits: 0,
          screenTimeMs: 0,
          participants: new Set<string>(),
        };
        page.visits++;
        page.participants.add(pid);
        this.pages.set(pageKey, page);

        const domainRow = this.domains.get(domain) ?? {
          domain,
          categoryVisits: new Map<AuditCategory, number>(),
          visits: 0,
          screenTimeMs: 0,
          publicVisits: 0,
          privateVisits: 0,
          participants: new Set<string>(),
        };
        domainRow.visits++;
        domainRow.participants.add(pid);
        domainRow.categoryVisits.set(category, (domainRow.categoryVisits.get(category) ?? 0) + 1);
        if (publicUrl) {
          domainRow.publicVisits++;
          this.publicVisits++;
        } else {
          domainRow.privateVisits++;
          this.privateVisits++;
        }
        this.domains.set(domain, domainRow);

        const weekKey = weekStart(event.ts);
        const week = this.weeks.get(weekKey) ?? {
          visits: 0,
          screenTimeMs: 0,
          participants: new Set<string>(),
          categories: new Map<AuditCategory, number>(),
        };
        week.visits++;
        week.participants.add(pid);
        week.categories.set(category, (week.categories.get(category) ?? 0) + 1);
        this.weeks.set(weekKey, week);

        const categories = this.participantCategories.get(pid) ?? new Set<AuditCategory>();
        categories.add(category);
        this.participantCategories.set(pid, categories);

        const previous = this.previousCategory.get(sessionKey);
        if (previous && previous !== category) {
          const transitionKey = `${previous}\u0000${category}`;
          this.transitions.set(transitionKey, (this.transitions.get(transitionKey) ?? 0) + 1);
        }
        this.previousCategory.set(sessionKey, category);
        this.pendingFocus.set(sessionKey, { ts: event.ts, pageKey });
        this.focusVisits++;
        continue;
      }

      if (eventName === "blur" || eventName === "beforeunload") {
        const pending = this.pendingFocus.get(sessionKey);
        if (!pending) continue;
        const durationMs = event.ts - pending.ts;
        if (durationMs >= MIN_SCREEN_TIME_MS && durationMs <= MAX_SCREEN_TIME_MS) {
          const page = this.pages.get(pending.pageKey);
          if (page) {
            page.screenTimeMs += durationMs;
            const domain = this.domains.get(page.domain);
            if (domain) domain.screenTimeMs += durationMs;
            const week = this.weeks.get(weekStart(pending.ts));
            if (week) week.screenTimeMs += durationMs;
            this.pairedScreenTimeMs += durationMs;
          }
        }
        this.pendingFocus.delete(sessionKey);
      }
    }
  }

  finalize(startDate: string, endDate: string): CommuteAuditData {
    const domainRows: DomainAggregate[] = [...this.domains.values()].map((domain) => ({
      domain: domain.domain,
      category: dominantCategory(domain.categoryVisits),
      reach: reachTier(domain.participants.size),
      visits: domain.visits,
      participants: domain.participants.size,
      screenTimeMs: domain.screenTimeMs,
      publicVisits: domain.publicVisits,
      privateVisits: domain.privateVisits,
    })).sort((a, b) => b.screenTimeMs - a.screenTimeMs || b.visits - a.visits);

    const domainByName = new Map(domainRows.map((domain) => [domain.domain, domain]));
    const publicPages = [...this.pages.values()].filter((page) => page.url);
    const maxima = publicPages.reduce((current, page) => ({
      visits: Math.max(current.visits, page.visits),
      participants: Math.max(current.participants, page.participants.size),
      screenTimeMs: Math.max(current.screenTimeMs, page.screenTimeMs),
    }), { visits: 1, participants: 1, screenTimeMs: 1 });
    const rankedPages: RankedPage[] = publicPages.map((page) => {
      const url = new URL(page.url);
      const depth = url.pathname.split("/").filter(Boolean).length;
      const domain = domainByName.get(page.domain);
      const reach = domain?.reach ?? reachTier(page.participants.size);
      const dwell = Math.log1p(page.screenTimeMs) / Math.log1p(maxima.screenTimeMs);
      const people = Math.log1p(page.participants.size) / Math.log1p(maxima.participants);
      const repeats = Math.log1p(page.visits) / Math.log1p(maxima.visits);
      const specificity = Math.min(1, depth / 3);
      const titleQuality = page.title.length >= 8 ? 1 : 0.35;
      const discovery = reach === "Shared" ? 1 : reach === "Solo" ? 0.7 : 0.45;
      const score = Math.round(100 * (dwell * 0.25 + people * 0.2 + repeats * 0.15 + specificity * 0.15 + titleQuality * 0.1 + discovery * 0.15));
      const reasons = [
        `${formatReasonValue(page.screenTimeMs / 60_000)} min paired attention`,
        `${page.participants.size} ${page.participants.size === 1 ? "person" : "people"}`,
        depth >= 2 ? "specific page" : "browsable destination",
        reach === "Shared" ? "shared long-tail find" : `${reach.toLowerCase()} reach`,
      ];
      return {
        rank: 0,
        score,
        url: page.url,
        title: page.title || page.domain,
        domain: page.domain,
        category: page.category,
        reach,
        visits: page.visits,
        participants: page.participants.size,
        screenTimeMs: page.screenTimeMs,
        reasons,
      };
    }).sort((a, b) => b.score - a.score || b.screenTimeMs - a.screenTimeMs).slice(0, 250).map((page, index) => ({ ...page, rank: index + 1 }));

    const categories: CategoryAggregate[] = AUDIT_CATEGORIES.map((category) => {
      const matchingPages = [...this.pages.values()].filter((page) => page.category === category);
      const categoryParticipants = new Set<string>();
      for (const [pid, participantCategorySet] of this.participantCategories) {
        if (participantCategorySet.has(category)) categoryParticipants.add(pid);
      }
      return {
        category,
        visits: matchingPages.reduce((sum, page) => sum + page.visits, 0),
        screenTimeMs: matchingPages.reduce((sum, page) => sum + page.screenTimeMs, 0),
        participants: categoryParticipants.size,
        domains: new Set(matchingPages.map((page) => page.domain)).size,
        publicVisits: matchingPages.filter((page) => page.url).reduce((sum, page) => sum + page.visits, 0),
      };
    }).filter((category) => category.visits > 0).sort((a, b) => b.screenTimeMs - a.screenTimeMs || b.visits - a.visits);

    const tiers: ReachTier[] = ["Solo", "Shared", "Common"];
    const reach: ReachAggregate[] = tiers.map((tier) => {
      const matching = domainRows.filter((domain) => domain.reach === tier);
      const participantEstimate = matching.reduce(
        (maximum, domain) => Math.max(maximum, domain.participants),
        0,
      );
      return {
        tier,
        domains: matching.length,
        visits: matching.reduce((sum, domain) => sum + domain.visits, 0),
        screenTimeMs: matching.reduce((sum, domain) => sum + domain.screenTimeMs, 0),
        participants: participantEstimate,
      };
    });

    const weeks: WeeklyAggregate[] = [...this.weeks.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([week, value]) => ({
      week,
      visits: value.visits,
      screenTimeMs: value.screenTimeMs,
      participants: value.participants.size,
      categories: Object.fromEntries(value.categories) as Partial<Record<AuditCategory, number>>,
    }));

    const overlap: OverlapCell[] = [];
    const activeCategories = categories.map((category) => category.category);
    for (const first of activeCategories) {
      for (const second of activeCategories) {
        let participants = 0;
        for (const categorySet of this.participantCategories.values()) {
          if (categorySet.has(first) && categorySet.has(second)) participants++;
        }
        overlap.push({ first, second, participants });
      }
    }

    const transitions: TransitionAggregate[] = [...this.transitions.entries()].map(([key, count]) => {
      const [from, to] = key.split("\u0000") as [AuditCategory, AuditCategory];
      return { from, to, count };
    }).sort((a, b) => b.count - a.count).slice(0, 30);

    return {
      summary: {
        generatedAt: new Date().toISOString(),
        startDate,
        endDate,
        navigationEvents: this.navigationEvents,
        focusVisits: this.focusVisits,
        participants: this.participants.size,
        domains: domainRows.length,
        pages: publicPages.length,
        pairedScreenTimeMs: this.pairedScreenTimeMs,
        publicVisits: this.publicVisits,
        privateVisits: this.privateVisits,
        excludedVisits: this.excludedVisits,
      },
      categories,
      reach,
      weeks,
      rankedPages,
      domains: domainRows.slice(0, 1000),
      overlap,
      transitions,
      notes: [
        "Public means the current Internet Commute policy can produce a sanitized, clickable destination. Private means the visit contributes only a registrable domain and aggregate counts.",
        "Screen time uses focus-to-blur or focus-to-unload pairs between 1 second and 8 hours. Unpaired visits still count as visits but add no time.",
        "Solo, Shared, and Common describe observed reach in this extension cohort: 1 participant, 2–4 participants, and 5 or more participants. They do not estimate global site traffic.",
        "Categories use deterministic domain, URL, and title rules. Other is retained instead of guessing when no rule matches.",
        "The ranking is exploratory. It combines paired attention, repeat visits, participant overlap, page specificity, title quality, and a discovery bonus. Every score has visible evidence.",
        "Public is a policy classification, not proof that a page is safe or worthwhile. Candidate URLs need review before any public launch.",
      ],
    };
  }
}
