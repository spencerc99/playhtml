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
  onBack?: () => void;
  embedded?: boolean;
};

function stageLabel(stage: FeatureStage): string {
  if (stage === "internal") return "Internal";
  if (stage === "released") return "Released";
  return "Early access";
}

export function DeveloperFeaturesPage({ onBack, embedded = false }: Props) {
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

  // Choices persist across access changes, so only count the ones for
  // experiments this page currently shows.
  const visibleChoiceCount = states
    ? FEATURE_IDS.filter(
        (feature) =>
          overrides[feature] !== undefined &&
          states[feature].available &&
          states[feature].stage !== "released",
      ).length
    : 0;

  const intro = (
    <p>
      Experiments available to you are on. Turn off any you do not want; your
      choices only affect this browser.
    </p>
  );

  const toggleFeature = async (feature: FeatureId) => {
    if (!states) return;
    await setFeatureOverride(feature, !states[feature].enabled);
    await load();
  };

  return (
    <div className="developer-features">
      {!embedded && (
        <header className="developer-features__header">
          {onBack && (
            <button className="developer-features__back" onClick={onBack}>
              ← back
            </button>
          )}
          <span className="developer-features__eyebrow">WWO EXPERIMENTS</span>
          <h1>Experiments</h1>
          {intro}
        </header>
      )}
      {embedded && <div className="developer-features__intro">{intro}</div>}

      <main className="developer-features__list">
        {states &&
          FEATURE_IDS.filter(
            (feature) =>
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
                    {stageLabel(state.stage)}
                    {state.source === "choice" ? " · your choice" : ""}
                    {definition.requiresReload
                      ? " · reload pages after changing"
                      : ""}
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
          disabled={visibleChoiceCount === 0}
          onClick={async () => {
            await clearFeatureOverrides();
            await load();
          }}
        >
          Reset choices
        </button>
        <span>{visibleChoiceCount} choices</span>
      </footer>
    </div>
  );
}

export function DeveloperFeaturesSection() {
  return <DeveloperFeaturesPage embedded />;
}
