import { withSharedState } from "@playhtml/react";
import { formatLargeNumber } from "./utils";
import "./ReactiveOrb.scss";

interface OrbProps {
  className: string;
  colorOffset?: number;
  id: string;
}

export const ReactiveOrb = withSharedState(
  { defaultData: { clicks: 0 } },
  ({ data, setData }, props: OrbProps) => {
    const { className, colorOffset = 0, id } = props;

    // Scale based on magnitude but cap it
    const magnitude = Math.floor(Math.log10(Math.max(data.clicks, 1)));
    const scaleMultiplier = Math.min(magnitude * 0.05, 0.4);

    // Color calculation based on clicks and offset
    const hue = (data.clicks * 20 + colorOffset) % 360;
    const saturation = 70;
    const lightness = 50 + (data.clicks % 20);

    const formatted = formatLargeNumber(data.clicks);
    const isLargeNumber = typeof formatted === "object";

    return (
      <div
        id={id}
        className={`floating-orb ${className}`}
        onClick={() => setData({ clicks: data.clicks + 1 })}
        style={{
          transform: `scale(${1 + scaleMultiplier})`,
          background: `hsl(${hue}, ${saturation}%, ${lightness}%)`,
          color: lightness > 60 ? "#000" : "#fff",
        }}
        title={`Total clicks: ${data.clicks.toLocaleString()}`}
      >
        {isLargeNumber ? (
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              lineHeight: "1",
            }}
          >
            <div style={{ fontSize: "0.9em" }}>{formatted.main}</div>
            <div style={{ fontSize: "0.5em", opacity: 0.8 }}>
              {formatted.suffix}
            </div>
          </div>
        ) : (
          formatted
        )}
      </div>
    );
  }
);
