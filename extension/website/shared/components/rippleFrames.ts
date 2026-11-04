// ABOUTME: Shares one animation frame among active SVG click ripples.
// ABOUTME: Removes settled ripples from frame work while retaining their marks.

type RippleFrame = (now: number) => boolean;
const frames = new Set<RippleFrame>();
let animationFrame: number | undefined;

function tick() {
  const now = Date.now();
  for (const frame of frames) {
    if (!frame(now)) frames.delete(frame);
  }
  animationFrame = undefined;
  if (frames.size > 0) animationFrame = requestAnimationFrame(tick);
}

export function subscribeRippleFrame(frame: RippleFrame): () => void {
  frames.add(frame);
  if (animationFrame === undefined) {
    animationFrame = requestAnimationFrame(tick);
  }
  return () => {
    frames.delete(frame);
    if (frames.size === 0 && animationFrame !== undefined) {
      cancelAnimationFrame(animationFrame);
      animationFrame = undefined;
    }
  };
}
