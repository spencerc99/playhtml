// ABOUTME: Fixed settings panel rendering every VELLUM_PARAM_SPEC control, grouped by section, toggled by a gear button.
// ABOUTME: Text inputs (e.g. the domain filter) commit on blur/Enter so typing doesn't trigger a refetch per keystroke.
import { useEffect, useState } from "react";
import type { CSSProperties } from "react";
import { VELLUM_PARAM_SPEC } from "./settings";
import type { ParamSpec, VellumSettings } from "./settings";

interface VellumDevPanelProps {
  settings: VellumSettings;
  onChange: (next: VellumSettings) => void;
  onReset: () => void;
}

function groupSpecs(specs: ParamSpec[]): [string, ParamSpec[]][] {
  const order: string[] = [];
  const groups = new Map<string, ParamSpec[]>();
  for (const spec of specs) {
    if (!groups.has(spec.group)) {
      groups.set(spec.group, []);
      order.push(spec.group);
    }
    groups.get(spec.group)!.push(spec);
  }
  return order.map((group) => [group, groups.get(group)!]);
}

const GROUPED_SPECS = groupSpecs(VELLUM_PARAM_SPEC);

const inputStyle: CSSProperties = {
  width: "100%",
  fontFamily: "'Martian Mono', ui-monospace, monospace",
  fontSize: "11px",
  background: "rgba(255,255,255,0.6)",
  border: "1px solid rgba(60,50,40,0.25)",
  borderRadius: "4px",
  padding: "3px 5px",
  color: "#2c2822",
  boxSizing: "border-box",
};

function TextCommitInput({
  value,
  onCommit,
}: {
  value: string;
  onCommit: (value: string) => void;
}) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);

  return (
    <input
      type="text"
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => onCommit(draft)}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
      }}
      style={inputStyle}
    />
  );
}

export function VellumDevPanel({ settings, onChange, onReset }: VellumDevPanelProps) {
  const [open, setOpen] = useState(false);

  const update = (key: keyof VellumSettings, value: string | number | boolean) => {
    onChange({ ...settings, [key]: value } as VellumSettings);
  };

  return (
    <>
      <button
        onClick={() => setOpen((v) => !v)}
        aria-label="Toggle vellum settings"
        style={{
          position: "fixed",
          right: 16,
          bottom: 16,
          zIndex: 300,
          width: 34,
          height: 34,
          borderRadius: "50%",
          border: "1px solid rgba(60,50,40,0.25)",
          background: "rgba(250,247,240,0.92)",
          color: "#3d3833",
          fontSize: "16px",
          lineHeight: "32px",
          cursor: "pointer",
          isolation: "isolate",
        }}
      >
        ⚙
      </button>
      {open ? (
        <div
          style={{
            position: "fixed",
            right: 16,
            bottom: 60,
            zIndex: 300,
            width: 280,
            maxHeight: "80vh",
            overflowY: "auto",
            background: "rgba(250,247,240,0.96)",
            border: "1px solid rgba(60,50,40,0.2)",
            borderRadius: 10,
            padding: "12px",
            boxShadow: "0 10px 30px rgba(30,24,16,0.25)",
            isolation: "isolate",
            fontFamily: "'Martian Mono', ui-monospace, monospace",
          }}
        >
          {GROUPED_SPECS.map(([group, specs]) => (
            <div key={group} style={{ marginBottom: "14px" }}>
              <div
                style={{
                  fontSize: "10px",
                  letterSpacing: "0.08em",
                  textTransform: "uppercase",
                  color: "rgba(61,56,51,0.6)",
                  marginBottom: "6px",
                }}
              >
                {group}
              </div>
              {specs.map((spec) => {
                const value = settings[spec.key];
                return (
                  <div key={String(spec.key)} style={{ marginBottom: "8px" }}>
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        fontSize: "11px",
                        color: "#2c2822",
                        marginBottom: "3px",
                      }}
                    >
                      <span>{spec.label}</span>
                      {spec.control.type === "slider" ? (
                        <span style={{ opacity: 0.6 }}>{String(value)}</span>
                      ) : null}
                    </div>
                    {spec.control.type === "slider" ? (
                      <input
                        type="range"
                        min={spec.control.min}
                        max={spec.control.max}
                        step={spec.control.step}
                        value={value as number}
                        onChange={(e) => update(spec.key, Number(e.target.value))}
                        style={{ width: "100%" }}
                      />
                    ) : spec.control.type === "select" ? (
                      <select
                        value={value as string}
                        onChange={(e) => update(spec.key, e.target.value)}
                        style={inputStyle}
                      >
                        {spec.control.options.map((opt) => (
                          <option key={opt} value={opt}>
                            {opt}
                          </option>
                        ))}
                      </select>
                    ) : spec.control.type === "toggle" ? (
                      <input
                        type="checkbox"
                        checked={value as boolean}
                        onChange={(e) => update(spec.key, e.target.checked)}
                      />
                    ) : spec.control.type === "color" ? (
                      <input
                        type="color"
                        value={value as string}
                        onChange={(e) => update(spec.key, e.target.value)}
                        style={{ width: "100%", height: "24px", border: "none", padding: 0 }}
                      />
                    ) : (
                      <TextCommitInput
                        value={value as string}
                        onCommit={(v) => update(spec.key, v)}
                      />
                    )}
                  </div>
                );
              })}
            </div>
          ))}
          <button
            onClick={onReset}
            style={{
              width: "100%",
              marginTop: "6px",
              padding: "6px",
              fontSize: "11px",
              fontFamily: "'Martian Mono', ui-monospace, monospace",
              background: "rgba(60,50,40,0.08)",
              border: "1px solid rgba(60,50,40,0.25)",
              borderRadius: "6px",
              cursor: "pointer",
              color: "#2c2822",
            }}
          >
            reset all
          </button>
        </div>
      ) : null}
    </>
  );
}
