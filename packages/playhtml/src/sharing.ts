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

    const [domainAndPath, elementId] = dataSource.split("#");
    if (!domainAndPath || !elementId) return;

    const pathIndex = domainAndPath.indexOf("/");
    const domain =
      pathIndex === -1 ? domainAndPath : domainAndPath.substring(0, pathIndex);
    const path = pathIndex === -1 ? "/" : domainAndPath.substring(pathIndex);

    references.push({ domain, path, elementId });
  });

  return references;
}
