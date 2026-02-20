// ABOUTME: Standalone portrait card component showing browsing stats for a domain
// ABOUTME: Supports full (dark poster) and compact (translucent overlay) layouts

import React from "react";

export interface PortraitCardProps {
  domain: string;
  totalTimeMs: number | null;
  eventCounts: {
    cursor: number;
    keyboard: number;
    viewport: number;
  };
  dateRange: { oldest: string; newest: string } | null;
  uniquePageCount: number;
  /** Compact translucent overlay mode for embedding over animations */
  compact?: boolean;
}

export function formatDuration(ms: number): string {
  const totalMinutes = Math.floor(ms / 60_000);
  if (totalMinutes < 1) return "< 1 min";
  if (totalMinutes < 60) return `${totalMinutes} min`;
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (minutes === 0) return `${hours} hr${hours !== 1 ? "s" : ""}`;
  return `${hours} hr${hours !== 1 ? "s" : ""} ${minutes} min`;
}

export function formatDateRange(oldest: string, newest: string): string {
  const start = new Date(oldest);
  const end = new Date(newest);
  const monthNames = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  const startMonth = monthNames[start.getMonth()];
  const endMonth = monthNames[end.getMonth()];
  const startYear = start.getFullYear();
  const endYear = end.getFullYear();
  if (startYear === endYear && start.getMonth() === end.getMonth()) return `${endMonth} ${endYear}`;
  if (startYear === endYear) return `${startMonth}\u2013${endMonth} ${endYear}`;
  return `${startMonth} ${startYear}\u2013${endMonth} ${endYear}`;
}

function formatCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return n.toLocaleString();
}

// ─── Full (poster) layout ─────────────────────────────────────────────────────

const DARK_BG = "#3d3833";
const DARK_SURFACE = "#4a4440";
const CREAM = "#faf7f2";
const CREAM_MUTED = "rgba(250, 247, 242, 0.55)";
const CREAM_FAINT = "rgba(250, 247, 242, 0.3)";
const ACCENT_TEAL = "#4a9a8a";

const fullStyles = {
  card: {
    width: "380px",
    backgroundColor: DARK_BG,
    color: CREAM,
    borderRadius: "12px",
    padding: "28px 28px 24px",
    boxSizing: "border-box" as const,
    fontFamily: "'Atkinson Hyperlegible', -apple-system, BlinkMacSystemFont, sans-serif",
    position: "relative" as const,
    boxShadow: "0 8px 32px rgba(0, 0, 0, 0.4)",
  },
  header: { display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "32px" },
  domain: { fontSize: "15px", fontWeight: 600, color: CREAM, letterSpacing: "0.01em", lineHeight: 1.2, maxWidth: "280px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" as const },
  heroSection: { textAlign: "center" as const, marginBottom: "32px" },
  heroNumber: { fontFamily: "'Lora', Georgia, serif", fontSize: "48px", fontWeight: 700, color: CREAM, lineHeight: 1.1, letterSpacing: "-0.02em" },
  heroLabel: { fontSize: "12px", color: CREAM_MUTED, textTransform: "uppercase" as const, letterSpacing: "0.12em", marginTop: "6px" },
  heroSubnote: { fontSize: "11px", color: CREAM_FAINT, marginTop: "4px", fontStyle: "italic" },
  statGrid: { display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "1px", backgroundColor: CREAM_FAINT, borderRadius: "8px", overflow: "hidden", marginBottom: "28px" },
  statCell: { backgroundColor: DARK_SURFACE, padding: "14px 12px", textAlign: "center" as const },
  statNumber: { fontFamily: "'Martian Mono', 'Space Mono', 'Courier New', monospace", fontSize: "20px", fontWeight: 600, color: CREAM, lineHeight: 1.2, letterSpacing: "-0.02em" },
  statLabel: { fontSize: "10px", color: CREAM_MUTED, textTransform: "uppercase" as const, letterSpacing: "0.1em", marginTop: "4px", lineHeight: 1.3 },
  footer: { display: "flex", justifyContent: "space-between", alignItems: "flex-end" },
  wordmark: { fontFamily: "'Source Serif 4', 'Lora', Georgia, serif", fontStyle: "italic", fontWeight: 200, fontSize: "16px", color: ACCENT_TEAL, letterSpacing: "0.01em" },
  tealDot: { width: "6px", height: "6px", borderRadius: "50%", backgroundColor: ACCENT_TEAL, display: "inline-block", marginRight: "6px", verticalAlign: "middle", position: "relative" as const, top: "-1px" },
} as const;

// ─── Compact (overlay) layout ─────────────────────────────────────────────────

const compactStyles = {
  card: {
    position: "absolute" as const,
    inset: 0,
    display: "flex",
    flexDirection: "column" as const,
    justifyContent: "center",
    padding: "14px 16px",
    background: "rgba(61, 56, 51, 0.55)",
    backdropFilter: "blur(6px)",
    WebkitBackdropFilter: "blur(6px)",
    fontFamily: "'Atkinson Hyperlegible', -apple-system, BlinkMacSystemFont, sans-serif",
    color: CREAM,
  },
  domain: {
    fontSize: "11px",
    fontWeight: 600,
    color: "rgba(250, 247, 242, 0.7)",
    letterSpacing: "0.06em",
    textTransform: "uppercase" as const,
    marginBottom: "6px",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap" as const,
  },
  heroRow: {
    display: "flex",
    alignItems: "baseline",
    gap: "6px",
    marginBottom: "10px",
  },
  heroNumber: {
    fontFamily: "'Lora', Georgia, serif",
    fontSize: "32px",
    fontWeight: 700,
    color: CREAM,
    lineHeight: 1,
    letterSpacing: "-0.02em",
  },
  heroLabel: {
    fontSize: "11px",
    color: "rgba(250, 247, 242, 0.6)",
    textTransform: "uppercase" as const,
    letterSpacing: "0.08em",
  },
  statRow: {
    display: "flex",
    gap: "16px",
  },
  statItem: {
    display: "flex",
    flexDirection: "column" as const,
    gap: "1px",
  },
  statNumber: {
    fontFamily: "'Martian Mono', 'Space Mono', 'Courier New', monospace",
    fontSize: "14px",
    fontWeight: 600,
    color: CREAM,
    lineHeight: 1.2,
  },
  statLabel: {
    fontSize: "9px",
    color: "rgba(250, 247, 242, 0.5)",
    textTransform: "uppercase" as const,
    letterSpacing: "0.08em",
  },
} as const;

// ─── Component ────────────────────────────────────────────────────────────────

export function PortraitCard({
  domain,
  totalTimeMs,
  eventCounts,
  dateRange,
  uniquePageCount,
  compact = false,
}: PortraitCardProps) {
  const heroText = totalTimeMs !== null ? formatDuration(totalTimeMs) : "\u2014";
  const dateLabel = dateRange ? formatDateRange(dateRange.oldest, dateRange.newest) : null;

  if (compact) {
    return (
      <div style={compactStyles.card}>
        <div style={compactStyles.domain}>{domain}</div>
        <div style={compactStyles.heroRow}>
          <div style={compactStyles.heroNumber}>{heroText}</div>
          <div style={compactStyles.heroLabel}>time spent</div>
        </div>
        <div style={compactStyles.statRow}>
          <div style={compactStyles.statItem}>
            <div style={compactStyles.statNumber}>{formatCount(eventCounts.cursor)}</div>
            <div style={compactStyles.statLabel}>cursors</div>
          </div>
          <div style={compactStyles.statItem}>
            <div style={compactStyles.statNumber}>{formatCount(uniquePageCount)}</div>
            <div style={compactStyles.statLabel}>pages</div>
          </div>
          {dateLabel && (
            <div style={compactStyles.statItem}>
              <div style={compactStyles.statNumber}>{dateLabel}</div>
              <div style={compactStyles.statLabel}>since</div>
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div style={fullStyles.card}>
      <div style={fullStyles.header}>
        <div style={fullStyles.domain}>{domain}</div>
      </div>

      <div style={fullStyles.heroSection}>
        <div style={fullStyles.heroNumber}>{heroText}</div>
        <div style={fullStyles.heroLabel}>time spent</div>
        {totalTimeMs === null && (
          <div style={fullStyles.heroSubnote}>time tracking coming soon</div>
        )}
      </div>

      <div style={fullStyles.statGrid}>
        <div style={fullStyles.statCell}>
          <div style={fullStyles.statNumber}>{formatCount(eventCounts.cursor)}</div>
          <div style={fullStyles.statLabel}>cursor{"\n"}events</div>
        </div>
        <div style={fullStyles.statCell}>
          <div style={fullStyles.statNumber}>{formatCount(uniquePageCount)}</div>
          <div style={fullStyles.statLabel}>pages{"\n"}visited</div>
        </div>
        <div style={fullStyles.statCell}>
          <div style={fullStyles.statNumber}>{dateLabel ?? "\u2014"}</div>
          <div style={fullStyles.statLabel}>&nbsp;</div>
        </div>
      </div>

      <div style={fullStyles.footer}>
        <div style={fullStyles.wordmark}>
          <span style={fullStyles.tealDot} />
          we were online
        </div>
      </div>
    </div>
  );
}
