// ABOUTME: Coded animation of an inhabited Wikipedia article for the homepage feature rows.
// ABOUTME: Drifting cursors, a remembered link, a selection highlight, and article chat — all CSS keyframes.

import styles from "./WikipediaDemo.module.scss";

function CursorArrow({ color }: { color: string }) {
  return (
    <svg
      className={styles.cursorArrow}
      viewBox="0 0 24 24"
      aria-hidden="true"
      focusable="false"
    >
      <path
        d="M5.5 3.21V20.8c0 .45.54.67.85.35l4.86-4.86h6.3c.45 0 .67-.54.35-.85L5.86 3.21z"
        fill={color}
        stroke="#faf7f2"
        strokeWidth="1"
      />
    </svg>
  );
}

export function WikipediaDemo() {
  return (
    <div className={styles.stage} aria-hidden="true">
      <h4 className={styles.articleTitle}>Rabbit hole</h4>
      <p className={styles.articleBody}>
        A <span className={styles.rememberedLink}>metaphor</span> for a chain of
        events that leads somewhere unexpected, usually far from where you
      </p>
      <p className={styles.articleBody}>
        started. The phrase describes anything{" "}
        <span className={styles.selection}>absorbing to explore</span> long past
        the point you meant to stop.
      </p>

      <span className={`${styles.cursor} ${styles.cursorMira}`}>
        <CursorArrow color="#4a9a8a" />
        <span className={`${styles.cursorName} ${styles.cursorNameMira}`}>
          mira
        </span>
      </span>

      <span className={`${styles.cursor} ${styles.cursorSol}`}>
        <CursorArrow color="#c4724e" />
        <span className={`${styles.cursorName} ${styles.cursorNameSol}`}>
          sol
        </span>
      </span>

      <span className={styles.chatBubble}>
        <span className={styles.chatName}>sol</span>
        <span className={styles.chatText}>down the hole we go</span>
      </span>

      <span className={styles.chatHint}>press / to chat</span>
    </div>
  );
}
