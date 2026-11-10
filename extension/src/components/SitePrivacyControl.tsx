// ABOUTME: Popup control for the current site: turn collection on or off, and pick who sees it.
// ABOUTME: Reads and writes the per-site setting; collector settings for every site stay in Settings.

import { useEffect, useState } from "react";
import {
  getSiteLevel,
  setSiteLevel,
  watchSiteLevel,
  type SiteLevel,
} from "../storage/siteSettings";

/** Tracks the stored level for a host and keeps it current. */
export function useSiteLevel(host: string | null) {
  const [level, setLevel] = useState<SiteLevel | null>(null);
  useEffect(() => {
    if (!host) {
      setLevel(null);
      return;
    }
    let live = true;
    void getSiteLevel(host).then((next) => {
      if (live) setLevel(next);
    });
    const stop = watchSiteLevel(host, (next) => setLevel(next));
    return () => {
      live = false;
      stop();
    };
  }, [host]);

  const choose = (next: SiteLevel) => {
    if (!host) return;
    setLevel(next);
    void setSiteLevel(host, next);
  };
  return { level, choose };
}

interface Props {
  host: string;
  level: SiteLevel;
  onChoose: (level: SiteLevel) => void;
}

const SEEN_BY: { level: SiteLevel; label: string }[] = [
  { level: "everyone", label: "Everyone" },
  { level: "just-me", label: "Just me" },
];

export function SitePrivacyControl({ host, level, onChoose }: Props) {
  const on = level !== "off";
  return (
    <div className="site-privacy">
      <div className="site-privacy__row">
        <span className="site-privacy__site">
          <span className="site-privacy__label">
            {on ? "Collecting data for:" : "Not collecting data for:"}
          </span>
          <span className="site-privacy__host">{host}</span>
        </span>
        <label className="slow-mode-toggle site-privacy__switch">
          <input
            type="checkbox"
            role="switch"
            aria-label={`Collect data on ${host}`}
            checked={on}
            onChange={(event) =>
              onChoose(event.target.checked ? "everyone" : "off")
            }
          />
          <span aria-hidden="true" />
        </label>
      </div>
      {on && (
        <>
          <div className="site-privacy__seen-by">
            <span className="site-privacy__seen-by-label">Seen by</span>
            <span
              className="site-privacy__choices"
              role="radiogroup"
              aria-label="Who can see it"
            >
              {SEEN_BY.map((choice) => (
                <button
                  key={choice.level}
                  type="button"
                  role="radio"
                  aria-checked={level === choice.level}
                  className={`site-privacy__choice${level === choice.level ? " site-privacy__choice--selected" : ""}`}
                  onClick={() => onChoose(choice.level)}
                >
                  {choice.label}
                  {choice.level === "everyone" && (
                    <span className="site-privacy__default">default</span>
                  )}
                </button>
              ))}
            </span>
          </div>
          {level === "just-me" && (
            <span className="site-privacy__note">
              <span>Only on this site. Everywhere else: Everyone.</span>
              <button
                type="button"
                className="site-privacy__reset"
                onClick={() => onChoose("everyone")}
              >
                Use default
              </button>
            </span>
          )}
        </>
      )}
    </div>
  );
}
