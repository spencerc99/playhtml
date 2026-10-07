// ABOUTME: The TypeSafe question set that turns one public page into typed judgments
// ABOUTME: about privacy, surface kind, and character, plus the shapes of Jev's answers.

export const PROMPT_VERSION = "jev-v3";

export const JEV_MODEL = "jev-1.13.0";

export type NoulQuestion = {
  type: "noul";
  instructions: string;
  criteria?: { true: string; false: string };
};

export type ChoiceQuestion = {
  type: "choice";
  instructions: string;
  criteria: Record<string, string>;
};

export type ScoreQuestion = {
  type: "score";
  instructions: string;
  criteria: string[];
};

export type Question = NoulQuestion | ChoiceQuestion | ScoreQuestion;

export type NoulAnswer = { type: "noul"; noul: number };

export type ChoiceAnswer = {
  type: "choice";
  choice: string;
  probabilities: Record<string, number>;
  confidence: number;
};

export type ScoreAnswer = {
  type: "score";
  score: number;
  legend: Record<string, string>;
  probabilities: Record<string, number>;
  confidence: number;
};

export type Answer = NoulAnswer | ChoiceAnswer | ScoreAnswer;

export type PlacementAnswers = {
  requires_login: NoulAnswer;
  person_bound: NoulAnswer;
  unsafe: NoulAnswer;
  surface_kind: ChoiceAnswer;
  stands_alone: NoulAnswer;
  human_community: NoulAnswer;
  maker: ChoiceAnswer;
  care: ScoreAnswer;
  selling: ScoreAnswer;
  mass_produced: NoulAnswer;
  reason: ChoiceAnswer;
};

export const SURFACE_KINDS = [
  "made_thing",
  "personal_home",
  "community_space",
  "feed_or_index",
  "utility_workflow",
  "marketing",
  "platform_home",
  "none_of_these",
] as const;

export type SurfaceKind = (typeof SURFACE_KINDS)[number];

export const MAKER_KINDS = [
  "individual",
  "small_group",
  "cultural_or_editorial_institution",
  "company",
  "large_platform_user_content",
  "cannot_tell",
] as const;

export type MakerKind = (typeof MAKER_KINDS)[number];

/**
 * The reason vocabulary stored on `place_policies.reason`, so a Jev answer drops
 * into the existing column without translation.
 */
export const INTERNET_PLACE_REASONS = [
  "authentication-required",
  "private-or-user-bound",
  "documentation-or-support",
  "jobs-or-recruiting",
  "generic-homepage",
  "business-or-product",
  "unsafe-or-low-quality",
  "human-community",
  "editorial-or-cultural",
  "standalone-tool",
  "inspection-error",
  "other",
] as const;

export type InternetPlaceReason = (typeof INTERNET_PLACE_REASONS)[number];

/**
 * Element tallies from a rendered page, so a model reading only text can still
 * tell that a page is carried by visuals or interaction rather than prose.
 */
export type PageStructure = {
  canvas: number;
  svg: number;
  img: number;
  video: number;
  audio: number;
  iframe: number;
  form: number;
  password_input: number;
  link: number;
  has_webgl_canvas: boolean;
  has_custom_cursor: boolean;
};

/**
 * The state shape sent as the `state` field of a TypeSafe request. Built only
 * from an anonymous fetch of the page, never from a rider's session.
 */
export type PageState = {
  page: {
    url: string;
    hostname: string;
    path: string;
    title: string | null;
    description: string | null;
    site_name: string | null;
    author: string | null;
    content_type: string | null;
    text_excerpt: string | null;
    /** Element tallies from the rendered DOM, present only for rendered pages. */
    structure?: PageStructure | null;
    /** Handmade-web markers found in the markup by code, named as plain facts. */
    handmade_signals?: string[];
  };
  inspection: {
    http_status: number | null;
    redirected_to_login: boolean;
    robots_noindex: boolean;
    has_password_field: boolean;
    fetched: boolean;
  };
};

/**
 * Jev reads instructions literally, so each question names the exact condition and
 * puts the boundary cases in the criteria rather than leaving them to inference.
 */
export const PLACEMENT_QUESTIONS: Record<string, Question> = {
  requires_login: {
    type: "noul",
    instructions:
      "Is the main content of the page unavailable to a visitor who is not signed in?",
    criteria: {
      true: "A sign-in form, login wall, paywall interstitial, or account prompt is the main thing shown on the page. The visitor cannot read the substance of the page without an account.",
      false:
        "The substance of the page is readable without an account. A sign-in link in a header or navigation bar, alongside readable content, counts as false.",
    },
  },
  person_bound: {
    type: "noul",
    instructions:
      "Does the page show one account holder's own data or workspace, rather than something published for the public?",
    criteria: {
      true: "An inbox, dashboard, settings screen, cart, order, draft, private document, direct messages, or admin panel belonging to one account holder.",
      false:
        "A page any visitor would see the same way. A public profile page that a person published about themselves counts as false.",
    },
  },
  unsafe: {
    type: "noul",
    instructions:
      "Is the page adult sexual content, gambling, pirated media, malware, hate speech, or illegal goods?",
    criteria: {
      true: "The page itself hosts or directly offers one of those things.",
      false:
        "The page is about any other subject. Writing that discusses one of those topics journalistically, medically, or historically counts as false.",
    },
  },
  surface_kind: {
    type: "choice",
    instructions: "What kind of surface is this page?",
    criteria: {
      made_thing:
        "One specific article, essay, project, artwork, video, game, or tool that someone made.",
      personal_home:
        "The home page or index of one person's or a small group's own website.",
      community_space:
        "A forum, guestbook, wiki, or shared canvas that people add to.",
      feed_or_index:
        "A feed, search results page, category listing, archive index, or tag page whose content is a list of links to other things.",
      utility_workflow:
        "Documentation, support articles, job listings, pricing, checkout, or account help.",
      marketing:
        "A company or product home page or landing page whose purpose is to present that company or product.",
      platform_home:
        "The front door of a large platform that hosts many users' content.",
      none_of_these: "None of the other options describe this page.",
    },
  },
  stands_alone: {
    type: "noul",
    instructions:
      "Would a stranger arriving at this page with no context and no account find something complete to look at, read, or do?",
    criteria: {
      true: "The page holds a finished thing: a readable piece of writing, a viewable work, a playable or usable tool.",
      false:
        "The page is mostly navigation, a list of links to elsewhere, an empty state, an error, or a fragment that only makes sense to someone already signed in or mid-task.",
    },
  },
  human_community: {
    type: "noul",
    instructions:
      "Is this site a place where ordinary people make, post, or trade their own things with each other?",
    criteria: {
      true: "Visitors themselves supply what is on the site: their own creations, games, music, listings, for-sale items, profiles, forum posts, wiki edits, or comments to each other. The site's purpose is to host what its members put there.",
      false:
        "An organization publishes to an audience that reads or watches: a company's product or landing page, a streaming or media catalog, a documentation or support site, a news publication, or a commercial software or assistant product. Reader comments attached to professionally published articles do not make it true.",
    },
  },
  maker: {
    type: "choice",
    instructions: "Who made the content on this page?",
    criteria: {
      individual: "One named or evident person working on their own.",
      small_group:
        "A handful of collaborators, a small studio, a club, or a two-to-several person project.",
      cultural_or_editorial_institution:
        "A museum, library, archive, magazine, journal, university department, or similar cultural or editorial body.",
      company: "A business presenting its own product, service, or brand.",
      large_platform_user_content:
        "A user's content hosted inside a large platform that many people post to.",
      cannot_tell: "The page does not indicate who made it.",
    },
  },
  care: {
    type: "score",
    instructions:
      "How much individual care went into making this page? A page may be mostly visual or interactive and carry very little text, so sparse text is not by itself evidence of low care; judge the whole page, including any structure counts provided.",
    criteria: [
      "The text is templated filler, keyword-stuffed, or auto-generated, and reads as though no person chose the words.",
      "A generic professional page that could belong to any organization in its field, with stock phrasing and a standard layout.",
      "A competent page carrying some specific voice or point of view, but built on conventional structure and styling.",
      "A page that is clearly personal and crafted, where the maker's taste shows in the writing, the structure, or the design.",
      "A singular hand-built world with its own idiom, unlike other sites, where the page itself is part of the work.",
    ],
  },
  selling: {
    type: "score",
    instructions: "How much does this page exist to sell something?",
    criteria: [
      "Nothing is offered for sale on the page.",
      "A quiet support link such as a donation, tip jar, or membership mention, off to the side of the content.",
      "Products or paid offerings sit alongside substantial content that stands on its own.",
      "The page exists to sell: the offering, its pricing, or its purchase flow is the main content.",
    ],
  },
  mass_produced: {
    type: "noul",
    instructions:
      "Does the text of this page read as produced in bulk to attract search traffic, rather than written by someone who cares about the subject?",
    criteria: {
      true: "Padded, repetitive, or formulaic text that restates its keywords and could have been generated for any similar topic.",
      false:
        "Text with specific detail, opinion, or knowledge that indicates a person wrote it about this particular subject.",
    },
  },
  reason: {
    type: "choice",
    instructions:
      "Which single label best describes what this page is, for a catalog of places on the web?",
    criteria: {
      "authentication-required": "The page cannot be read without signing in.",
      "private-or-user-bound":
        "The page shows one account holder's own data or workspace.",
      "documentation-or-support":
        "Documentation, help articles, or support material.",
      "jobs-or-recruiting":
        "Job listings, careers pages, or recruiting material.",
      "generic-homepage":
        "A home page with no particular content of its own, such as a portal or a bare landing page.",
      "business-or-product":
        "A company or product page presenting what that business offers.",
      "unsafe-or-low-quality":
        "Adult content, gambling, piracy, malware, hate speech, illegal goods, or bulk-produced filler text.",
      "human-community":
        "A forum, guestbook, wiki, or other space people contribute to together.",
      "editorial-or-cultural":
        "An essay, artwork, publication, exhibition, archive, or other editorial or cultural work.",
      "standalone-tool":
        "A tool, toy, game, or utility a visitor can use directly on the page.",
      "inspection-error":
        "The page could not be read: an error page, an empty response, or a broken destination.",
      other: "None of the other labels describe this page.",
    },
  },
};
