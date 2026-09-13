// ABOUTME: Finds where a URL lives on the map: its building, or failing that its neighbourhood or city.
// ABOUTME: Index built once from the labels; lookups never scan the whole map.

/**
 * The widget is told where the person went as a URL, and the map knows places
 * as "host/path" strings. Most visits are not to a page anyone else visited,
 * so the match degrades gracefully: the exact page, then the longest page
 * under the same host that is a prefix of the path, then the host's own
 * busiest building, then the domain's. Every result is a building, because
 * the walker's journeys end at doors.
 */

export interface LocateLabels {
  pages: string[];
  subs: string[];
  doms: string[];
}

export interface LocateArrays {
  pageSub: Uint32Array;
  subDom: Uint32Array;
  pageHits: ArrayLike<number>;
}

export type MatchQuality = "page" | "path" | "host" | "domain";

export interface Located {
  page: number;
  sub: number;
  dom: number;
  quality: MatchQuality;
  /** what to call the place: the page's host/path, the host, or the domain */
  name: string;
  host: string;
  domain: string;
}

export interface VisitKey {
  host: string;
  path: string;
}

/** Host and path the way the map spells them: no scheme, no www., no query. */
export function visitKey(url: string): VisitKey | null {
  let u: URL;
  try {
    u = new URL(url.includes("://") ? url : `https://${url}`);
  } catch {
    return null;
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return null;
  const host = u.hostname.toLowerCase().replace(/^www\./, "");
  if (!host) return null;
  let path = u.pathname || "/";
  if (path.length > 1) path = path.replace(/\/+$/, "");
  return { host, path };
}

/** The host portion of a neighbourhood label: "docs.google.com/x [3]" -> "docs.google.com". */
export function subHost(label: string): string {
  return label.replace(/ \[\d+\]$/, "").split("/")[0].replace(/^www\./, "").toLowerCase();
}

export class Locator {
  private pageByKey = new Map<string, number>();
  private pagesByHost = new Map<string, number[]>();
  private subsByHost = new Map<string, number[]>();
  private subsByDom = new Map<string, number[]>();
  private subHosts: string[];

  constructor(private labels: LocateLabels, private A: LocateArrays) {
    const { pages, subs, doms } = labels;
    for (let i = 0; i < pages.length; i++) {
      const k = visitKey(pages[i]);
      if (!k) continue;
      const key = `${k.host}${k.path}`;
      // the busier page keeps a contested key
      const prev = this.pageByKey.get(key);
      if (prev === undefined || A.pageHits[i] > A.pageHits[prev]) this.pageByKey.set(key, i);
      let list = this.pagesByHost.get(k.host);
      if (!list) { list = []; this.pagesByHost.set(k.host, list); }
      list.push(i);
    }
    this.subHosts = subs.map(subHost);
    for (let s = 0; s < subs.length; s++) {
      const h = this.subHosts[s];
      let list = this.subsByHost.get(h);
      if (!list) { list = []; this.subsByHost.set(h, list); }
      list.push(s);
      const d = doms[A.subDom[s]]?.toLowerCase().replace(/^www\./, "");
      if (!d) continue;
      let dl = this.subsByDom.get(d);
      if (!dl) { dl = []; this.subsByDom.set(d, dl); }
      dl.push(s);
    }
  }

  locate(url: string): Located | null {
    const k = visitKey(url);
    if (!k) return null;
    const exact = this.pageByKey.get(`${k.host}${k.path}`);
    if (exact !== undefined) return this.result(exact, "page", this.labels.pages[exact]);

    // the longest page under this host that the visited path sits beneath
    const own = this.pagesByHost.get(k.host);
    if (own) {
      let best = -1, bestLen = -1;
      for (const p of own) {
        const pk = visitKey(this.labels.pages[p]);
        if (!pk) continue;
        const under = pk.path === "/" ? true
          : k.path === pk.path || k.path.startsWith(pk.path + "/");
        if (!under) continue;
        const len = pk.path.length;
        if (len > bestLen || (len === bestLen && this.A.pageHits[p] > this.A.pageHits[best])) {
          best = p; bestLen = len;
        }
      }
      if (best >= 0) return this.result(best, "path", this.labels.pages[best]);
    }

    // the host's own busiest building
    const hostSubs = this.subsByHost.get(k.host);
    if (hostSubs) {
      const p = this.busiestPage(hostSubs);
      if (p >= 0) return this.result(p, "host", k.host);
    }

    // walk up the hostname until it names a city
    const parts = k.host.split(".");
    for (let i = 0; i < parts.length - 1; i++) {
      const cand = parts.slice(i).join(".");
      const domSubs = this.subsByDom.get(cand);
      if (!domSubs) continue;
      const p = this.busiestPage(domSubs);
      if (p >= 0) return this.result(p, "domain", cand);
    }
    return null;
  }

  private pagesOfSub: Map<number, number[]> | null = null;

  private busiestPage(subs: number[]): number {
    if (!this.pagesOfSub) {
      this.pagesOfSub = new Map();
      const ps = this.A.pageSub;
      for (let p = 0; p < ps.length; p++) {
        let l = this.pagesOfSub.get(ps[p]);
        if (!l) { l = []; this.pagesOfSub.set(ps[p], l); }
        l.push(p);
      }
    }
    let best = -1, bh = -1;
    for (const s of subs) {
      for (const p of this.pagesOfSub.get(s) ?? []) {
        if (this.A.pageHits[p] > bh) { bh = this.A.pageHits[p]; best = p; }
      }
    }
    return best;
  }

  private result(page: number, quality: MatchQuality, name: string): Located {
    const sub = this.A.pageSub[page];
    const dom = this.A.subDom[sub];
    return {
      page, sub, dom, quality, name,
      host: this.subHosts[sub],
      domain: this.labels.doms[dom] ?? "",
    };
  }
}
