// Docs demo for the loading attributes: pick a loading-behavior and
// loading-style and see how an element looks (and whether it takes clicks)
// before its data arrives. It applies playhtml's real loading CSS to a plain
// button, so nothing here syncs or registers with playhtml.
import React, { useState } from "react";

const BEHAVIORS = ["animate", "hidden", "none"] as const;
const STYLES = ["breathing", "pulse", "fade", "none"] as const;

type Behavior = (typeof BEHAVIORS)[number];
type Style = (typeof STYLES)[number];

function Choice<T extends string>({
  label,
  options,
  value,
  onChange,
  disabled,
}: {
  label: string;
  options: readonly T[];
  value: T;
  onChange: (value: T) => void;
  disabled?: boolean;
}) {
  return (
    <div className="ph-loading-demo__choice" role="group" aria-label={label}>
      <span className="ph-loading-demo__choice-label">{label}</span>
      {options.map((option) => (
        <button
          key={option}
          type="button"
          className="ph-loading-demo__option"
          aria-pressed={value === option}
          disabled={disabled}
          onClick={() => onChange(option)}
        >
          {option}
        </button>
      ))}
    </div>
  );
}

export function LoadingStateDemo() {
  const [behavior, setBehavior] = useState<Behavior>("animate");
  const [style, setStyle] = useState<Style>("breathing");
  const [loading, setLoading] = useState(true);
  const [count, setCount] = useState(12);

  const styleApplies = behavior === "animate";
  // loading-behavior="none" and loading-style="none" both leave the element
  // clickable while it loads.
  const clickable = behavior === "none" || (styleApplies && style === "none");
  const attributes = [`loading-behavior="${behavior}"`];
  if (styleApplies) attributes.push(`loading-style="${style}"`);

  return (
    <div className="ph-loading-demo">
      <div className="ph-loading-demo__controls">
        <Choice
          label="loading-behavior"
          options={BEHAVIORS}
          value={behavior}
          onChange={setBehavior}
        />
        <Choice
          label="loading-style"
          options={STYLES}
          value={style}
          onChange={setStyle}
          disabled={!styleApplies}
        />
      </div>

      <div className="ph-loading-demo__stage">
        <button
          type="button"
          className={`ph-toggle ph-loading-demo__sample${
            loading ? " playhtml-loading" : ""
          }`}
          loading-behavior={behavior}
          loading-style={styleApplies ? style : undefined}
          aria-busy={loading || undefined}
          onClick={() => setCount((n) => n + 1)}
        >
          <span aria-hidden="true">♥</span> {count}
        </button>
        <p className="ph-loading-demo__hint">
          {loading
            ? behavior === "hidden"
              ? "Loading: hidden until the data is in."
              : clickable
                ? "Loading, but clickable: clicks change the default value."
                : "Loading: clicks are ignored until the data is in."
            : "Loaded: click to add a heart."}
        </p>
      </div>

      <div className="ph-loading-demo__footer">
        <code className="ph-loading-demo__code">{`<button can-play ${attributes.join(" ")}>`}</code>
        <button
          type="button"
          className="ph-loading-demo__option"
          aria-pressed={!loading}
          onClick={() => setLoading((value) => !value)}
        >
          {loading ? "finish loading" : "load again"}
        </button>
      </div>
      {!styleApplies && (
        <p className="ph-loading-demo__note">
          loading-style only applies with loading-behavior="animate".
        </p>
      )}
    </div>
  );
}
