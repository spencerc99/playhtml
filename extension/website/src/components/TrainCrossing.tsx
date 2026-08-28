// ABOUTME: Link inviting visitors to board the Internet Commute.
// ABOUTME: Reveals an illustrated train once as the crossing enters the viewport.

import { useEffect, useRef, useState } from "react";
import trainIceUrl from "@extension/assets/train-ice.png";
import styles from "./TrainCrossing.module.scss";

// "compact" pairs the train with a heading and blurb for use as the closing
// element inside a section; the default fills the page width on its own.
export function TrainCrossing({ variant = "band" }: { variant?: "band" | "compact" }) {
  const crossingRef = useRef<HTMLAnchorElement>(null);
  const [hasArrived, setHasArrived] = useState(() =>
    window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  );

  useEffect(() => {
    if (hasArrived) return;
    const crossing = crossingRef.current;
    if (!crossing) return;
    if (!("IntersectionObserver" in window)) {
      setHasArrived(true);
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        setHasArrived(true);
        observer.disconnect();
      },
      { threshold: 0.2 },
    );
    observer.observe(crossing);
    return () => observer.disconnect();
  }, [hasArrived]);

  if (variant === "compact") {
    return (
      <a
        ref={crossingRef}
        className={styles.compact}
        href="/commute"
        aria-label="Commute the internet"
      >
        <span className={styles.compactScene} aria-hidden="true">
          <span className={styles.railTop} />
          <span className={styles.railBottom} />
          <span className={styles.ties} />
          <span
            className={`${styles.compactTrain} ${
              hasArrived ? styles.compactTrainArrived : ""
            }`}
          >
            <img
              className={styles.trainIllustration}
              src={trainIceUrl}
              alt=""
            />
          </span>
        </span>
        <span className={styles.compactText}>
          <span className={styles.compactHeading}>commute the internet</span>
          <span className={styles.compactBody}>
            a slow train through the recent web. take a detour through the
            places that other people are headed.{" "}
            <b>Click to try an early version!</b>
          </span>
        </span>
      </a>
    );
  }

  return (
    <a
      ref={crossingRef}
      className={styles.crossing}
      href="/commute"
      aria-label="Board the internet commute"
    >
      <span className={styles.scene} aria-hidden="true">
        <span className={styles.railTop} />
        <span className={styles.railBottom} />
        <span className={styles.ties} />

        <span
          className={`${styles.train} ${hasArrived ? styles.trainArrived : ""}`}
        >
          <span className={styles.serviceLabel}>
            try the internet commute
          </span>
          <img
            className={styles.trainIllustration}
            src={trainIceUrl}
            alt=""
          />
        </span>

        <span className={styles.signal}>
          <span className={styles.signalSign}>
            next stop: somewhere new →
          </span>
          <span className={styles.signalPost} />
        </span>
      </span>
      <span className={styles.caption}>
        a slow train through the recent web
      </span>
    </a>
  );
}
