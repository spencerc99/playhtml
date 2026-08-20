// ABOUTME: Internal popup settings for inspecting and overriding extension features.
// ABOUTME: Shows every catalog feature with its effective source and reload requirements.

import { useCallback, useEffect, useState } from "react";
import {
  FEATURE_CATALOG,
  FEATURE_IDS,
  type FeatureId,
  type FeatureOverrides,
  type FeatureStage,
  type FeatureState,
} from "../flags";
import {
  clearFeatureOverrides,
  getAllFeatureStates,
  getFeatureOverrides,
  setFeatureOverride,
} from "../features/featureAccess";
import "./DeveloperFeaturesPage.scss";

type Props = {
  onBack: () => void;
};

const STAGE_LABELS: Record<FeatureStage, string> = {
  internal: "Internal",
  beta: "Early access",
  released: "Released",
};

export function DeveloperFeaturesPage({ onBack }: Props) {
  const [states, setStates] = useState<Record<FeatureId, FeatureState> | null>(
    null,
  );
  const [overrides, setOverrides] = useState<FeatureOverrides>({});

  const load = useCallback(async () => {
    const [nextStates, nextOverrides] = await Promise.all([
      getAllFeatureStates(),
      getFeatureOverrides(),
    ]);
    setStates(nextStates);
    setOverrides(nextOverrides);
  }, []);

  useEffect(() => {
    load().catch(() => {});
  }, [load]);

  const toggleFeature = async (feature: FeatureId) => {
    if (!states) return;
    await setFeatureOverride(feature, !states[feature].enabled);
    await load();
  };

  return (
    <div className="developer-features">
      <header className="developer-features__header">
        <button className="developer-features__back" onClick={onBack}>
          ← back
        </button>
        <span className="developer-features__eyebrow">WWO EXPERIMENTS</span>
        <h1>Experiments</h1>
        <p>
          Turn on the experiments available to you. Your choices only affect
          this browser.
        </p>
      </header>

      <main className="developer-features__list">
        {states && FEATURE_IDS.filter((feature) =>
          states[feature].available && states[feature].stage !== "released",
        ).map((feature) => {
          const definition = FEATURE_CATALOG[feature];
          const state = states[feature];
          return (
            <label className="developer-features__row" key={feature}>
              <span className="developer-features__copy">
                <strong>{definition.name}</strong>
                <span>{definition.description}</span>
                <small>
                  {STAGE_LABELS[state.stage]}
                  {state.source === "choice" ? " · your choice" : ""}
                  {definition.requiresReload ? " · reload pages after changing" : ""}
                </small>
              </span>
              <input
                type="checkbox"
                checked={state.enabled}
                onChange={() => toggleFeature(feature)}
                aria-label={`Enable ${definition.name}`}
              />
            </label>
          );
        })}
      </main>

      <footer className="developer-features__footer">
        <button
          disabled={Object.keys(overrides).length === 0}
          onClick={async () => {
            await clearFeatureOverrides();
            await load();
          }}
        >
          Reset choices
        </button>
        <span>{Object.keys(overrides).length} choices</span>
      </footer>
    </div>
  );
}
