// ABOUTME: Defines PartyKit API hosts used by the website admin consoles.
// ABOUTME: Keeps production and test admin requests aligned with runtime defaults.
export type EnvName = "production" | "staging" | "development";

export const HOSTS: Record<EnvName, string> = {
  production: "https://api.playhtml.fun",
  staging: "https://api-staging.playhtml.fun",
  development: "http://localhost:1999",
};
