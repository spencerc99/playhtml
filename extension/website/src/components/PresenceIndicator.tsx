// ABOUTME: Sticky pill showing colored dots for each connected visitor.
// ABOUTME: Uses playhtml cursor awareness to display real-time presence.

import { usePlayContext } from "@playhtml/react";
import styles from "./PresenceIndicator.module.scss";

const MAX_VISIBLE_DOTS = 12;

export function PresenceIndicator() {
  const { cursors } = usePlayContext();
  const visitors = cursors.allColors;

  if (visitors.length === 0) return null;

  const visible = visitors.slice(0, MAX_VISIBLE_DOTS);
  const overflow = visitors.length - MAX_VISIBLE_DOTS;

  return (
    <div className={styles.pill}>
      <span className={styles.count}>{visitors.length}</span>
      <div className={styles.dots}>
        {visible.map((color, index) => {
          const hasDuplicate = visible.filter((c) => c === color).length > 1;
          const key = hasDuplicate ? `${color}-${index}` : color;
          return (
            <div key={key} className={styles.dotWrapper}>
              {index === 0 && <span className={styles.youLabel}>you</span>}
              <div
                className={`${styles.dot} ${index === 0 ? styles.dotYou : ""}`}
                style={{ backgroundColor: color }}
              />
            </div>
          );
        })}
        {overflow > 0 && (
          <span className={styles.overflow}>+{overflow}</span>
        )}
      </div>
    </div>
  );
}
