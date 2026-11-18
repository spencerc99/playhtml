// ABOUTME: Renders the popup's Internet Commute entry and its scenic route (Slow Mode) controls.
// ABOUTME: Persists the setting, stop sharing, and boarding-sign dismissal; folds today's rides behind a toggle.

import React, { useEffect, useMemo, useState } from "react";
import browser from "webextension-polyfill";
import trainIceUrl from "../assets/train-ice.png";
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

/** Set once the person closes the "boarding now" sign; the train button replaces it. */
export const COMMUTE_SIGN_DISMISSED_KEY = "commuteSignDismissed";

const CHANCE_OPTIONS = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100];

const EMPTY_STATE: SlowModeState = {
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

interface Props {
  /** Opens the Internet Commute. Without it, no boarding sign or train button shows. */
  onBoard?: () => void;
  commuteIsOpen?: boolean;
}

export function SlowModeSettings({ onBoard, commuteIsOpen = false }: Props) {
  const [settings, setSettings] = useState<Settings>(
    DEFAULT_SLOW_MODE_SETTINGS,
  );
  const [state, setState] = useState<SlowModeState>(EMPTY_STATE);
  const [signDismissed, setSignDismissed] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const now = Date.now();

  useEffect(() => {
    browser.storage.local
      .get([
        SLOW_MODE_SETTINGS_KEY,
        SLOW_MODE_STATE_KEY,
        COMMUTE_SIGN_DISMISSED_KEY,
      ])
      .then((stored) => {
        setSettings(normalizeSlowModeSettings(stored[SLOW_MODE_SETTINGS_KEY]));
        setState(normalizeSlowModeState(stored[SLOW_MODE_STATE_KEY]));
        setSignDismissed(stored[COMMUTE_SIGN_DISMISSED_KEY] === true);
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

  const dismissSign = () => {
    setSignDismissed(true);
    void browser.storage.local.set({ [COMMUTE_SIGN_DISMISSED_KEY]: true });
  };

  const boardLabel = commuteIsOpen
    ? "Return to the Internet Commute"
    : "Board the Internet Commute";
  const showSign = Boolean(onBoard) && loaded && !signDismissed;
  const showTrainButton = Boolean(onBoard) && loaded && signDismissed;

  return (
    <div className={`scenic-route${showSign ? " scenic-route--signed" : ""}`}>
      {showSign && (
        <div className="commute-sign">
          <button
            type="button"
            className="commute-sign__board"
            onClick={onBoard}
            aria-label={boardLabel}
          >
            <span className="commute-sign__route" aria-hidden="true">
              <span className="commute-sign__stop commute-sign__stop--blue" />
              <span className="commute-sign__stop commute-sign__stop--gold" />
              <span className="commute-sign__stop commute-sign__stop--rust" />
            </span>
            <span className="commute-sign__copy">
              <span className="commute-sign__eyebrow">
                {commuteIsOpen ? "ON BOARD" : "BOARDING NOW"}
              </span>
              <strong>
                {commuteIsOpen
                  ? "Return to the internet commute"
                  : "Pass through recent websites people visited"}
              </strong>
            </span>
            <span className="commute-sign__arrow" aria-hidden="true">
              →
            </span>
          </button>
          <button
            type="button"
            className="commute-sign__dismiss"
            onClick={dismissSign}
            aria-label="Hide the boarding sign"
          >
            ×
          </button>
        </div>
      )}

      <section
        className="scenic-route__panel"
        aria-label="Scenic route settings"
      >
        <div className="scenic-route__row">
          <label className="scenic-route__toggle">
            <input
              type="checkbox"
              aria-label="Take the scenic route"
              checked={settings.enabled}
              disabled={!loaded}
              onChange={(event) =>
                saveSettings({ ...settings, enabled: event.target.checked })
              }
            />
            <span className="scenic-route__switch" aria-hidden="true" />
            <strong>scenic route</strong>
          </label>
          {showTrainButton && (
            <button
              type="button"
              className="board-train"
              onClick={onBoard}
              aria-label={boardLabel}
            >
              <span className="board-train__rail" aria-hidden="true" />
              <span className="board-train__ties" aria-hidden="true" />
              <span className="board-train__car" aria-hidden="true">
                <img src={trainIceUrl} alt="" />
              </span>
              <span className="board-train__label">
                {commuteIsOpen ? "return →" : "board →"}
              </span>
            </button>
          )}
        </div>

        {settings.enabled && (
          <>
            <div className="scenic-route__row scenic-route__options">
              <label>
                <span>how often</span>
                <select
                  className="scenic-route__chance"
                  value={settings.chancePercent}
                  onChange={(event) =>
                    saveSettings({
                      ...settings,
                      chancePercent: Number(event.target.value),
                    })
                  }
                >
                  {CHANCE_OPTIONS.map((percent) => (
                    <option key={percent} value={percent}>
                      {percent}%
                    </option>
                  ))}
                </select>
              </label>
              <label title="exact pages always stay private">
                <span>share my stop</span>
                <select
                  value={
                    settings.stopVisibility === "private" ? "private" : "domain"
                  }
                  onChange={(event) =>
                    saveSettings({
                      ...settings,
                      stopVisibility:
                        event.target.value === "private" ? "private" : "domain",
                    })
                  }
                >
                  <option value="domain">domain only</option>
                  <option value="private">keep private</option>
                </select>
              </label>
            </div>

            {ridesToday.length === 0 ? (
              <p className="scenic-route__history scenic-route__history--empty">
                no rides yet today
                {!cooldown.ready && ` · next ride in ${cooldownMinutes}m`}
              </p>
            ) : (
              <details className="scenic-route__history">
                <summary>
                  <span>
                    <strong>
                      {ridesToday.length}{" "}
                      {ridesToday.length === 1 ? "commute" : "commutes"}
                    </strong>{" "}
                    today
                    {!cooldown.ready && ` · next ride in ${cooldownMinutes}m`}
                  </span>
                  <span className="scenic-route__history-toggle">
                    history <span aria-hidden="true">▾</span>
                  </span>
                </summary>
                <ol>
                  {ridesToday.map((ride) => (
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
              </details>
            )}
          </>
        )}
      </section>
    </div>
  );
}
