// ABOUTME: Renders the popup controls and daily ride summary for Slow Mode.
// ABOUTME: Persists the global toggle and chance while exposing cooldown status.

import React, { useEffect, useMemo, useState } from "react";
import browser from "webextension-polyfill";
import {
  DEFAULT_SLOW_MODE_SETTINGS,
  SLOW_MODE_SETTINGS_KEY,
  SLOW_MODE_STATE_KEY,
  dayKey,
  getCooldownStatus,
  normalizeSlowModeSettings,
  normalizeSlowModeState,
  type SlowModeSettings as Settings,
  type SlowModeState,
} from "../features/slowMode/slowMode";

const EMPTY_STATE: SlowModeState = {
  farJumpCountByDay: {},
  lastCommuteAt: null,
  lastCommuteByDomain: {},
  rides: [],
};

function rideDescription(ride: SlowModeState["rides"][number]): string {
  if (ride.outcome === "teleported") {
    return `teleported to ${ride.destinationDomain}`;
  }
  if (ride.outcome === "left") {
    return `stepped off before ${ride.destinationDomain}`;
  }
  if (ride.outcome === "riding") {
    return `riding to ${ride.destinationDomain}`;
  }
  return `commuted to ${ride.destinationDomain}`;
}

export function SlowModeSettings() {
  const [settings, setSettings] = useState<Settings>(
    DEFAULT_SLOW_MODE_SETTINGS,
  );
  const [state, setState] = useState<SlowModeState>(EMPTY_STATE);
  const [loaded, setLoaded] = useState(false);
  const now = Date.now();

  useEffect(() => {
    browser.storage.local
      .get([SLOW_MODE_SETTINGS_KEY, SLOW_MODE_STATE_KEY])
      .then((stored) => {
        setSettings(normalizeSlowModeSettings(stored[SLOW_MODE_SETTINGS_KEY]));
        setState(normalizeSlowModeState(stored[SLOW_MODE_STATE_KEY]));
        setLoaded(true);
      })
      .catch(() => setLoaded(true));
  }, []);

  const today = dayKey(now);
  const ridesToday = useMemo(
    () => state.rides.filter((ride) => dayKey(ride.startedAt) === today),
    [state.rides, today],
  );
  const cooldown = getCooldownStatus(state, now);
  const cooldownMinutes = Math.ceil(cooldown.remainingMs / 60_000);

  const saveSettings = (next: Settings) => {
    setSettings(next);
    void browser.storage.local.set({ [SLOW_MODE_SETTINGS_KEY]: next });
  };

  return (
    <section className="slow-mode-settings" aria-label="Slow Mode settings">
      <div className="slow-mode-settings__heading">
        <span>
          <strong>slow mode</strong>
          <small>
            {cooldown.ready
              ? "ready for a far jump"
              : `cooldown · ${cooldownMinutes}m left`}
          </small>
        </span>
        <label className="slow-mode-toggle">
          <input
            type="checkbox"
            aria-label="Enable Slow Mode"
            checked={settings.enabled}
            disabled={!loaded}
            onChange={(event) =>
              saveSettings({ ...settings, enabled: event.target.checked })
            }
          />
          <span aria-hidden="true" />
        </label>
      </div>

      <label className="slow-mode-settings__chance">
        <span>
          <strong>how often you commute</strong>
          <output>{settings.chancePercent}%</output>
        </span>
        <input
          type="range"
          min="10"
          max="100"
          step="10"
          value={settings.chancePercent}
          disabled={!settings.enabled}
          onChange={(event) =>
            saveSettings({
              ...settings,
              chancePercent: Number(event.target.value),
            })
          }
        />
      </label>

      <div className="slow-mode-settings__today">
        <span className="slow-mode-settings__label">today</span>
        {ridesToday.length === 0 ? (
          <p>no rides yet. no judgment.</p>
        ) : (
          <ol>
            {ridesToday.slice(0, 3).map((ride) => (
              <li key={ride.id}>
                <time>
                  {new Date(ride.startedAt).toLocaleTimeString([], {
                    hour: "numeric",
                    minute: "2-digit",
                  })}
                </time>
                <span>
                  {rideDescription(ride)} · {ride.stopCount} stops
                </span>
              </li>
            ))}
          </ol>
        )}
        <footer>
          <span>{state.farJumpCountByDay[today] ?? 0} far jumps</span>
          <span>{ridesToday.length} commutes</span>
        </footer>
      </div>
    </section>
  );
}
