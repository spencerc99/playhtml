// ABOUTME: Homepage for wewere.online
// ABOUTME: Scrollable landing page with trails background, essay sections, guestbook, and presence

import { useState, useEffect } from "react";
import { AnimatedTrails } from "@movement/components/AnimatedTrails";
import { useCursorTrails } from "@movement/hooks/useCursorTrails";
import type { CollectionEvent } from "@movement/types";
import { PresenceIndicator } from "./components/PresenceIndicator";
import { AuraGuestbook } from "./components/AuraGuestbook";
import { Bench } from "./components/Bench";
import { CoffeeMachine } from "./components/CoffeeMachine";
import styles from "./App.module.scss";

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

const WORKER_URL = "https://playhtml-game-api.spencerc99.workers.dev";
const EVENT_LIMIT = 150;

const TRAIL_SETTINGS = {
  trailOpacity: 0.5,
  randomizeColors: true,
  domainFilter: "",
  eventFilter: { move: true, click: true, hold: false, cursor_change: false },
  trailStyle: "chaotic" as const,
  chaosIntensity: 0.6,
  trailAnimationMode: "stagger" as const,
  maxConcurrentTrails: 5,
  overlapFactor: 1,
  minGapBetweenTrails: 0.1,
  documentSpace: false,
};

const ANIMATION_SETTINGS = {
  strokeWidth: 5,
  pointSize: 4,
  trailOpacity: 0.5,
  animationSpeed: 1.0,
  clickMinRadius: 10,
  clickMaxRadius: 30,
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
  const [events, setEvents] = useState<CollectionEvent[]>([]);
  const [viewportSize, setViewportSize] = useState({
    width: window.innerWidth,
    height: window.innerHeight,
  });

  useEffect(() => {
    fetch(`${WORKER_URL}/events/recent?type=cursor&limit=${EVENT_LIMIT}`)
      .then((r) => r.json())
      .then((data: CollectionEvent[]) => setEvents(data))
      .catch(() => {});
  }, []);

  useEffect(() => {
    const onResize = () =>
      setViewportSize({ width: window.innerWidth, height: window.innerHeight });
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  const { trailStates, timeBounds, cycleDuration } = useCursorTrails(
    events,
    viewportSize,
    TRAIL_SETTINGS,
  );

  const timeRange = {
    min: timeBounds.min,
    max: timeBounds.max,
    duration: cycleDuration,
  };

  return (
    <div className={styles.page}>
      <div className={styles.trails}>
        {trailStates.length > 0 && (
          <AnimatedTrails
            trailStates={trailStates}
            timeRange={timeRange}
            showClickRipples={false}
            settings={ANIMATION_SETTINGS}
          />
        )}
        <RisoTexture />
      </div>

      <div className={styles.content}>
        <section className={styles.hero}>
          <h1 className={styles.wordmark}>we were online</h1>
          <p className={styles.tagline}>
            a living archive of how we used the internet
          </p>
          <div
            className={`${styles.siteCard} ${styles.siteCardTeal}`}
            can-spin="true"
            id="wewere-site-card-1"
          >
            (welcome to everyone from the secret video!)
          </div>
          <div
            className={`${styles.siteCard} ${styles.siteCardRust}`}
            can-spin="true"
            id="wewere-site-card-2"
          >
            this site is a living, shared space!
          </div>
          <a
            href="https://forms.gle/iX8Lfgcy3LW79EsRA"
            target="_blank"
            rel="noopener noreferrer"
            className={styles.cta}
          >
            sign up to try it!
          </a>
          <div className={styles.scrollHint} aria-hidden="true">
            <svg
              width="24"
              height="14"
              viewBox="0 0 24 14"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M2 2l10 10L22 2" />
            </svg>
          </div>
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
                I think it's because the Internet has no benches.
              </p>
            </div>

            <p>
              One of my favorite things about walking around and sitting at a
              cafe in the real world is how we can share space with other people
              in low-pressure environments. We share a look with a stranger when
              something funny happens or rise to the occasion when someone
              trips. Sometimes these spontaneous encounters become intimate
              conversations that leave a mark on us even if we don't remember
              who they were or what we talked about.
            </p>

            <div className={styles.marginalia}>
              <p>
                The Internet has none of this. Online, we're forced to perform
                or consume. We're building an audience or we're stuck in the
                flood. We have all this life around us on the web, but we can't
                feel it. The opportunity for connection is still there, but we
                don't have the environment to engage with it in a natural way.
              </p>
              <aside className={styles.marginaliaAside}>
                <CoffeeMachine id="wewere-coffee" />
              </aside>
            </div>

            <p>
              <em>we were online</em> is an online multiplayer world—part game,
              artwork, and tool—that turns the existing Internet into a shared
              world by enabling us to see and affect each other and the pages we
              visit. Isolated browsing becomes the site of serendipitous
              encounters, websites become archives of our collective traces, and
              the Internet becomes more like a hometown we share and co-create.
            </p>

            <p>
              In this world, everything on the Internet becomes material for
              connection like{" "}
              <a
                href="https://news.spencer.place/p/ti-09-the-internet-is-one-big-video"
                target="_blank"
                rel="noopener noreferrer"
              >
                one big video game
              </a>
              . Built on{" "}
              <a
                href="https://playhtml.fun/"
                target="_blank"
                rel="noopener noreferrer"
              >
                playhtml
              </a>
              , an open-source library for creating shared experiences, anyone
              can design custom experiences that interact with the game from
              individual websites. Rather than one monolithic platform, I want
              millions of tiny internets to flourish each finding new ways to
              express care, whimsy, and joy digitally.
            </p>

            <p>
              Instead of a new social platform, I'm invested in helping the
              existing Internet we already live in{" "}
              <a
                href="https://news.spencer.place/p/alive-internet-theory"
                target="_blank"
                rel="noopener noreferrer"
              >
                come to life
              </a>{" "}
              with our presence—one we can shape together, piece by piece. Not
              as users, but as neighbors and stewards nurturing a home for
              generations to come.
            </p>
          </div>
        </section>
        <section className={`${styles.section} ${styles.bottomCta}`}>
          <a
            href="https://forms.gle/iX8Lfgcy3LW79EsRA"
            target="_blank"
            rel="noopener noreferrer"
            className={styles.cta}
          >
            sign up to try it!
          </a>
        </section>

        <section className={styles.section}>
          <AuraGuestbook id="wewere-online-guestbook" />
        </section>

        <section className={`${styles.section} ${styles.furtherReading}`}>
          <h2 className={styles.sectionHeading}>further reading</h2>
          <ul className={styles.linkList}>
            <li>
              <a
                href="https://news.spencer.place/p/alive-internet-theory"
                target="_blank"
                rel="noopener noreferrer"
              >
                alive internet theory
              </a>{" "}
              on how we'll never let the Internet die
            </li>
            <li>
              <a
                href="https://news.spencer.place/p/ti-09-the-internet-is-one-big-video"
                target="_blank"
                rel="noopener noreferrer"
              >
                the internet is one big video game
              </a>{" "}
              on how the Internet was meant to be a place to talk to one another
            </li>
            <li>
              <a
                href="https://news.spencer.place/p/ti-09-the-internet-is-one-big-video"
                target="_blank"
                rel="noopener noreferrer"
              >
                Perpetual motion machine
              </a>{" "}
              on searching for technology that propagates infinite cycles
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
