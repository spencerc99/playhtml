// ABOUTME: CSS injected into the emote shadow root — the radial wheel layout only.
// ABOUTME: Gesture keyframes for cursor animation live in cursor-gestures.styles.ts (light DOM).

export const EMOTES_CSS = `
:host { all: initial; }
.emote-wheel {
  position: fixed;
  z-index: 2147483645;
  font-family: "Martian Mono", ui-monospace, monospace;
}
/* Soft-minimal + ink: a quiet paper disc, no hard border, faint inner guides. */
.emote-ring {
  position: absolute;
  border-radius: 50%;
  background: #f5f0e8;
  box-shadow:
    inset 0 0 0 1px rgba(61, 56, 51, 0.1),
    inset 0 0 0 33px rgba(61, 56, 51, 0),
    0 10px 30px rgba(61, 56, 51, 0.16);
}
/* second faint guide ring, drawn as a pseudo-inset via a radial highlight */
.emote-ring::after {
  content: "";
  position: absolute;
  inset: 32px;
  border-radius: 50%;
  border: 1px solid rgba(61, 56, 51, 0.08);
}
.emote-item {
  position: absolute;
  width: 46px;
  height: 46px;
  border-radius: 50%;
  border: none;
  background: transparent;
  cursor: pointer;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  color: #3d3833;
  padding: 0;
  transition: transform 0.12s cubic-bezier(0.34, 1.56, 0.64, 1),
    background 0.12s ease, color 0.12s ease;
}
.emote-item:hover {
  transform: scale(1.16);
  background: #eaf5f2;
  color: #0f6e56;
  box-shadow: 0 0 0 2px #4a9a8a;
}
.emote-item .glyph {
  display: flex;
  align-items: center;
  justify-content: center;
  line-height: 0;
}
.emote-item .glyph svg {
  display: block;
}
.emote-item .key {
  position: absolute;
  bottom: -1px;
  right: 2px;
  opacity: 0.5;
  font-size: 0.55rem;
}

@keyframes emote-wheel-open {
  from { opacity: 0; transform: scale(0.8); }
  to { opacity: 1; transform: scale(1); }
}
@keyframes emote-item-pop {
  from { opacity: 0; transform: scale(0); }
  to { opacity: 1; transform: scale(1); }
}

/* Once-per-session proximity hint (ReactHint) — teaches the shortcut near the cursor. */
.emote-react-hint {
  position: fixed;
  z-index: 2147483646;
  pointer-events: none;
  font-family: "Martian Mono", ui-monospace, monospace;
  font-size: 11px;
  color: #3d3833;
  background: #f5f0e8;
  border: 1px solid rgba(61, 56, 51, 0.15);
  border-radius: 8px;
  padding: 5px 10px;
  box-shadow: 0 4px 14px rgba(61, 56, 51, 0.18);
  opacity: 0;
  transform: translateY(4px);
  transition: opacity 0.25s ease, transform 0.25s ease;
  white-space: nowrap;
}
.emote-react-hint.visible {
  opacity: 0.95;
  transform: translateY(0);
}
.emote-react-hint kbd {
  font-family: inherit;
  font-size: 10px;
  border: 1px solid rgba(61, 56, 51, 0.3);
  border-radius: 4px;
  padding: 1px 4px;
  margin: 0 2px;
  background: rgba(255, 255, 255, 0.5);
}
`;
