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
  background: #f5f0e8;
  border: 1px solid rgba(61, 56, 51, 0.18);
  box-shadow: 0 8px 28px rgba(61, 56, 51, 0.28), 0 2px 6px rgba(61, 56, 51, 0.18);
}
.emote-item {
  position: absolute;
  width: 46px;
  height: 46px;
  border-radius: 50%;
  border: 1px solid rgba(61, 56, 51, 0.15);
  background: #fffdf9;
  cursor: pointer;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  color: #3d3833;
  padding: 0;
  box-shadow: 0 1px 3px rgba(61, 56, 51, 0.2);
  transition: transform 0.1s ease, background 0.1s ease, box-shadow 0.1s ease;
}
.emote-item:hover {
  transform: scale(1.18);
  background: #eaf5f2;
  border-color: #4a9a8a;
  box-shadow: 0 3px 8px rgba(74, 154, 138, 0.4);
}
.emote-item .glyph {
  font-size: 0.9rem;
  line-height: 1;
  white-space: pre;
  font-weight: 600;
}
.emote-item .key {
  opacity: 0.55;
  font-size: 0.58rem;
  margin-top: 1px;
}

.emote-node {
  position: fixed;
  z-index: 2147483644;
  pointer-events: none;
  transform-origin: top left;
}
.emote-glyph {
  font-family: "Martian Mono", ui-monospace, monospace;
  font-size: 1.15rem;
  font-weight: 700;
  white-space: pre;
  color: #3d3833;
  text-shadow: 0 0 3px #faf7f2, 0 0 3px #faf7f2, 0 1px 2px rgba(0, 0, 0, 0.3);
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
