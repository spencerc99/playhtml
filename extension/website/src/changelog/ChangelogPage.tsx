// ABOUTME: Public changelog page for the we were online extension.
// ABOUTME: Renders release notes from extension/CHANGELOG.md with optional media.

import type { ChangelogBlock, ChangelogRelease } from "./changelog";
import {
  CHANGELOG_URL,
  isNavigationPathActive,
  LIVE_PORTRAIT_URL,
} from "../navigation";
import styles from "./ChangelogPage.module.scss";

interface Props {
  releases: ChangelogRelease[];
}

export function ChangelogPage({ releases }: Props) {
  const currentPath = window.location.pathname;

  return (
    <div className={styles.page}>
      <div className={styles.shell}>
        <nav className={styles.nav} aria-label="Site navigation">
          <a className={styles.wordmark} href="/">
            we were online
          </a>
          <div className={styles.navLinks}>
            <a
              aria-current={
                isNavigationPathActive(currentPath, LIVE_PORTRAIT_URL)
                  ? "page"
                  : undefined
              }
              className={styles.navLink}
              href={LIVE_PORTRAIT_URL}
            >
              live portrait
            </a>
            <a
              aria-current={
                isNavigationPathActive(currentPath, CHANGELOG_URL)
                  ? "page"
                  : undefined
              }
              className={styles.navLink}
              href={CHANGELOG_URL}
            >
              changelog
            </a>
          </div>
        </nav>

        <header className={styles.hero}>
          <h1 className={styles.title}>changelog</h1>
        </header>

        <main className={styles.releases}>
          {releases.map((release) => (
            <article className={styles.release} key={release.version}>
              <header className={styles.releaseMeta}>
                <h2 className={styles.version}>v{release.version}</h2>
                {release.date && <p className={styles.date}>{release.date}</p>}
              </header>
              <div className={styles.blocks}>
                {release.blocks.map((block, index) => (
                  <ChangelogBlockView block={block} key={index} />
                ))}
              </div>
            </article>
          ))}
        </main>
      </div>
    </div>
  );
}

function ChangelogBlockView({ block }: { block: ChangelogBlock }) {
  switch (block.type) {
    case "heading":
      return <h3 className={styles.heading}>{block.text}</h3>;
    case "bullet":
      return <p className={styles.bullet}>{block.text}</p>;
    case "paragraph":
      return <p className={styles.paragraph}>{block.text}</p>;
    case "image":
      return <img className={styles.media} src={block.src} alt={block.alt} />;
    case "video":
      return (
        <video
          className={`${styles.media} ${styles.video}`}
          src={block.src}
          title={block.title}
          controls
          preload="metadata"
        />
      );
  }
}
