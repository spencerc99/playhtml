/** Static DOM for the terminal-window chrome. */

import { searchPanelHTML } from "./search";

export function buildChrome(root: HTMLElement) {
  root.innerHTML = `
  ${searchPanelHTML()}

  <div id="zoom" class="win"><div class="body">
    <span id="level">domains</span>
    <button id="zout">−</button><button id="zin">+</button>
  </div></div>

  <div id="routes" class="win"><div class="body">
    <div id="r-hint">click a building, then another</div>
    <div id="r-list"></div>
    <div id="r-legs"></div>
  </div></div>

  <div id="tip"></div>
  <div id="boot"><div class="inner">
    <b>LOADING MAP</b><span id="bootmsg">fetching</span>
    <div class="bar"><i id="bootbar"></i></div>
  </div></div>`;
}

export const fmt = (n: number) =>
  n >= 1e6 ? (n / 1e6).toFixed(1) + "M"
  : n >= 1e3 ? (n / 1e3).toFixed(n >= 1e4 ? 0 : 1) + "k"
  : String(Math.round(n));
