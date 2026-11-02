// ABOUTME: Provides the copy-paste React source for the prize wheel recipe.
// ABOUTME: Re-renders every frame while a spin is turning; the spin itself is shared data.
import { prizeWheelCss, prizeWheelTypedHelpers } from "../demo-shared";
import { appShell } from "./app-shell";

export const prizeWheelReactSource = `import { useEffect, useState, type CSSProperties } from "react";
import { PlayProvider, withSharedState } from "@playhtml/react";

type Spin = { startedAt: number; target: number };

${prizeWheelTypedHelpers}

const PrizeWheel = withSharedState(
  { id: "prize-wheel", defaultData: { spin: null as Spin | null } },
  ({ data, setData }) => {
    const { spin } = data;
    const [now, setNow] = useState(Date.now);

    // The data only changes when someone spins, so re-render every frame
    // while the wheel turns.
    useEffect(() => {
      if (!spin) return;
      let frame: number;
      const tick = () => {
        setNow(Date.now());
        if (Date.now() - spin.startedAt < SPIN_MS) {
          frame = requestAnimationFrame(tick);
        }
      };
      frame = requestAnimationFrame(tick);
      return () => cancelAnimationFrame(frame);
    }, [spin]);

    const spinning = spin !== null && now - spin.startedAt < SPIN_MS;
    const landed = spin && !spinning ? PAGES[spin.target] : null;

    return (
      <>
        <div className="pointer" />
        <div
          className="wheel"
          style={{ transform: \`rotate(\${wheelAngle(spin, now)}deg)\` }}
        >
          {PAGES.map((page, i) => (
            <span
              key={page.label}
              style={{ "--angle": \`\${labelAngle(i)}deg\` } as CSSProperties}
            >
              {page.label}
            </span>
          ))}
        </div>
        <button
          disabled={spinning}
          onClick={() => setData({ spin: newSpin() })}
        >
          {spinning ? "Spinning…" : "Spin"}
        </button>
        {landed && <a href={landed.href}>{landed.label} →</a>}
      </>
    );
  },
);

${appShell("PrizeWheel", prizeWheelCss)}`;
