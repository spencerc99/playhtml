// Shared elements interfaces
interface SharedElement {
  elementId: string;
  permissions: string;
  scope: "domain" | "global";
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
  document
    .querySelectorAll("[shared], [shared-domain], [shared-global]")
    .forEach((el) => {
      if (!el.id) return;

      let scope: "domain" | "global" = "global";
      let permissions = "read-write";

      if (el.hasAttribute("shared-domain")) {
        scope = "domain";
        const attrValue = el.getAttribute("shared-domain");
        if (attrValue && attrValue !== "") {
          permissions = attrValue.includes("read-only")
            ? "read-only"
            : "read-write";
        }
      } else if (el.hasAttribute("shared-global")) {
        scope = "global";
        const attrValue = el.getAttribute("shared-global");
        if (attrValue && attrValue !== "") {
          permissions = attrValue.includes("read-only")
            ? "read-only"
            : "read-write";
        }
      } else if (el.hasAttribute("shared")) {
        scope = "global";
        const attrValue = el.getAttribute("shared");
        if (attrValue && attrValue !== "") {
          permissions = attrValue.includes("read-only")
            ? "read-only"
            : "read-write";
        }
      }

      elements.push({
        elementId: el.id,
        permissions,
        scope,
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
