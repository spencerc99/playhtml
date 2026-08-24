// ABOUTME: Full-width homepage link inviting visitors to board the Internet Commute.
// ABOUTME: Reveals an illustrated train once as the crossing enters the viewport.

import { useEffect, useRef, useState } from "react";
import trainIceUrl from "@extension/assets/train-ice.png";
import styles from "./TrainCrossing.module.scss";

export function TrainCrossing() {
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
            local · try the internet commute
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
        a slow train through the recent web — click to board with whoever's
        riding
      </span>
    </a>
  );
}
