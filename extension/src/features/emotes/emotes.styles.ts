// ABOUTME: CSS injected into the emote shadow root — wheel layout + all 10 emote keyframes.
// ABOUTME: emote-wave/dance/spin are ported verbatim from spencers-website global.scss.

export const EMOTES_CSS = `
:host { all: initial; }
.emote-wheel {
  position: fixed;
  z-index: 2147483645;
  font-family: "Martian Mono", ui-monospace, monospace;
}
.emote-ring {
  position: absolute;
  border-radius: 50%;
  background: rgba(245, 240, 232, 0.85);
  box-shadow: 0 0 2px 0 rgba(0, 0, 0, 0.25);
}
.emote-item {
  position: absolute;
  width: 44px;
  height: 44px;
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
  transition: transform 0.1s ease, background 0.1s ease;
}
.emote-item:hover {
  transform: scale(1.15);
  background: rgba(74, 154, 138, 0.15);
}
.emote-item .glyph {
  font-size: 0.8rem;
  line-height: 1;
  white-space: pre;
}
.emote-item .key {
  opacity: 0.5;
  font-size: 0.6rem;
  margin-top: 2px;
}

.emote-node {
  position: fixed;
  z-index: 2147483644;
  pointer-events: none;
  transform-origin: top left;
}
.emote-glyph {
  font-family: "Martian Mono", ui-monospace, monospace;
  font-size: 1rem;
  white-space: pre;
}

@keyframes emote-wheel-open {
  from { opacity: 0; transform: scale(0.8); }
  to { opacity: 1; transform: scale(1); }
}
@keyframes emote-item-pop {
  from { opacity: 0; transform: scale(0); }
  to { opacity: 1; transform: scale(1); }
}

@keyframes emote-wave {
  0% { transform: scale(2) rotate(0deg); }
  25% { transform: scale(2) rotate(20deg); }
  50% { transform: scale(2) rotate(-15deg); }
  75% { transform: scale(2) rotate(10deg); }
  100% { transform: scale(1) rotate(0deg); }
}
@keyframes emote-dance {
  0% { transform: scale(2) translateX(0) rotate(0deg); }
  10% { transform: scale(2) translateX(-15px) rotate(-15deg); }
  20% { transform: scale(2) translateX(-15px) rotate(-10deg); }
  30% { transform: scale(2) translateX(-15px) rotate(-15deg); }
  40% { transform: scale(2) translateX(0) rotate(0deg); }
  50% { transform: scale(2) translateX(15px) rotate(15deg); }
  60% { transform: scale(2) translateX(15px) rotate(10deg); }
  70% { transform: scale(2) translateX(15px) rotate(15deg); }
  80% { transform: scale(1.8) translateX(5px) rotate(5deg); }
  90% { transform: scale(1.4) translateX(0) rotate(0deg); }
  100% { transform: scale(1) translateX(0) rotate(0deg); }
}
@keyframes emote-spin {
  0% { transform: scale(2) translateY(0) rotate(0deg); }
  20% { transform: scale(2) translateY(-12px) rotate(80deg); }
  35% { transform: scale(2) translateY(-16px) rotate(200deg); }
  50% { transform: scale(2) translateY(-4px) rotate(280deg); }
  65% { transform: scale(2) translateY(0) rotate(360deg); }
  80% { transform: scale(1.6) translateY(0) rotate(360deg); }
  90% { transform: scale(1.3) translateY(0) rotate(360deg); }
  100% { transform: scale(1) translateY(0) rotate(360deg); }
}
@keyframes emote-heart {
  0% { transform: translateY(0) scale(1); opacity: 1; }
  100% { transform: translateY(-40px) scale(1.6); opacity: 0; }
}
@keyframes emote-sparkle {
  0% { transform: scale(0.6) rotate(0deg); opacity: 0.2; }
  50% { transform: scale(1.4) rotate(90deg); opacity: 1; }
  100% { transform: scale(1) rotate(180deg); opacity: 0; }
}
@keyframes emote-sleepy {
  0% { transform: rotate(0deg); opacity: 1; }
  40% { transform: rotate(12deg) translateY(4px); }
  100% { transform: rotate(20deg) translateY(10px); opacity: 0.4; }
}
@keyframes emote-note {
  0% { transform: translateY(0) rotate(0deg); opacity: 1; }
  50% { transform: translateY(-18px) rotate(-10deg); opacity: 1; }
  100% { transform: translateY(-36px) rotate(10deg); opacity: 0; }
}
@keyframes emote-highfive {
  0% { transform: scale(1) rotate(0deg); }
  40% { transform: scale(1.4) rotate(-20deg); }
  60% { transform: scale(1.5) rotate(10deg); }
  100% { transform: scale(1) rotate(0deg); }
}
@keyframes emote-nuzzle {
  0% { transform: translate(0, 0) rotate(0deg); }
  33% { transform: translate(8px, -4px) rotate(-12deg); }
  66% { transform: translate(-8px, -4px) rotate(12deg); }
  100% { transform: translate(0, 0) rotate(0deg); }
}
@keyframes emote-poke {
  0% { transform: translateX(0); }
  30% { transform: translateX(14px); }
  60% { transform: translateX(-4px); }
  100% { transform: translateX(0); }
}
`;
