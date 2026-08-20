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

    let permissions = "read-write";
    const attrValue = el.getAttribute("shared");
    if (attrValue && attrValue !== "") {
      const val = attrValue.toLowerCase();
      if (val.includes("read-only") || val === "ro") permissions = "read-only";
    }

    elements.push({
      elementId: el.id,
      permissions,
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
