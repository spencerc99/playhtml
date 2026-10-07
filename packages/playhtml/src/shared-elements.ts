// ABOUTME: Finds shared playhtml sources and consumers in the current document.
// ABOUTME: Supports runtime diagnostics without loading the full development toolbar.

import { normalizePath } from "@playhtml/common";

export function listSharedElements() {
  const out: Array<{
    type: "source" | "consumer";
    elementId: string;
    dataSource: string;
    normalized: string;
    permissions?: "read-only" | "read-write";
    element: HTMLElement;
  }> = [];

  document.querySelectorAll("[shared]").forEach((el) => {
    const element = el as HTMLElement;
    const id = element.id;
    if (!id) return;
    const ds = `${window.location.host}${normalizePath(
      window.location.pathname,
    )}#${id}`;
    out.push({
      type: "source",
      elementId: id,
      dataSource: ds,
      normalized: ds,
      permissions: element.getAttribute("shared")?.includes("read-only")
        ? "read-only"
        : "read-write",
      element,
    });
  });

  document.querySelectorAll("[data-source]").forEach((el) => {
    const element = el as HTMLElement;
    const raw = element.getAttribute("data-source") || "";
    const [domainAndPath, elementId] = raw.split("#");
    if (!domainAndPath || !elementId) return;
    const firstSlash = domainAndPath.indexOf("/");
    const domain =
      firstSlash === -1 ? domainAndPath : domainAndPath.slice(0, firstSlash);
    const path = firstSlash === -1 ? "/" : domainAndPath.slice(firstSlash);
    const normalized = `${domain}${normalizePath(path)}#${elementId}`;
    out.push({
      type: "consumer",
      elementId,
      dataSource: raw,
      normalized,
      element,
    });
  });

  if (out.length > 0) {
    try {
      console.table(
        out.map((e) => ({
          type: e.type,
          elementId: e.elementId,
          dataSource: e.dataSource,
          normalized: e.normalized,
          permissions: e.permissions || "",
        })),
      );
    } catch {}
  }
  return out;
}
