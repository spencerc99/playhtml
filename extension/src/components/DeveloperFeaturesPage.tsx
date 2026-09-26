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
import {
  BUILD_LICENSE_KEY,
  licenseStatus,
} from "../entrypoints/scraps/tldraw/tldrawLicense";
import "./DeveloperFeaturesPage.scss";

/**
 * Why an experiment cannot be turned on in this build, or null when it can.
 * The tldraw collage editor needs a license key baked into the build that is
 * still in date.
 */
function blockedReason(feature: FeatureId): string | null {
  if (feature !== "TLDRAW_COLLAGES") return null;
  const license = licenseStatus(BUILD_LICENSE_KEY);
  return license.usable ? null : license.message;
}

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
            const blocked = blockedReason(feature);
            return (
              <label className="developer-features__row" key={feature}>
                <span className="developer-features__copy">
                  <strong>{definition.name}</strong>
                  <span>{definition.description}</span>
                  {blocked && <span>{blocked}</span>}
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
                  checked={state.enabled && !blocked}
                  disabled={blocked !== null}
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
