// ABOUTME: Homepage for wewere.online
// ABOUTME: Single-page landing — hero with downloads, three pull-quote beats with living elements, guestbook

import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { LiveTrails } from "@movement/components/LiveTrails";
import { LiveIndicator } from "@movement/components/LiveIndicator";
import { WordmarkClock } from "@movement/components/WordmarkClock";
import { useCursorTrails } from "@movement/hooks/useCursorTrails";
import { countActivePeople } from "@movement/utils/eventUtils";
import { useLiveEvents } from "@movement/hooks/useLiveEvents";
import { useAccumulatedEvents } from "@movement/hooks/useAccumulatedEvents";
import { PresenceIndicator } from "./components/PresenceIndicator";
import { AuraGuestbook } from "./components/AuraGuestbook";
import { Bench } from "./components/Bench";
import { CoffeeMachine } from "./components/CoffeeMachine";
import { DownloadGate } from "./components/DownloadGate";
import styles from "./App.module.scss";

const ALIVE_INTERNET_ESSAY_URL =
  "https://news.spencer.place/p/alive-internet-theory";
const BENCHES_ESSAY_URL =
  "https://news.spencer.place/p/the-internet-has-no-benches";

const DISCORD_INVITE = "https://discord.gg/SKbsSf4ptU";
// Email assembled at click-time so scrapers don't see a literal mailto: in the
// HTML. Spencer was getting a lot of bot mail off the plain mailto link.
const HELP_EMAIL_USER = "hi";
const HELP_EMAIL_DOMAIN = "spencer.place";
const HELP_EMAIL_SUBJECT = "help build we were online";

function RisoTexture() {
  return (
    <svg
      width="100%"
      height="100%"
      style={{
        position: "absolute",
        inset: 0,
        opacity: 0.7,
        pointerEvents: "none",
        mixBlendMode: "multiply",
      }}
    >
      <defs>
        <filter id="noise">
          <feTurbulence
            type="fractalNoise"
            baseFrequency="0.9"
            numOctaves="3"
            stitchTiles="stitch"
          />
          <feColorMatrix
            type="matrix"
            values="1 0 0 0 0 0 1 0 0 0 0 0 1 0 0 0 0 0 2 -1"
          />
        </filter>
        <filter id="grain">
          <feTurbulence
            type="turbulence"
            baseFrequency="0.5"
            numOctaves="2"
            stitchTiles="stitch"
          />
          <feColorMatrix type="saturate" values="0" />
          <feComponentTransfer>
            <feFuncA type="discrete" tableValues="0 0.2 0.3 0.4" />
          </feComponentTransfer>
        </filter>
      </defs>
      <rect width="100%" height="100%" filter="url(#noise)" />
      <rect
        width="100%"
        height="100%"
        filter="url(#grain)"
        style={{ opacity: 0.3 }}
      />
    </svg>
  );
}

// Deep enough that trails stay on screen for minutes (don't age off the window
// while you're watching). A live trail leaves only when its events finally fall
// out of this rolling buffer.
const EVENT_LIMIT = 500;

const TRAIL_SETTINGS = {
  trailOpacity: 0.5,
  // Live trails use each participant's own cursor color (stable across the
  // continuous re-derivation the stream triggers). Randomized colors would
  // reshuffle every batch since they're assigned by array-order index.
  randomizeColors: false,
  filters: [],
  pidFilter: "",
  eventFilter: { move: true, click: true, hold: false, cursor_change: false },
  trailStyle: "chaotic" as const,
  chaosIntensity: 0.6,
  trailAnimationMode: "natural" as const,
  maxConcurrentTrails: 5,
  overlapFactor: 1,
  minGapBetweenTrails: 0.1,
  documentSpace: false,
  // One trail per participant+url. Without this a group that splits into
  // multiple >5min-gap segments emits several trails sharing the same id,
  // producing duplicate React keys (React warns "two children with the same
  // key") and the resulting intermittent disappearing/flickering trails.
  singleSegmentPerGroup: true,
};

const ANIMATION_SETTINGS = {
  strokeWidth: 5,
  pointSize: 4,
  trailOpacity: 0.5,
  animationSpeed: 1.0,
  clickMinRadius: 10,
  clickMaxRadius: 30,
  clickCoreRadius: 3,
  clickMinDuration: 600,
  clickMaxDuration: 1200,
  clickExpansionDuration: 400,
  clickStrokeWidth: 1,
  clickOpacity: 0.4,
  clickNumRings: 2,
  clickRingDelayMs: 80,
  clickAnimationStopPoint: 0.8,
};

export default function App() {
  const [viewportSize, setViewportSize] = useState({
    width: window.innerWidth,
    height: window.innerHeight,
  });

  // Live stream: starts from the server's recent-event replay, then accumulates
  // new events over the session (capped at EVENT_LIMIT). The trail cycle grows
  // with the event time span, unlike the old fixed one-shot snapshot.
  const { events, connected } = useLiveEvents({
    maxEvents: EVENT_LIMIT,
  });

  useEffect(() => {
    const onResize = () =>
      setViewportSize({ width: window.innerWidth, height: window.innerHeight });
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  // Keep each live trail's full point history as the event window slides, so
  // trails grow and persist instead of shrinking/shifting/vanishing when their
  // earliest events age off the stream cap. A group's events are freed when its
  // trail has fully faded out on screen (LiveTrails reports the id here).
  const evictIdsRef = useRef<Set<string>>(new Set());
  const handleTrailsRemoved = useCallback((ids: string[]) => {
    for (const id of ids) evictIdsRef.current.add(id);
  }, []);
  const accumulatedEvents = useAccumulatedEvents(events, {
    maxGroups: 60,
    evictIdsRef,
  });
  const { trailStates } = useCursorTrails(
    accumulatedEvents,
    viewportSize,
    TRAIL_SETTINGS,
  );

  // True count of people browsing right now — from the raw event stream, so it
  // reflects real activity even though the canvas only draws a capped subset.
  const peopleCount = useMemo(() => countActivePeople(events), [events]);


  return (
    <div className={styles.page}>
      <div className={styles.trails}>
        {trailStates.length > 0 && (
          <LiveTrails
            trailStates={trailStates}
            onTrailsRemoved={handleTrailsRemoved}
            settings={ANIMATION_SETTINGS}
          />
        )}
        <RisoTexture />
        {/* People-count pinned to the bottom of the first screen (the portrait
            area) and scrolls away with the page — not fixed to the viewport. */}
        <LiveIndicator
          connected={connected}
          peopleCount={peopleCount}
          style={{
            position: "absolute",
            top: "calc(100vh - 36px)",
            left: 16,
            zIndex: 2,
          }}
        />
        {/* Live current date + time in the wordmark style, bottom-right. */}
        <WordmarkClock
          style={{
            position: "absolute",
            top: "calc(100vh - 40px)",
            right: 16,
            zIndex: 2,
          }}
        />
      </div>

      <div className={styles.content}>
        <section className={styles.hero}>
          <h1 className={styles.wordmark}>we were online</h1>
          <p className={styles.tagline}>
            turning the internet into a living, shared space
          </p>
          <a className={styles.portraitLink} href="/portrait/">
            watch the live portrait →
          </a>
          <div
            className={`${styles.siteCard} ${styles.siteCardTeal}`}
            can-spin="true"
            id="wewere-site-card-1"
          >
            the cursor trails are from real people browsing
          </div>
          <div
            className={`${styles.siteCard} ${styles.siteCardRust}`}
            can-spin="true"
            id="wewere-site-card-2"
          >
            install the extension to try it out!
          </div>
          <DownloadGate />
        </section>

        <section className={styles.section}>
          <div className={styles.essayBlock}>
            <p>
              It's controversial to have hope for the internet these days.{" "}
              <a
                href="https://en.wikipedia.org/wiki/Dead_Internet_theory"
                target="_blank"
                rel="noopener noreferrer"
              >
                Dead internet theory
              </a>{" "}
              has entered mainstream discourse as AI social accounts multiply
              and compete for what flavor of slop comes after Italian brainrot.
            </p>

            <p>
              But there's so much life around us, still thriving on the open
              Internet. From rural{" "}
              <a
                href="https://forum.melonland.net/"
                target="_blank"
                rel="noopener noreferrer"
              >
                forums
              </a>
              ,{" "}
              <a
                href="https://merveilles.town/about"
                target="_blank"
                rel="noopener noreferrer"
              >
                towns
              </a>
              , and{" "}
              <a
                href="https://playhtml.fun/fridge"
                target="_blank"
                rel="noopener noreferrer"
              >
                fridge walls
              </a>{" "}
              to community-run{" "}
              <a
                href="http://wikipedia.org/"
                target="_blank"
                rel="noopener noreferrer"
              >
                encyclopedias
              </a>{" "}
              and{" "}
              <a
                href="https://www.openstreetmap.org/communities"
                target="_blank"
                rel="noopener noreferrer"
              >
                maps
              </a>
              , pockets of humanity continue to flourish despite (&amp; perhaps
              now, in part, in spite) of these existential fears.
            </p>

            <p>
              So why does it still feel so lonely when we browse the Internet?
            </p>

            <div className={`${styles.marginalia} ${styles.marginaliaLeft}`}>
              <aside className={styles.marginaliaAside}>
                <Bench id="wewere-bench" />
              </aside>
              <p className={styles.benchesLine}>
                I think it's because{" "}
                <a
                  href={BENCHES_ESSAY_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  the Internet has no benches
                </a>
                .
              </p>
            </div>

            <p>
              One of my favorite things about walking around in the real world
              is the causal sharing of space with other people. We share a look
              when something funny happens or help out when a stranger trips.
              Sometimes these spontaneous encounters become meaningful
              encounters that stay with us.
            </p>

            <div className={styles.marginalia}>
              <p>
                The Internet has none of this. Online, we're forced to perform
                or consume. We have all this life around us on the web, but we
                can't feel it.
              </p>
              <aside className={styles.marginaliaAside}>
                <CoffeeMachine id="wewere-coffee" />
              </aside>
            </div>

            <p>
              <em>
                <b style={{ fontSize: "1.1em" }}>we were online</b>
              </em>{" "}
              is an online multiplayer world—part game, artwork, and tool—that
              turns the existing Internet into a living, shared world, actively
              shaped by its inhabitants.
            </p>

            <p>
              Built on <a href="https://playhtml.fun/">playhtml</a>, an
              open-source library for creating shared experiences, the game is
              designed to be customized and extended by its players. Individual
              websites can create interactions that respond to live events on
              other websites and change behavior depending on a user’s history
              and personality.
            </p>

            <p>
              Isolated browsing becomes the site of serendipitous encounters as
              everything becomes material for connection. Assets, buttons, and
              other components can be created, grown, moved, taken, and gifted.
              Pages show wear as people pass through and use them. Cursors
              become digital appendages for bumping into others.
            </p>

            <p>
              Instead of a new social platform, I'm invested in helping the
              existing Internet we already live in{" "}
              <a
                href={ALIVE_INTERNET_ESSAY_URL}
                target="_blank"
                rel="noopener noreferrer"
              >
                come to life
              </a>{" "}
              with our presence — one we can shape together, piece by piece. Not
              as users, but as neighbors and stewards nurturing a home for
              generations to come.
            </p>
          </div>
          <br />
          <DownloadGate />
        </section>

        <section className={styles.section}>
          <h2 className={styles.sectionHeading}>leave a mark</h2>
          <AuraGuestbook id="wewere-online-guestbook" />
        </section>

        <section className={`${styles.section} ${styles.helpBuild}`}>
          <p className={styles.helpBuildLead}>
            want to make this world with us?
          </p>
          <p className={styles.helpBuildBody}>
            I'm looking for people who want to help build this together.
            Designers, artists, writers, all internet hopefuls welcome.
          </p>
          <div className={styles.helpBuildActions}>
            <a
              href={DISCORD_INVITE}
              target="_blank"
              rel="noopener noreferrer"
              className={`${styles.helpBuildCta} ${styles.helpBuildCtaPrimary}`}
            >
              join the playhtml discord
            </a>
            <button
              type="button"
              className={styles.helpBuildEmailLink}
              onClick={(e) => {
                const addr = `${HELP_EMAIL_USER}@${HELP_EMAIL_DOMAIN}`;
                const href = `mailto:${addr}?subject=${encodeURIComponent(HELP_EMAIL_SUBJECT)}`;
                window.location.href = href;
                e.currentTarget.blur();
              }}
              aria-label="email spencer"
            >
              or email directly →{" "}
              <span className={styles.helpBuildEmailAddr}>
                {HELP_EMAIL_USER}
                <span aria-hidden="true"> [at] </span>
                <span className={styles.srOnly}>@</span>
                {HELP_EMAIL_DOMAIN}
              </span>
            </button>
          </div>
        </section>

        <section className={styles.section}>
          <h2 className={styles.sectionHeading}>
            {" "}
            open questions I'm exploring:
          </h2>
          <ol className={styles.openQuestions}>
            <li>
              How do you foster{" "}
              <a
                href="https://www.are.na/omayeli-arenyeka/solidarity-on-the-web"
                target="_blank"
                rel="noopener noreferrer"
              >
                solidarity on the web
              </a>
              ?
            </li>
            <li>
              What makes a digital space feel safe for you to express yourself
              and how much of yourself do you need to reveal to feel genuinely
              connected to a stranger online?
            </li>
            <li>
              How can it feel genuinely good and meaningful to spend time online
              without veering into addiction?
            </li>
            <li>
              What can serve as a{" "}
              <a
                href="https://www.poetryfoundation.org/poetrymagazine/articles/60484/the-third-thing"
                target="_blank"
                rel="noopener noreferrer"
              >
                "third thing"
              </a>{" "}
              to help us find "joint rapture"?
            </li>
          </ol>
          <h2 className={styles.sectionHeading}>read more</h2>
          <ul className={styles.linkList}>
            <li>
              <a
                href={ALIVE_INTERNET_ESSAY_URL}
                target="_blank"
                rel="noopener noreferrer"
              >
                Alive Internet Theory
              </a>{" "}
              — on how we'll never let the Internet die
            </li>
            <li>
              <a
                href={BENCHES_ESSAY_URL}
                target="_blank"
                rel="noopener noreferrer"
              >
                The Internet Has No Benches
              </a>{" "}
              — on the missing third places of the web
            </li>
          </ul>
        </section>

        <footer className={styles.footer}>
          <p>
            stewarded by{" "}
            <a
              href="https://spencer.place"
              target="_blank"
              rel="noopener noreferrer"
            >
              spencer
            </a>
            , built on{" "}
            <a
              href="https://playhtml.fun/"
              target="_blank"
              rel="noopener noreferrer"
            >
              playhtml
            </a>
          </p>
          <p>
            contact <a href="mailto:hi@spencer.place">hi@spencer.place</a> with
            questions, provocations, ideas
          </p>
        </footer>
      </div>

      <PresenceIndicator />
    </div>
  );
}
