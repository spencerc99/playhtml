// ABOUTME: The playhtml atlas page: a fog-of-war parchment map of every website
// ABOUTME: connected to playhtml, with per-visitor exploration saved locally.

import { useCallback, useEffect, useMemo, useState } from "react";
import ReactDOM from "react-dom/client";
import { WorldMap } from "@movement/worldmap/WorldMap";
import { SCOUT_RADIUS } from "@movement/worldmap/geography";
import {
  ExplorationRecord,
  ScoutMark,
  WorldSite,
} from "@movement/worldmap/types";
import domainSnapshot from "./map-domains.json";
import "./map.scss";

const STORAGE_KEY = "playhtml-atlas-exploration-v1";

interface SavedState {
  exploration: ExplorationRecord;
  scoutMarks: ScoutMark[];
}

const HOME_DOMAIN = "playhtml.fun";

function loadState(): SavedState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw) as SavedState;
  } catch {
    // fall through to a fresh map
  }
  return {
    exploration: {
      [HOME_DOMAIN]: { tier: 3, visits: 1, firstSeen: Date.now() },
    },
    scoutMarks: [],
  };
}

function Atlas() {
  const sites: WorldSite[] = useMemo(
    () =>
      (domainSnapshot as { domain: string; rooms: number; activity: number }[]).map(
        (d) => ({
          domain: d.domain,
          rooms: d.rooms,
          activity: d.activity,
          playhtml: true,
        })
      ),
    []
  );

  const [state, setState] = useState<SavedState>(loadState);
  const [revealAll, setRevealAll] = useState(false);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }, [state]);

  const onScout = useCallback(
    (point: { x: number; y: number }, nearbyDomains: string[]) => {
      setState((prev) => {
        const exploration = { ...prev.exploration };
        for (const domain of nearbyDomains) {
          if (!exploration[domain]) {
            exploration[domain] = { tier: 1, firstSeen: Date.now() };
          }
        }
        return {
          exploration,
          scoutMarks: [
            ...prev.scoutMarks,
            { x: point.x, y: point.y, r: SCOUT_RADIUS },
          ],
        };
      });
    },
    []
  );

  const onTravel = useCallback((site: WorldSite) => {
    setState((prev) => {
      const entry = prev.exploration[site.domain];
      const visits = (entry?.visits ?? 0) + 1;
      return {
        ...prev,
        exploration: {
          ...prev.exploration,
          [site.domain]: {
            tier: visits >= 2 ? 3 : 2,
            visits,
            firstSeen: entry?.firstSeen ?? Date.now(),
          },
        },
      };
    });
    window.open(`https://${site.domain}`, "_blank", "noopener");
  }, []);

  const resetFog = useCallback(() => {
    localStorage.removeItem(STORAGE_KEY);
    setState(loadState());
  }, []);

  const charted = Object.values(state.exploration).filter(
    (e) => e.tier >= 2
  ).length;
  const glimpsed = Object.values(state.exploration).filter(
    (e) => e.tier === 1
  ).length;

  return (
    <div className="atlas">
      <WorldMap
        sites={sites}
        exploration={state.exploration}
        scoutMarks={state.scoutMarks}
        revealAll={revealAll}
        onScout={onScout}
        onTravel={onTravel}
      />
      <div className="atlas-cartouche">
        <h1>the playhtml atlas</h1>
        <p>
          a map of everywhere <a href="/">playhtml</a> lives. the territory is
          shared; the fog is yours. click unmapped paper to scout, click a
          landmark to travel there.
        </p>
        <div className="atlas-tally">
          {charted} of {sites.length} places charted
          {glimpsed > 0 ? ` · ${glimpsed} glimpsed` : ""}
        </div>
      </div>
      <div className="atlas-controls">
        <label>
          <input
            type="checkbox"
            checked={revealAll}
            onChange={(e) => setRevealAll(e.target.checked)}
          />
          lift the fog
        </label>
        <button onClick={resetFog}>start over</button>
      </div>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById("app")!).render(<Atlas />);
