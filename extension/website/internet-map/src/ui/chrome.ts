/** Static DOM for the terminal-window chrome. */

import { searchPanelHTML } from "./search";

export function buildChrome(root: HTMLElement) {
  root.innerHTML = `
  ${searchPanelHTML()}

  <div id="zoom" class="win"><div class="body">
    <span id="level">domains</span>
    <button id="walkbtn" title="walk the map (W)">walk</button>
    <button id="zout">−</button><button id="zin">+</button>
  </div></div>

  <div id="walk" class="win"><div class="bar"><span>walking</span><button id="wk-leave" title="leave walk mode (Esc)">leave</button></div>
  <div class="body">
    <div class="row"><i>you are at</i><b id="wk-at"></b></div>
    <div class="row"><i></i><span id="wk-dom" class="dim"></span></div>
    <div class="row"><i>heading</i><span id="wk-heading"></span></div>
    <div class="row"><i>travelled</i><span id="wk-odo"></span></div>
    <div class="row" id="wk-dest-row"><i>going to</i><b id="wk-dest"></b></div>
    <div class="passport"><i>passport</i><span id="wk-passport"></span></div>
    <div class="help">lead with the cursor or the arrows · click a building to walk there · shift runs · space stops · esc leaves</div>
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
