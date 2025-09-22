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

export function normalizePath(path: string): string {
  if (!path) return "/";
  const cleaned = path.replace(/\.[^/.]+$/, "");
  return cleaned.startsWith("/") ? cleaned : `/${cleaned}`;
}

export function deriveRoomId(host: string, inputRoom: string): string {
  const normalized = normalizePath(inputRoom);
  return encodeURIComponent(`${host}-${normalized}`);
}
