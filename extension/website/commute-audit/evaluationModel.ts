// ABOUTME: Classifies commute candidates and computes explainable hidden-gem promotion scores.
// ABOUTME: Uses deterministic URL, title, cohort, and enrichment evidence while preserving uncertainty.

import { getDomain } from "tldts";

import {
  type CharacterLabel,
  type ContentCategory,
  type EvidenceLabel,
  type EvaluationCandidate,
  type ExposureLabel,
  type ExternalEvidence,
  type FormulaScores,
  type PageObservation,
  type PageType,
  type PromotionJudgment,
  type ScoreComponents,
} from "./evaluationTypes";

const MAJOR_PLATFORM_DOMAINS = new Set([
  "bandcamp.com",
  "github.com",
  "instagram.com",
  "medium.com",
  "reddit.com",
  "soundcloud.com",
  "substack.com",
  "tumblr.com",
  "vimeo.com",
  "wikipedia.org",
  "youtube.com",
]);

const PLATFORM_MEDIATED_DOMAINS = new Set([
  ...MAJOR_PLATFORM_DOMAINS,
  "bsky.app",
  "facebook.com",
  "letterboxd.com",
  "linkedin.com",
  "tiktok.com",
  "twitch.tv",
  "x.com",
]);

const LOW_TRUST_PROMOTION_DOMAINS = new Set([
  "1shows.org",
  "1337x.pro",
  "456movie.nl",
  "actvid.art",
  "cineby.at",
  "cineby.sc",
  "fmovies24.one",
  "heartivetv.pages.dev",
  "miraculous.to",
  "miruro.tv",
  "nepu.to",
  "new-fmovies.cam",
  "onhockey.tv",
  "romsfun.com",
  "timstreams.st",
  "watchseries.bar",
]);

interface CategoryRule {
  value: ContentCategory;
  domains?: string[];
  terms: string[];
}

const CATEGORY_RULES: CategoryRule[] = [
  { value: "Arts & culture", domains: ["artforum.com", "artsy.net", "criterion.com", "letterboxd.com", "moma.org", "museum", "poetryfoundation.org"], terms: [" art ", "artist", "architecture", "cinema", "design", "exhibition", "film", "literature", "museum", "painting", "poetry", "sculpture", "theater"] },
  { value: "Entertainment", domains: ["imdb.com", "netflix.com", "rottentomatoes.com"], terms: ["celebrity", "comedy", "episode", "movie", "show", "television", "trailer"] },
  { value: "Games", domains: ["itch.io", "roblox.com", "steampowered.com"], terms: ["game", "gaming", "playthrough", "steam"] },
  { value: "Learning & reference", domains: ["archive.org", "britannica.com", "coursera.org", "jstor.org", "wikipedia.org"], terms: ["archive", "course", "dictionary", "encyclopedia", "history of", "research", "tutorial", "wiki"] },
  { value: "News & current events", domains: ["apnews.com", "bbc.com", "cnn.com", "nytimes.com", "reuters.com", "theguardian.com", "washingtonpost.com"], terms: ["breaking news", "election", "newsletter", "politics", "world news"] },
  { value: "Science & nature", domains: ["arxiv.org", "nature.com", "nasa.gov", "sciencedirect.com", "science.org"], terms: ["biology", "climate", "ecology", "physics", "science", "species"] },
  { value: "Technology", domains: ["github.com", "github.io", "news.ycombinator.com", "npmjs.com", "stackoverflow.com"], terms: [" api ", "code", "developer", "github", "javascript", "programming", "software"] },
  { value: "Work & productivity", domains: ["airtable.com", "calendar.google.com", "docs.google.com", "figma.com", "notion.so", "slack.com"], terms: ["calendar", "dashboard", "document", "meeting", "project management", "workspace"] },
  { value: "Social & community", domains: ["bsky.app", "discord.com", "facebook.com", "instagram.com", "linkedin.com", "reddit.com", "x.com"], terms: ["community", "forum", "profile", "social"] },
  { value: "Shopping & commerce", domains: ["amazon.com", "ebay.com", "etsy.com", "shopify.com", "target.com", "walmart.com"], terms: ["buy", "cart", "price", "product", "shop", "store"] },
  { value: "Travel & places", domains: ["airbnb.com", "atlasobscura.com", "maps.google.com", "tripadvisor.com"], terms: ["flight", "hotel", "map", "travel", "trip"] },
  { value: "Food & drink", domains: ["allrecipes.com", "bonappetit.com", "doordash.com", "seriouseats.com"], terms: ["cooking", "food", "recipe", "restaurant"] },
  { value: "Health & wellness", domains: ["mayoclinic.org", "nih.gov", "webmd.com"], terms: ["fitness", "health", "medical", "medicine", "mental health", "wellness"] },
  { value: "Sports", domains: ["espn.com", "nba.com", "nfl.com"], terms: ["baseball", "basketball", "football", "soccer", "sports"] },
  { value: "Finance", domains: ["bloomberg.com", "coinbase.com", "investopedia.com", "robinhood.com"], terms: ["banking", "finance", "investing", "market", "stock"] },
  { value: "Government & civic", domains: [".gov", "congress.gov", "usa.gov"], terms: ["civic", "government", "legislation", "public records"] },
];

function normalizedDomain(url: URL): string {
  const hostname = url.hostname.toLowerCase().replace(/^www\./, "");
  return getDomain(hostname, { allowPrivateDomains: true }) ?? hostname;
}

function domainMatches(domain: string, candidate: string): boolean {
  if (candidate.startsWith(".")) return domain.endsWith(candidate);
  return domain === candidate || domain.endsWith(`.${candidate}`);
}

function parseUrl(rawUrl: string): URL | null {
  try {
    return new URL(rawUrl);
  } catch {
    return null;
  }
}

function label<T extends string>(value: T, confidence: number, reasons: string[]): EvidenceLabel<T> {
  return { value, confidence, source: "url-rule", reasons };
}

export function classifyContent(rawUrl: string, title: string): EvidenceLabel<ContentCategory> {
  const url = parseUrl(rawUrl);
  if (!url) return label("Other", 0, ["URL could not be parsed"]);
  const domain = normalizedDomain(url);
  const haystack = ` ${domain} ${url.pathname} ${url.search} ${title} `.toLowerCase();

  for (const rule of CATEGORY_RULES) {
    const domainReason = rule.domains?.find((candidate) => domainMatches(domain, candidate));
    if (domainReason) return label(rule.value, 0.9, [`known ${rule.value.toLowerCase()} domain: ${domainReason}`]);
    const termReason = rule.terms.find((term) => haystack.includes(term));
    if (termReason) return label(rule.value, 0.62, [`page context contains “${termReason.trim()}”`]);
  }

  return label("Other", 0.18, ["no deterministic content rule matched"]);
}

export function classifyPageType(rawUrl: string, title: string): EvidenceLabel<PageType> {
  const url = parseUrl(rawUrl);
  if (!url) return label("Other", 0, ["URL could not be parsed"]);
  const domain = normalizedDomain(url);
  const path = url.pathname.toLowerCase();
  const haystack = `${path} ${url.search} ${title}`.toLowerCase();
  const segments = path.split("/").filter(Boolean);

  if (/\b(search|results?)\b/.test(haystack) || url.searchParams.has("q")) return label("Search", 0.88, ["search route or query parameter"]);
  if (/\b(account|admin|board|dashboard|inbox|login|settings|workspace)\b/.test(haystack)) return label("Account or private workflow", 0.82, ["account or workspace route"]);
  if ((domain === "youtube.com" && url.searchParams.has("v")) || (domain === "vimeo.com" && /^\/\d+/.test(path))) return label("Video", 0.98, ["platform video identifier"]);
  if (domain === "soundcloud.com" || domain === "bandcamp.com" || /\b(album|episode|podcast|track)\b/.test(haystack)) return label("Audio or music", 0.88, ["audio platform or media route"]);
  if (/\b(gallery|photos?|images?)\b/.test(haystack)) return label("Image or gallery", 0.72, ["gallery or image route"]);
  if ((domain === "reddit.com" && /\/comments\//.test(path)) || /\b(discussion|forum|thread)\b/.test(haystack)) return label("Discussion or forum", 0.86, ["discussion route"]);
  if (["bsky.app", "instagram.com", "x.com"].includes(domain) && segments.length >= 2) return label("Social post", 0.8, ["social platform item route"]);
  if (/\b(author|channel|profile|user|users)\b/.test(haystack)) return label("Profile or channel", 0.73, ["profile or channel route"]);
  if (/\b(product|products|listing|listings|item|items)\b/.test(haystack)) return label("Product or listing", 0.78, ["product or listing route"]);
  if (/\b(docs?|documentation|reference|wiki)\b/.test(haystack) || domain === "wikipedia.org") return label("Reference or documentation", 0.82, ["documentation or reference route"]);
  if (/\b(event|events|venue|place|places)\b/.test(haystack)) return label("Event or place", 0.68, ["event or place route"]);
  if (/\b(feed|browse|explore|latest|popular|topics?)\b/.test(haystack)) return label("Feed or index", 0.65, ["feed or index route"]);
  if (/\b(project|portfolio|work)\b/.test(haystack) || domain.endsWith("github.io")) return label("Project or creation", 0.66, ["project or creation context"]);
  if (/\b(app|editor|generator|studio|tool)\b/.test(haystack)) return label("Tool or app", 0.64, ["interactive tool context"]);
  if (/\b(article|blog|essay|news|post|story)\b/.test(haystack) || (segments.length >= 2 && title.length >= 12)) return label("Article or essay", 0.58, ["specific titled content page"]);
  if (segments.length === 0 || (segments.length === 1 && /^(home|index)?$/.test(segments[0] ?? ""))) return label("Organization or homepage", 0.72, ["root or homepage route"]);
  return label("Other", 0.22, ["no deterministic page-type rule matched"]);
}

export function classifyCharacter(rawUrl: string, title: string, external: ExternalEvidence = { status: "not-requested" }): EvidenceLabel<CharacterLabel> {
  const url = parseUrl(rawUrl);
  if (!url) return label("Uncertain", 0, ["URL could not be parsed"]);
  const domain = normalizedDomain(url);
  const haystack = `${domain} ${url.pathname} ${title}`.toLowerCase();

  if (PLATFORM_MEDIATED_DOMAINS.has(domain)) return label("Platform-mediated or mixed", 0.86, ["large user-content platform"]);
  if (/\b(ai generated|ai-generated|content farm|programmatic seo)\b/.test(haystack)) return label("Automated or SEO-forward", 0.75, ["page context explicitly signals generated or programmatic content"]);
  if (external.author) return { value: "Human-made", confidence: 0.72, source: "public-metadata", reasons: [`public metadata names an author: ${external.author}`], checkedAt: external.checkedAt };
  if (domain === "substack.com" || domain === "wordpress.com" || domain === "neocities.org" || domain === "itch.io") return label("Human-made", 0.68, ["creator publishing platform"]);
  if (/\b(personal|portfolio|zine|essay|artist)\b/.test(haystack)) return label("Human-made", 0.58, ["page context signals individual authorship"]);
  return label("Uncertain", 0.2, ["authorship cannot be inferred from URL and title"]);
}

export function exposureLabel(isPublic: boolean): EvidenceLabel<ExposureLabel> {
  return {
    value: isPublic ? "Public" : "Private or sensitive",
    confidence: 0.92,
    source: "commute-policy",
    reasons: [isPublic ? "current commute policy produced a sanitized destination" : "current commute policy withheld the page URL"],
  };
}

function clamp(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function recencyScore(lastSeen: string): number {
  const ageDays = Math.max(0, (Date.now() - Date.parse(lastSeen)) / 86_400_000);
  return clamp(1 - ageDays / 365);
}

export function scoreComponents(
  rawUrl: string,
  observation: PageObservation,
  category: EvidenceLabel<ContentCategory>,
  pageType: EvidenceLabel<PageType>,
  character: EvidenceLabel<CharacterLabel>,
  external: ExternalEvidence,
): ScoreComponents {
  const url = parseUrl(rawUrl);
  const depth = url?.pathname.split("/").filter(Boolean).length ?? 0;
  const externalRarity = external.viewCount === undefined
    ? null
    : clamp(1 - Math.log10(Math.max(1, external.viewCount)) / 8);
  const medianVisitMs = observation.visits > 0 ? observation.screenTimeMs / observation.visits : 0;
  const humanConfidence = character.value === "Human-made" ? character.confidence : character.value === "Platform-mediated or mixed" ? 0.45 : 0.15;
  const manipulationPenalty = character.value === "Automated or SEO-forward" ? character.confidence : 0;

  return {
    pageRarity: clamp(1 - Math.log1p(observation.participants) / Math.log(50)),
    domainRarity: clamp(1 - Math.log1p(observation.domainParticipants) / Math.log(200)),
    externalRarity,
    attentionQuality: clamp(Math.log1p(medianVisitMs / 1_000) / Math.log(900)),
    convergence: observation.participants >= 2 && observation.participants <= 4 ? 1 : observation.participants === 1 ? 0.35 : clamp(1 - observation.participants / 40),
    specificity: clamp(depth / 3),
    humanConfidence,
    evidenceConfidence: (category.confidence + pageType.confidence + character.confidence) / 3,
    freshness: recencyScore(observation.lastSeen),
    manipulationPenalty,
  };
}

function weightedScore(components: ScoreComponents, weights: Omit<ScoreComponents, "externalRarity"> & { externalRarity: number }): number {
  const external = components.externalRarity ?? 0.5;
  const positive =
    components.pageRarity * weights.pageRarity +
    components.domainRarity * weights.domainRarity +
    external * weights.externalRarity +
    components.attentionQuality * weights.attentionQuality +
    components.convergence * weights.convergence +
    components.specificity * weights.specificity +
    components.humanConfidence * weights.humanConfidence +
    components.evidenceConfidence * weights.evidenceConfidence +
    components.freshness * weights.freshness;
  const totalWeight = Object.values(weights).reduce((sum, weight) => sum + weight, 0);
  return Math.round(100 * clamp(positive / totalWeight - components.manipulationPenalty * 0.5));
}

export function formulaScores(components: ScoreComponents): FormulaScores {
  return {
    balanced: weightedScore(components, { pageRarity: 2, domainRarity: 1.5, externalRarity: 1, attentionQuality: 1.5, convergence: 1.5, specificity: 1, humanConfidence: 1, evidenceConfidence: 1, freshness: 0.5, manipulationPenalty: 0 }),
    longTail: weightedScore(components, { pageRarity: 2.5, domainRarity: 2.5, externalRarity: 0.5, attentionQuality: 1, convergence: 1.5, specificity: 1, humanConfidence: 1, evidenceConfidence: 0.5, freshness: 0.5, manipulationPenalty: 0 }),
    hiddenPlatform: weightedScore(components, { pageRarity: 2, domainRarity: 0.25, externalRarity: 2.5, attentionQuality: 1.25, convergence: 1, specificity: 1.5, humanConfidence: 0.75, evidenceConfidence: 1, freshness: 0.75, manipulationPenalty: 0 }),
    humanWeb: weightedScore(components, { pageRarity: 1.5, domainRarity: 1.5, externalRarity: 0.5, attentionQuality: 1.25, convergence: 1.5, specificity: 1, humanConfidence: 2.5, evidenceConfidence: 1, freshness: 0.5, manipulationPenalty: 0 }),
  };
}

export function initialJudgment(candidate: Omit<EvaluationCandidate, "initialJudgment" | "reasons">): EvidenceLabel<PromotionJudgment> {
  if (candidate.exposure.value !== "Public") {
    return { value: "Do not promote", confidence: 0.98, source: "initial-judgment", reasons: ["page is not policy-public"] };
  }
  if (["Account or private workflow", "Search", "Feed or index", "Product or listing"].includes(candidate.pageType.value)) {
    return { value: "Do not promote", confidence: 0.88, source: "initial-judgment", reasons: [`${candidate.pageType.value.toLowerCase()} is not a destination`] };
  }
  if (LOW_TRUST_PROMOTION_DOMAINS.has(candidate.domain)) {
    return { value: "Do not promote", confidence: 0.82, source: "initial-judgment", reasons: ["domain is not suitable for proactive promotion without stronger provenance evidence"] };
  }
  if (/\b(page not found|review and pay|student application|assessment task|job opportunities|mod apk|torrents?|rom & iso)\b/i.test(candidate.title)) {
    return { value: "Do not promote", confidence: 0.84, source: "initial-judgment", reasons: ["title signals an unavailable, transactional, or assigned workflow"] };
  }
  if (/\b(application web|course and fees|mobile phones? - shop)\b/i.test(candidate.title)) {
    return { value: "Do not promote", confidence: 0.76, source: "initial-judgment", reasons: ["title signals a transactional workflow rather than a discovery destination"] };
  }
  if (/^www\.[a-z0-9.-]+$/i.test(candidate.title.trim())) {
    return { value: "Uncertain", confidence: 0.7, source: "initial-judgment", reasons: ["generic domain title does not identify a specific destination"] };
  }
  if (candidate.external.status === "unavailable") {
    return { value: "Do not promote", confidence: 0.86, source: "initial-judgment", reasons: ["public enrichment reports the page unavailable"] };
  }
  if (candidate.character.value === "Automated or SEO-forward" && candidate.character.confidence >= 0.65) {
    return { value: "Do not promote", confidence: 0.78, source: "initial-judgment", reasons: ["strong automated or SEO-forward signal"] };
  }
  if (isMajorPlatform(candidate.domain) && candidate.external.viewCount === undefined) {
    return { value: "Uncertain", confidence: 0.72, source: "initial-judgment", reasons: ["item rarity cannot be inferred from the popularity of its hosting platform"] };
  }
  const bestScore = Math.max(...Object.values(candidate.scores));
  const promotablePageType = ["Article or essay", "Video", "Audio or music", "Image or gallery", "Project or creation", "Tool or app", "Reference or documentation", "Discussion or forum", "Social post", "Event or place"].includes(candidate.pageType.value);
  if (promotablePageType && bestScore >= 64 && candidate.components.specificity >= 0.5 && candidate.observation.screenTimeMs >= 60_000) {
    return { value: "Promote", confidence: Math.min(0.82, bestScore / 100), source: "initial-judgment", reasons: ["specific page with strong rarity and attention evidence"] };
  }
  if (bestScore < 35 || candidate.observation.screenTimeMs === 0) {
    return { value: "Do not promote", confidence: 0.62, source: "initial-judgment", reasons: ["weak attention or discovery evidence"] };
  }
  return { value: "Uncertain", confidence: 0.45, source: "initial-judgment", reasons: ["available evidence does not support a confident promotion decision"] };
}

export function isMajorPlatform(domain: string): boolean {
  return MAJOR_PLATFORM_DOMAINS.has(domain);
}

export function isLowTrustPromotionDomain(domain: string): boolean {
  return LOW_TRUST_PROMOTION_DOMAINS.has(domain);
}
