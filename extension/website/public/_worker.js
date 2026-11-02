// ABOUTME: Cloudflare Pages worker for wewere.online; every other path is served as a static file.
// ABOUTME: Gives a shared collage's page its title and cover in the tags link previews read.

const API_ORIGIN = "https://playhtml-game-api.spencerc99.workers.dev";
// The same API on a wewere.online subdomain, cached at the edge, for pictures.
const ASSETS_ORIGIN = "https://assets.wewere.online";
const COLLAGE_ID = /^[A-Za-z0-9_-]{22}$/;

function escapeHtml(text) {
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function countOf(count, one, many) {
  return `${count} ${count === 1 ? one : many}`;
}

/** The collage a viewer link names, read from the share API, or null. */
async function readCollage(apiOrigin, id) {
  try {
    const response = await fetch(`${apiOrigin}/collages/${id}`);
    if (!response.ok) return null;
    const collage = await response.json();
    if (!collage || !Array.isArray(collage.pieces)) return null;
    return { collage, hasCover: response.headers.get("X-Collage-Cover") === "1" };
  } catch {
    return null;
  }
}

function previewTags({ title, description, url, image }) {
  const tags = [
    ["property", "og:type", "website"],
    ["property", "og:site_name", "we were online"],
    ["property", "og:title", title],
    ["property", "og:description", description],
    ["property", "og:url", url],
    ["name", "description", description],
    ["name", "twitter:title", title],
    ["name", "twitter:description", description],
    ["name", "twitter:card", image ? "summary_large_image" : "summary"],
  ];
  if (image) {
    tags.push(["property", "og:image", image], ["name", "twitter:image", image]);
  }
  return tags
    .map(
      ([attribute, key, value]) =>
        `<meta ${attribute}="${key}" content="${escapeHtml(value)}" />`,
    )
    .join("\n    ");
}

async function collagePage(request, env, page) {
  const url = new URL(request.url);
  const id = url.searchParams.get("id") ?? "";
  const type = page.headers.get("Content-Type") ?? "";
  if (!page.ok || !type.includes("text/html") || !COLLAGE_ID.test(id)) {
    return page;
  }
  const apiOrigin = (env.COLLAGE_API_ORIGIN || API_ORIGIN).replace(/\/+$/, "");
  const assetsOrigin = (
    env.COLLAGE_ASSETS_ORIGIN ||
    env.COLLAGE_API_ORIGIN ||
    ASSETS_ORIGIN
  ).replace(/\/+$/, "");
  const found = await readCollage(apiOrigin, id);
  if (!found) return page;
  const { collage, hasCover } = found;
  const name =
    (typeof collage.title === "string" && collage.title.trim()) ||
    "untitled collage";
  const sites = new Set(
    collage.pieces.map((piece) => piece?.source?.domain).filter(Boolean),
  ).size;
  const tags = previewTags({
    title: name,
    description: `a collage of ${countOf(collage.pieces.length, "piece", "pieces")} from ${countOf(sites, "site", "sites")}, on we were online`,
    url: url.toString(),
    image: hasCover ? `${assetsOrigin}/collages/${id}/cover` : null,
  });
  const response = new HTMLRewriter()
    .on("title", {
      element(element) {
        element.setInnerContent(`${name} · a collage on we were online`);
      },
    })
    .on("head", {
      element(element) {
        element.append(tags, { html: true });
      },
    })
    .transform(page);
  // A link taken down should stop previewing soon after.
  const headers = new Headers(response.headers);
  headers.set("Cache-Control", "public, max-age=60");
  return new Response(response.body, { status: response.status, headers });
}

export default {
  async fetch(request, env) {
    const page = await env.ASSETS.fetch(request);
    const { pathname } = new URL(request.url);
    if (pathname === "/collage/" || pathname === "/collage/index.html") {
      return collagePage(request, env, page);
    }
    return page;
  },
};
