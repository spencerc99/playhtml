// ABOUTME: Turns a saved archive/share URL into a matched set of installation
// ABOUTME: screen URLs — one master + N coordinated followers — for multi-screen.

/** One screen in a generated installation set. */
export interface InstallationScreen {
  /** "master" (full field, drives the clock) or "follower N" (zoomed). */
  label: string;
  role: "master" | "follower";
  /** Stable follower id for cursor-claim coordination; undefined for master. */
  followerId?: string;
  /** The full URL to open on that screen. */
  url: string;
}

/** Follower ids a, b, c, … (then a2, b2 … past 26, which no real install hits). */
function followerIdForIndex(i: number): string {
  const letter = String.fromCharCode(97 + (i % 26));
  const cycle = Math.floor(i / 26);
  return cycle === 0 ? letter : `${letter}${cycle + 1}`;
}

/** Build a master + `followerCount` follower URLs from a saved share URL.
 *
 * Every screen keeps the source URL's params (day/tod/viz/`?s=` blob) so they
 * render identical trail data, and only differs by the installation params:
 *   - master:   `?role=master` (full field, broadcasts the clock)
 *   - follower: `?role=follower&cinematic=follow&follower=<id>` (zoomed; the
 *               followers coordinate at runtime so no two ride the same cursor)
 *
 * `origin` overrides the source URL's origin (so a config saved on the deployed
 * site can be pointed at localhost for testing, or vice versa). Pass the current
 * page origin to keep everything same-origin — required for the BroadcastChannel
 * clock/claims to connect across the windows.
 *
 * Any pre-existing role/cinematic/follow(er) params on the source URL are
 * stripped first so re-running the builder on an already-installation URL is
 * idempotent. `clean=2` is forced on so the screens read as bare art. */
export function buildInstallationScreens(
  sourceUrl: string,
  followerCount: number,
  origin?: string,
): InstallationScreen[] {
  const base = new URL(sourceUrl, origin || undefined);
  if (origin) {
    const o = new URL(origin);
    base.protocol = o.protocol;
    base.host = o.host;
  }
  // Point every screen at the installation view regardless of the source page.
  base.pathname = "/installation/";

  // Strip params the builder owns so the result is idempotent.
  for (const key of ["role", "cinematic", "follow", "follower"]) {
    base.searchParams.delete(key);
  }
  // Screens are bare art surfaces.
  base.searchParams.set("clean", "2");

  const withParams = (params: Record<string, string>): string => {
    const u = new URL(base.toString());
    for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
    return u.toString();
  };

  const screens: InstallationScreen[] = [
    { label: "master", role: "master", url: withParams({ role: "master" }) },
  ];

  const count = Math.max(0, Math.floor(followerCount));
  for (let i = 0; i < count; i++) {
    const id = followerIdForIndex(i);
    screens.push({
      label: `follower ${id}`,
      role: "follower",
      followerId: id,
      url: withParams({
        role: "follower",
        cinematic: "follow",
        follower: id,
      }),
    });
  }

  return screens;
}
