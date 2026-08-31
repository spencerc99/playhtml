// ABOUTME: Defines the privacy-limited response consumed by Internet Commute.
// ABOUTME: Separates domain-only scenery from explicitly clickable destinations.

export interface CommuteSceneryItem {
  id: string;
  domain: string;
  visitedAt: number;
  hue: string;
}

export interface CommuteDestination extends CommuteSceneryItem {
  url: string;
  title: string | null;
}

export interface CommuteResponse {
  generatedAt: number;
  activePeople: number;
  scenery: CommuteSceneryItem[];
  destinations: CommuteDestination[];
}
