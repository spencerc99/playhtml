export type SharedReference = {
  domain: string;
  path: string;
  elementId: string;
};

export function parseDataSource(value: string): SharedReference {
  // Format: domain[/path]#elementId
  const [domainAndPath, elementId] = value.split("#");
  if (!domainAndPath || !elementId) {
    throw new Error("Invalid data-source attribute value");
  }
  const firstSlash = domainAndPath.indexOf("/");
  const domain =
    firstSlash === -1 ? domainAndPath : domainAndPath.slice(0, firstSlash);
  const path = firstSlash === -1 ? "/" : domainAndPath.slice(firstSlash);
  return { domain, path, elementId };
}

// Normalizes the host for room ID construction. Strips "www." prefix
// so that www.example.com and example.com resolve to the same room,
// and substitutes "LOCAL" for empty hosts (file:// protocol).
export const LOCAL_HOST_IDENTIFIER = "LOCAL";

export function normalizeHost(host: string): string {
  if (!host) return LOCAL_HOST_IDENTIFIER;
  return host.replace(/^www\./i, "");
}

export function normalizePath(path: string): string {
  if (!path) return "/";
  const cleaned = path.replace(/\.[^/.]+$/, "");
  return cleaned.startsWith("/") ? cleaned : `/${cleaned}`;
}

export function deriveRoomId(host: string, inputRoom: string): string {
  const normalizedHost = normalizeHost(host);
  const normalized = normalizePath(inputRoom);
  return encodeURIComponent(`${normalizedHost}-${normalized}`);
}
