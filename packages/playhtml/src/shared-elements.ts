// ABOUTME: Finds shared playhtml sources and consumers in the current document.
// ABOUTME: Supports runtime diagnostics without loading the full development toolbar.

import { normalizePath, parseDataSource } from "@playhtml/common";
import { parseSharedPermission } from "./sharing";

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
      permissions: parseSharedPermission(element.getAttribute("shared")),
      element,
    });
  });

  document.querySelectorAll("[data-source]").forEach((el) => {
    const element = el as HTMLElement;
    const raw = element.getAttribute("data-source") || "";
    let reference: ReturnType<typeof parseDataSource>;
    try {
      reference = parseDataSource(raw);
    } catch {
      return;
    }
    const { domain, path, elementId } = reference;
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
