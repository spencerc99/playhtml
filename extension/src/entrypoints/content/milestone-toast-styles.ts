// ABOUTME: CSS string for the milestone toast shadow DOM.
// ABOUTME: Injected into a closed shadow root so host-page styles cannot bleed in or out.

export const MILESTONE_DURATION_MS = 15000;

export const MILESTONE_TOAST_CSS = `
.wwo-milestone-toast {
  background: #f5f0e8;
  border: 1px solid rgba(61, 56, 51, 0.12);
  border-radius: 10px;
  padding: 10px 13px 11px;
  width: 310px;
  box-shadow: 0 2px 12px rgba(61, 56, 51, 0.08);
  display: flex;
  flex-direction: column;
  gap: 0;
  position: relative;
  opacity: 0;
  transform: translateY(8px);
  transition: opacity 0.35s ease, transform 0.35s ease;
  pointer-events: none;
}

.wwo-milestone-toast.wwo-visible {
  opacity: 1;
  transform: translateY(0);
  pointer-events: auto;
}

.wwo-milestone-toast.wwo-hiding {
  opacity: 0;
  transform: translateY(4px);
}

.wwo-toast-wordmark {
  position: absolute;
  top: 9px;
  right: 12px;
  font-family: 'Source Serif 4', 'Lora', Georgia, serif;
  font-style: italic;
  font-weight: 300;
  font-size: 12px;
  color: rgba(61, 56, 51, 0.55);
  letter-spacing: -0.01em;
  line-height: 1;
  user-select: none;
}

.wwo-toast-body {
  display: flex;
  align-items: stretch;
  gap: 12px;
}

.wwo-toast-accent {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 4px;
  flex-shrink: 0;
  width: 50px;
  border-right: 1px solid rgba(61, 56, 51, 0.08);
  padding-right: 12px;
  overflow: visible;
}

.wwo-toast-stat {
  font-family: 'Martian Mono', monospace;
  font-size: 18px;
  font-weight: 400;
  color: #4a9a8a;
  line-height: 1;
  text-align: center;
}

.wwo-toast-stat-sm {
  font-size: 15px;
  line-height: 1.2;
}

.wwo-toast-unit {
  font-family: 'Martian Mono', monospace;
  font-size: 7.5px;
  font-weight: 300;
  color: #4a9a8a;
  text-transform: uppercase;
  letter-spacing: 0.07em;
  text-align: center;
}

.wwo-toast-text {
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 4px;
  flex: 1;
  padding-right: 32px;
}

.wwo-toast-badge {
  font-family: 'Martian Mono', monospace;
  font-size: 7px;
  font-weight: 300;
  text-transform: uppercase;
  letter-spacing: 0.09em;
  color: #faf7f2;
  border-radius: 3px;
  padding: 1.5px 4px;
  line-height: 1.3;
  width: fit-content;
}

.wwo-toast-badge.wwo-today   { background: #4a9a8a; }
.wwo-toast-badge.wwo-alltime { background: #c4724e; }

.wwo-toast-headline {
  font-family: 'Lora', Georgia, serif;
  font-size: 12.5px;
  font-style: italic;
  font-weight: 600;
  color: #3d3833;
  line-height: 1.45;
  margin: 0;
}

.wwo-toast-cta {
  font-family: 'Atkinson Hyperlegible', -apple-system, sans-serif;
  font-size: 10px;
  color: #4a9a8a;
  background: none;
  border: none;
  padding: 0;
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 3px;
  width: fit-content;
  text-decoration: none;
}

.wwo-toast-cta::after {
  content: '\\2192';
  font-size: 10px;
}

/* Cursor trail animation */
.wwo-cursor-trail {
  position: relative;
  width: 44px;
  height: 24px;
  overflow: visible;
  margin-bottom: 2px;
}

.wwo-cursor-svg {
  position: absolute;
  width: 11px;
  height: 11px;
}

.wwo-cursor-svg.wwo-c0 {
  animation: wwo-drift 4.5s ease-in-out infinite;
  filter: drop-shadow(0 0 2px rgba(74, 154, 138, 0.45));
}
.wwo-cursor-svg.wwo-c1 { animation: wwo-drift 4.5s ease-in-out infinite; animation-delay: -0.25s; opacity: 0.42; }
.wwo-cursor-svg.wwo-c2 { animation: wwo-drift 4.5s ease-in-out infinite; animation-delay: -0.5s;  opacity: 0.20; }
.wwo-cursor-svg.wwo-c3 { animation: wwo-drift 4.5s ease-in-out infinite; animation-delay: -0.75s; opacity: 0.09; }

@keyframes wwo-drift {
  0%   { transform: translate(-2px, 12px); }
  25%  { transform: translate(12px, 3px);  }
  55%  { transform: translate(30px, 14px); }
  78%  { transform: translate(40px, 5px);  }
  100% { transform: translate(-2px, 12px); }
}

/* Sparkline */
.wwo-sparkline {
  width: 40px;
  height: 18px;
  display: flex;
  align-items: flex-end;
  gap: 2px;
  margin-top: 4px;
}

.wwo-spark-bar {
  flex: 1;
  border-radius: 1.5px 1.5px 0 0;
  background: rgba(74, 154, 138, 0.2);
  min-height: 2px;
}

.wwo-spark-bar.wwo-current { background: #4a9a8a; }

/* Scatter dots (sites explored) */
.wwo-scatter {
  position: relative;
  width: 40px;
  height: 22px;
  margin-top: 4px;
}

/* Favicon (domain visits) */
.wwo-favicon-wrap {
  width: 26px;
  height: 26px;
  border-radius: 5px;
  overflow: hidden;
  background: rgba(74, 154, 138, 0.1);
  border: 1px solid rgba(74, 154, 138, 0.2);
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.wwo-favicon-img {
  width: 20px;
  height: 20px;
  object-fit: contain;
}

.wwo-favicon-fallback {
  font-family: 'Martian Mono', monospace;
  font-size: 13px;
  color: #4a9a8a;
  line-height: 1;
}
`;

/** Injects the Google Fonts needed by the toast into the document head, idempotently. */
export function ensureToastFonts(): void {
  const FONT_ID = "wwo-toast-fonts";
  if (document.getElementById(FONT_ID)) return;
  const link = document.createElement("link");
  link.id = FONT_ID;
  link.rel = "stylesheet";
  link.href =
    "https://fonts.googleapis.com/css2?family=Atkinson+Hyperlegible:wght@400&family=Lora:ital,wght@1,600&family=Martian+Mono:wght@300;400&family=Source+Serif+4:ital,wght@1,300&display=swap";
  document.head.appendChild(link);
}
