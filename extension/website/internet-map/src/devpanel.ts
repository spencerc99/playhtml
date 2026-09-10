// ABOUTME: Floating theme editor for the internet map, opened with ?dev=1 or backtick.
// ABOUTME: Edits every Theme slot live, and copies, pastes, links or resets the result.

import {
  Theme, PRESETS, PresetName, DEFAULT_PRESET, cloneTheme,
  COLOR_GROUPS, NUMBER_SLOTS, ChromeTheme,
} from "./theme";

const STORE_KEY = "wwo.internet-map.theme";
const STORE_PRESET = "wwo.internet-map.preset";
const HASH_KEY = "theme";

export interface DevPanelOpts {
  /** apply an edited theme to the map and repaint */
  onChange: (t: Theme) => void;
  /** the canvas, for the screenshot button */
  canvas: HTMLCanvasElement;
}

const DARK_CHROME: ChromeTheme = PRESETS.dark.chrome;
const LIGHT_CHROME: ChromeTheme = PRESETS.paper.chrome;

/**
 * Read the theme this session should start from: a URL hash wins, then
 * whatever was last edited, then the default preset.
 */
export function initialTheme(): { theme: Theme; preset: PresetName } {
  const fromHash = decodeHash(location.hash);
  if (fromHash) return fromHash;
  try {
    const raw = localStorage.getItem(STORE_KEY);
    const preset = (localStorage.getItem(STORE_PRESET) ?? DEFAULT_PRESET) as PresetName;
    if (raw) {
      const t = merge(PRESETS[preset] ?? PRESETS[DEFAULT_PRESET], JSON.parse(raw));
      return { theme: t, preset };
    }
    if (PRESETS[preset]) return { theme: cloneTheme(PRESETS[preset]), preset };
  } catch {
    // A corrupt or unreadable store is not worth failing the map over.
  }
  return { theme: cloneTheme(PRESETS[DEFAULT_PRESET]), preset: DEFAULT_PRESET };
}

function decodeHash(hash: string): { theme: Theme; preset: PresetName } | null {
  const m = new URLSearchParams(hash.replace(/^#/, "")).get(HASH_KEY);
  if (!m) return null;
  try {
    const parsed = JSON.parse(decodeURIComponent(escape(atob(m))));
    const preset = (parsed.__preset ?? DEFAULT_PRESET) as PresetName;
    return { theme: merge(PRESETS[preset] ?? PRESETS[DEFAULT_PRESET], parsed), preset };
  } catch {
    return null;
  }
}

/** Take a preset as the base and lay a partial theme over it. */
function merge(base: Theme, over: Partial<Theme> & { __preset?: string }): Theme {
  const t = cloneTheme(base);
  for (const [k, v] of Object.entries(over)) {
    if (k === "__preset" || v === undefined) continue;
    if (k === "chrome") Object.assign(t.chrome, v as ChromeTheme);
    else if (Array.isArray(v)) (t as any)[k] = [...v];
    else (t as any)[k] = v;
  }
  return t;
}

export class DevPanel {
  private el: HTMLElement;
  private theme: Theme;
  private preset: PresetName;
  private out: HTMLTextAreaElement;
  private inbox: HTMLTextAreaElement;
  private note: HTMLElement;
  private open = false;

  constructor(theme: Theme, preset: PresetName, private opts: DevPanelOpts) {
    this.theme = theme;
    this.preset = preset;
    this.el = document.createElement("div");
    this.el.id = "im-dev";
    document.body.appendChild(this.el);
    this.el.innerHTML = SHELL;
    this.out = this.el.querySelector("#im-dev-out") as HTMLTextAreaElement;
    this.inbox = this.el.querySelector("#im-dev-in") as HTMLTextAreaElement;
    this.note = this.el.querySelector("#im-dev-note") as HTMLElement;
    this.buildControls();
    this.wireActions();
    this.setOpen(false);
    addEventListener("keydown", (e) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if (e.key === "`") { e.preventDefault(); this.setOpen(!this.open); }
    });
  }

  setOpen(v: boolean) {
    this.open = v;
    this.el.classList.toggle("on", v);
  }

  private buildControls() {
    const body = this.el.querySelector("#im-dev-body") as HTMLElement;

    const presetSel = this.el.querySelector("#im-dev-preset") as HTMLSelectElement;
    for (const name of Object.keys(PRESETS)) {
      const o = document.createElement("option");
      o.value = name;
      o.textContent = name;
      presetSel.appendChild(o);
    }
    presetSel.value = this.preset;
    presetSel.onchange = () => {
      this.preset = presetSel.value as PresetName;
      this.theme = cloneTheme(PRESETS[this.preset]);
      this.refresh();
      this.commit();
    };

    for (const g of COLOR_GROUPS) {
      const sec = document.createElement("details");
      sec.className = "im-sec";
      // Buildings is the long one and the one most worth folding away.
      sec.open = g.name !== "Buildings";
      const sum = document.createElement("summary");
      sum.textContent = g.name;
      sec.appendChild(sum);
      const grid = document.createElement("div");
      grid.className = "im-swatches";
      for (const s of g.slots) {
        const row = document.createElement("label");
        row.className = "im-swatch";
        const input = document.createElement("input");
        input.type = "color";
        input.dataset.slot = s.key;
        input.value = normaliseHex(s.get(this.theme));
        input.oninput = () => {
          s.set(this.theme, input.value);
          this.commit();
        };
        const cap = document.createElement("span");
        cap.textContent = s.label;
        row.append(input, cap);
        grid.appendChild(row);
      }
      sec.appendChild(grid);
      body.appendChild(sec);
    }

    const nums = document.createElement("details");
    nums.className = "im-sec";
    nums.open = true;
    const nsum = document.createElement("summary");
    nsum.textContent = "Levels";
    nums.appendChild(nsum);
    for (const s of NUMBER_SLOTS) {
      const row = document.createElement("div");
      row.className = "im-dial";
      const lab = document.createElement("label");
      lab.textContent = s.label;
      const input = document.createElement("input");
      input.type = "range";
      input.min = String(s.min);
      input.max = String(s.max);
      input.step = String(s.step);
      input.dataset.num = s.key;
      input.value = String(s.get(this.theme));
      const val = document.createElement("output");
      val.dataset.numOut = s.key;
      val.textContent = s.get(this.theme).toFixed(2);
      input.oninput = () => {
        s.set(this.theme, parseFloat(input.value));
        val.textContent = parseFloat(input.value).toFixed(2);
        this.commit();
      };
      row.append(lab, input, val);
      nums.appendChild(row);
    }
    body.appendChild(nums);
  }

  private wireActions() {
    const on = (sel: string, fn: () => void) => {
      (this.el.querySelector(sel) as HTMLElement).onclick = fn;
    };

    on("#im-dev-close", () => this.setOpen(false));

    on("#im-dev-copy", async () => {
      const json = this.json();
      this.out.value = json;
      this.out.hidden = false;
      try {
        await navigator.clipboard.writeText(json);
        this.say("copied to clipboard");
      } catch {
        this.out.select();
        this.say("clipboard blocked — select the text below");
      }
    });

    on("#im-dev-apply", () => {
      try {
        const parsed = JSON.parse(this.inbox.value);
        const preset = (parsed.__preset ?? this.preset) as PresetName;
        this.preset = PRESETS[preset] ? preset : this.preset;
        this.theme = merge(PRESETS[this.preset], parsed);
        (this.el.querySelector("#im-dev-preset") as HTMLSelectElement).value = this.preset;
        this.refresh();
        this.commit();
        this.say("applied");
      } catch (e) {
        this.say(`not valid theme JSON: ${(e as Error).message}`);
      }
    });

    on("#im-dev-link", async () => {
      const u = new URL(location.href);
      u.hash = `${HASH_KEY}=${encodeTheme(this.json())}`;
      history.replaceState(null, "", u);
      try {
        await navigator.clipboard.writeText(u.toString());
        this.say("share link copied");
      } catch {
        this.out.value = u.toString();
        this.out.hidden = false;
        this.say("link is in the address bar");
      }
    });

    on("#im-dev-reset", () => {
      this.theme = cloneTheme(PRESETS[this.preset]);
      this.refresh();
      this.commit();
      this.say(`reset to ${this.preset}`);
    });

    on("#im-dev-shot", () => {
      const a = document.createElement("a");
      a.download = `internet-map-${this.preset}-${Date.now()}.png`;
      a.href = this.opts.canvas.toDataURL("image/png");
      a.click();
      this.say("screenshot saved");
    });

    const chromeSel = this.el.querySelector("#im-dev-chrome") as HTMLSelectElement;
    chromeSel.onchange = () => {
      // Previewing dark chrome on a light map is the point, so the chrome
      // half of the theme swaps on its own without touching the map colours.
      this.theme.chrome = { ...(chromeSel.value === "dark" ? DARK_CHROME : LIGHT_CHROME) };
      this.refresh();
      this.commit();
    };
  }

  /** Push every control back in sync with the theme object. */
  private refresh() {
    for (const g of COLOR_GROUPS) {
      for (const s of g.slots) {
        const i = this.el.querySelector(`input[data-slot="${s.key}"]`) as HTMLInputElement;
        if (i) i.value = normaliseHex(s.get(this.theme));
      }
    }
    for (const s of NUMBER_SLOTS) {
      const i = this.el.querySelector(`input[data-num="${s.key}"]`) as HTMLInputElement;
      const o = this.el.querySelector(`output[data-num-out="${s.key}"]`) as HTMLElement;
      if (i) i.value = String(s.get(this.theme));
      if (o) o.textContent = s.get(this.theme).toFixed(2);
    }
    const chromeSel = this.el.querySelector("#im-dev-chrome") as HTMLSelectElement;
    chromeSel.value = this.theme.chrome.panelInk === DARK_CHROME.panelInk ? "dark" : "light";
  }

  private commit() {
    this.opts.onChange(this.theme);
    try {
      localStorage.setItem(STORE_KEY, this.json());
      localStorage.setItem(STORE_PRESET, this.preset);
    } catch {
      // Private browsing and full quotas both land here; the map still works.
    }
  }

  private json() {
    return JSON.stringify({ __preset: this.preset, ...this.theme }, null, 2);
  }

  private say(msg: string) {
    this.note.textContent = msg;
  }
}

function encodeTheme(json: string) {
  return btoa(unescape(encodeURIComponent(json)));
}

/**
 * `<input type=color>` accepts only `#rrggbb`. A theme slot may hold an rgba()
 * string (the chrome rules do), so those get a neutral stand-in rather than
 * silently resetting the control to black.
 */
function normaliseHex(v: string) {
  return /^#[0-9a-f]{6}$/i.test(v) ? v : "#808080";
}

const SHELL = `
  <div id="im-dev-head">
    <b>theme</b>
    <select id="im-dev-preset" title="preset"></select>
    <select id="im-dev-chrome" title="chrome">
      <option value="light">light chrome</option>
      <option value="dark">dark chrome</option>
    </select>
    <button id="im-dev-close" title="close (\`)">×</button>
  </div>
  <div id="im-dev-body"></div>
  <div id="im-dev-foot">
    <div class="im-btns">
      <button id="im-dev-copy">Copy theme</button>
      <button id="im-dev-link">Share link</button>
      <button id="im-dev-reset">Reset to preset</button>
      <button id="im-dev-shot">Screenshot</button>
    </div>
    <textarea id="im-dev-out" readonly hidden rows="6"></textarea>
    <textarea id="im-dev-in" rows="4" placeholder="paste theme JSON here"></textarea>
    <button id="im-dev-apply">Apply pasted theme</button>
    <div id="im-dev-note"></div>
  </div>`;
