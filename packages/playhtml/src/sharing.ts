// ABOUTME: Discovers shared elements and references on the current page.
// ABOUTME: Tracks local read permissions for shared element consumers.
import { getIdForElement, parseDataSource } from "@playhtml/common";

const sharedPermissions = new Map<string, "read-only" | "read-write">();

export function setSharedPermission(
  elementId: string,
  permission: "read-only" | "read-write",
): void {
  sharedPermissions.set(elementId, permission);
}

/**
 * Reads a `shared` attribute value as a permission mode. Empty or absent means
 * read-write; "read-only" anywhere in the value, or exactly "ro", means read-only.
 */
export function parseSharedPermission(
  attrValue: string | null,
): "read-only" | "read-write" {
  if (!attrValue) return "read-write";
  const val = attrValue.toLowerCase();
  return val.includes("read-only") || val === "ro" ? "read-only" : "read-write";
}

// Shared elements interfaces
interface SharedElement {
  elementId: string;
  permissions: string;
  path?: string;
}

interface SharedReference {
  domain: string;
  path: string;
  elementId: string;
}

// Shared element discovery functions
export function findSharedElementsOnPage(): SharedElement[] {
  const elements: SharedElement[] = [];

  // Find elements with shared attributes
  document.querySelectorAll("[shared]").forEach((el) => {
    if (!el.id) return;

    elements.push({
      elementId: el.id,
      permissions: parseSharedPermission(el.getAttribute("shared")),
      path: window.location.pathname,
    });
  });

  return elements;
}

export function findSharedReferencesOnPage(): SharedReference[] {
  const references: SharedReference[] = [];

  document.querySelectorAll("[data-source]").forEach((el) => {
    const dataSource = el.getAttribute("data-source");
    if (!dataSource) return;
    try {
      const { domain, path, elementId } = parseDataSource(dataSource);
      references.push({ domain, path, elementId });
    } catch {}
  });

  return references;
}

export function isSharedReadOnly(
  element: HTMLElement,
  elementId?: string | null,
): boolean {
  const isConsumer = element.hasAttribute("data-source");
  const isReadOnlyExplicit =
    isConsumer && element.hasAttribute("data-source-read-only");
  if (isReadOnlyExplicit) return true;
  const eid = elementId ?? getIdForElement(element);
  if (!eid) return false;
  return sharedPermissions.get(eid) === "read-only";
}
