// ABOUTME: CSS injected into the light DOM (document.head) for cursor-native emote gestures.
// ABOUTME: Classes apply to the emote ghost (EmoteGhostRenderer) — a cursor-shaped node rendered for self and peers.

export const CURSOR_GESTURE_CSS = `
.emote-ghost {
  opacity: 0.85;
  transform-origin: center;
}

.cursor-gesture-wave {
  animation: gesture-wave 1500ms ease-out;
}
@keyframes gesture-wave {
  0% { transform: scale(2) rotate(0deg); }
  25% { transform: scale(2) rotate(20deg); }
  50% { transform: scale(2) rotate(-15deg); }
  75% { transform: scale(2) rotate(10deg); }
  100% { transform: scale(1) rotate(0deg); }
}

.cursor-gesture-dance {
  animation: gesture-dance 2000ms ease-out;
}
@keyframes gesture-dance {
  0% { transform: scale(2) translateX(0) rotate(0deg); }
  10% { transform: scale(2) translateX(-15px) rotate(-15deg); }
  20% { transform: scale(2) translateX(-15px) rotate(-10deg); }
  30% { transform: scale(2) translateX(-15px) rotate(-15deg); }
  40% { transform: scale(2) translateX(0) rotate(0deg); }
  50% { transform: scale(2) translateX(15px) rotate(15deg); }
  60% { transform: scale(2) translateX(15px) rotate(10deg); }
  70% { transform: scale(2) translateX(15px) rotate(15deg); }
  80% { transform: scale(2) translateX(5px) rotate(5deg); }
  90% { transform: scale(1.3) translateX(0) rotate(0deg); }
  100% { transform: scale(1) translateX(0) rotate(0deg); }
}

.cursor-gesture-spin {
  animation: gesture-spin 1000ms ease-out;
}
@keyframes gesture-spin {
  0% { transform: scale(2) translateY(0) rotate(0deg); }
  20% { transform: scale(2) translateY(-12px) rotate(80deg); }
  35% { transform: scale(2) translateY(-16px) rotate(200deg); }
  50% { transform: scale(2) translateY(-4px) rotate(280deg); }
  65% { transform: scale(2) translateY(0) rotate(360deg); }
  80% { transform: scale(1.6) translateY(0) rotate(360deg); }
  90% { transform: scale(1.2) translateY(0) rotate(360deg); }
  100% { transform: scale(1) translateY(0) rotate(360deg); }
}

.cursor-gesture-heart {
  position: relative;
  animation: gesture-heart-pulse 1500ms ease-out;
}
.cursor-gesture-heart::after {
  content: "\\2665";
  position: absolute;
  left: 50%;
  top: 0;
  color: #c4724e;
  font-size: 20px;
  pointer-events: none;
  animation: gesture-heart-particle 1500ms ease-out;
}
@keyframes gesture-heart-pulse {
  0% { transform: scale(1.6); }
  30% { transform: scale(2); }
  60% { transform: scale(1.7); }
  100% { transform: scale(1); }
}
@keyframes gesture-heart-particle {
  0% { transform: translate(-50%, 0) scale(1); opacity: 1; }
  100% { transform: translate(-50%, -40px) scale(1.6); opacity: 0; }
}

.cursor-gesture-sparkle {
  animation: gesture-sparkle-pop 1200ms ease-out;
}
.cursor-gesture-sparkle::after {
  content: "\\2726";
  position: absolute;
  left: 50%;
  top: 0;
  color: #d4b85c;
  font-size: 20px;
  pointer-events: none;
  animation: gesture-sparkle-particle 1200ms ease-out;
}
@keyframes gesture-sparkle-pop {
  0% { transform: scale(1.6); }
  50% { transform: scale(2); }
  100% { transform: scale(1); }
}
@keyframes gesture-sparkle-particle {
  0% { transform: translate(-50%, 0) scale(0.6) rotate(0deg); opacity: 0.2; }
  50% { transform: translate(-50%, -10px) scale(1.4) rotate(90deg); opacity: 1; }
  100% { transform: translate(-50%, -20px) scale(1) rotate(180deg); opacity: 0; }
}

.cursor-gesture-sleepy {
  position: relative;
  animation: gesture-sleepy-droop 2000ms ease-out;
}
.cursor-gesture-sleepy::after {
  content: "z";
  position: absolute;
  left: 100%;
  top: 0;
  color: #8a8279;
  font-size: 20px;
  pointer-events: none;
  animation: gesture-sleepy-particle 2000ms ease-out;
}
@keyframes gesture-sleepy-droop {
  0% { transform: scale(1.6) rotate(0deg) translateY(0); opacity: 1; }
  40% { transform: scale(1.8) rotate(12deg) translateY(4px); }
  100% { transform: scale(1) rotate(20deg) translateY(10px); opacity: 0.4; }
}
@keyframes gesture-sleepy-particle {
  0% { transform: translate(0, 0); opacity: 1; }
  100% { transform: translate(10px, -24px); opacity: 0; }
}

.cursor-gesture-note {
  position: relative;
  animation: gesture-note-sway 1500ms ease-out;
}
.cursor-gesture-note::after {
  content: "\\266A";
  position: absolute;
  left: 50%;
  top: 0;
  color: #5b8db8;
  font-size: 20px;
  pointer-events: none;
  animation: gesture-note-particle 1500ms ease-out;
}
@keyframes gesture-note-sway {
  0% { transform: scale(1.6) rotate(0deg); }
  25% { transform: scale(2) rotate(-8deg); }
  50% { transform: scale(1.8) rotate(0deg); }
  75% { transform: scale(2) rotate(8deg); }
  100% { transform: scale(1) rotate(0deg); }
}
@keyframes gesture-note-particle {
  0% { transform: translate(-50%, 0) rotate(0deg); opacity: 1; }
  50% { transform: translate(-50%, -18px) rotate(-10deg); opacity: 1; }
  100% { transform: translate(-50%, -36px) rotate(10deg); opacity: 0; }
}

.cursor-gesture-highfive {
  animation: gesture-highfive-reach 1200ms ease-out;
}
@keyframes gesture-highfive-reach {
  0% { transform: scale(1) rotate(0deg); }
  40% { transform: scale(2) rotate(-20deg); }
  60% { transform: scale(2) rotate(10deg); }
  100% { transform: scale(1) rotate(0deg); }
}

.cursor-gesture-nuzzle {
  animation: gesture-nuzzle-drift 1500ms ease-out;
}
@keyframes gesture-nuzzle-drift {
  0% { transform: scale(1) translate(0, 0) rotate(0deg); }
  33% { transform: scale(1.6) translate(8px, -4px) rotate(-12deg); }
  66% { transform: scale(1.6) translate(-8px, -4px) rotate(12deg); }
  100% { transform: scale(1) translate(0, 0) rotate(0deg); }
}

.cursor-gesture-poke {
  animation: gesture-poke-jab 1000ms ease-out;
}
@keyframes gesture-poke-jab {
  0% { transform: scale(1) translateX(0); }
  30% { transform: scale(1.6) translateX(14px); }
  60% { transform: scale(1.6) translateX(-4px); }
  100% { transform: scale(1) translateX(0); }
}
`;
