// ABOUTME: Defines PartyKit API hosts and the authenticated fetch used by the website admin consoles.
// ABOUTME: Keeps production and test admin requests aligned with runtime defaults.
export type EnvName = "production" | "staging" | "development";

export const HOSTS: Record<EnvName, string> = {
  production: "https://api.playhtml.fun",
  staging: "https://api-staging.playhtml.fun",
  development: "http://localhost:1999",
};

// Sends the admin token in the Authorization header so it never appears in
// request URLs (server logs, browser history, Referer headers).
export function adminFetch(
  url: string,
  adminToken: string,
  init: RequestInit = {},
): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${adminToken}`);
  return fetch(url, { ...init, headers });
}
