// Vanilla ports of the big @playhtml/react examples (see /test/react-test),
// rebuilt on the new rail-2 API: playhtml.register / playhtml.define + `view`.
// Each section's HTML is an empty `<div can-play>` mount point — everything
// you see is rendered by a `view` here.
import "../home.scss";
import { playhtml, html, svg, repeat } from "../../packages/playhtml/src";

// Start playhtml first; registrations made before sync bind automatically once
// the room syncs (register/define support before- and after-init).
playhtml.init({
  cursors: {
    enabled: true,
    room: "domain",
    shouldRenderCursor: (presence) => presence.page === window.location.pathname,
  },
  events: {
    confetti: {
      type: "confetti",
      onEvent: (data) => (window as any).confetti?.(data || {}),
    },
  },
});

const stableUserId = (() => {
  let u = localStorage.getItem("ph_view_uid");
  if (!u) {
    u = Math.random().toString(36).slice(2, 10);
    localStorage.setItem("ph_view_uid", u);
  }
  return u;
})();

// ── Counter (ReactiveOrb) ──────────────────────────────────────────────────
playhtml.register<{ clicks: number }>("orb", {
  defaultData: { clicks: 0 },
  view: ({ data, setData }) => html`
    <button
      class="orb"
      style=${`transform: scale(${1 + Math.min(data.clicks, 40) * 0.02})`}
      @click=${() => setData((d) => { d.clicks += 1; })}
    >
      ${data.clicks} ${data.clicks === 1 ? "click" : "clicks"}
    </button>
  `,
});

// ── Shared lamp ────────────────────────────────────────────────────────────
playhtml.register<{ on: boolean }>("lamp", {
  defaultData: { on: false },
  view: ({ data, setData }) => html`
    <img
      class="lamp ${data.on ? "on" : ""}"
      src="/noguchi-akari-a1.png"
      alt="lamp (click to toggle)"
      @click=${() => setData((d) => { d.on = !d.on; })}
    />
  `,
});

// ── Shared slider ──────────────────────────────────────────────────────────
playhtml.register<{ value: number }>("slider", {
  defaultData: { value: 50 },
  view: ({ data, setData }) => html`
    <label>Vibes: <strong>${data.value}</strong></label><br />
    <input
      type="range"
      min="0"
      max="100"
      .value=${String(data.value)}
      @input=${(e: Event) =>
        setData({ value: Number((e.target as HTMLInputElement).value) })}
    />
  `,
});

// ── Online indicator (element awareness) ───────────────────────────────────
playhtml.register<{}, undefined, string>("online", {
  defaultData: {},
  myDefaultAwareness: "#2563eb",
  view: ({ awareness, setMyAwareness }) => html`
    <div class="online-row">
      ${repeat(
        awareness,
        (_c, i) => i,
        (color) => html`<span class="dot" style=${`background:${color}`}></span>`,
      )}
      <input
        type="color"
        title="your color"
        @input=${(e: Event) =>
          setMyAwareness((e.target as HTMLInputElement).value)}
      />
    </div>
  `,
});

// ── Visitor count (awareness length) ───────────────────────────────────────
playhtml.register<{}, undefined, boolean>("visitors", {
  defaultData: {},
  myDefaultAwareness: true,
  view: ({ awareness }) => html`
    <div class="pill">
      👁 ${awareness.length} ${awareness.length === 1 ? "person" : "people"} here
    </div>
  `,
});

// ── Shared timer (clock-driven via requestUpdate) ──────────────────────────
type TimerData = {
  state: "idle" | "running" | "paused";
  startAtMs: number;
  elapsedMs: number;
};
const fmt = (ms: number) => {
  const s = Math.floor(ms / 1000);
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
};
playhtml.register<TimerData>("timer", {
  defaultData: { state: "idle", startAtMs: 0, elapsedMs: 0 },
  view: ({ data, setData }) => {
    const elapsed =
      data.state === "running"
        ? data.elapsedMs + (Date.now() - data.startAtMs)
        : data.elapsedMs;
    return html`
      <span class="time">${fmt(elapsed)}</span>
      <button
        @click=${() =>
          data.state !== "running" &&
          setData((d) => { d.state = "running"; d.startAtMs = Date.now(); })}
      >Start</button>
      <button
        @click=${() =>
          data.state === "running" &&
          setData((d) => { d.state = "paused"; d.elapsedMs = elapsed; })}
      >Pause</button>
      <button
        @click=${() =>
          setData((d) => { d.state = "idle"; d.elapsedMs = 0; d.startAtMs = 0; })}
      >Reset</button>
    `;
  },
  onMount: ({ getData, requestUpdate }) => {
    let raf = 0;
    const tick = () => {
      if (getData().state === "running") requestUpdate();
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  },
});

// ── Random spinner (clock-driven SVG) ──────────────────────────────────────
const SPIN_OPTS = ["Confetti", "Lamp", "Chat", "Poll", "Picker"];
type SpinData = {
  spin: {
    startTimeMs: number;
    durationMs: number;
    targetIndex: number;
    rotations: number;
  } | null;
};
const easeOut = (t: number) => 1 - Math.pow(1 - t, 3);
playhtml.register<SpinData>("spinner", {
  defaultData: { spin: null },
  view: ({ data, setData }) => {
    const per = 360 / SPIN_OPTS.length;
    let angle = 0;
    let settled = true;
    if (data.spin) {
      const { startTimeMs, durationMs, targetIndex, rotations } = data.spin;
      const t = Math.min(1, (Date.now() - startTimeMs) / durationMs);
      settled = t >= 1;
      const final = rotations * 360 + (360 - (targetIndex * per + per / 2));
      angle = easeOut(t) * final;
    }
    return html`
      <svg viewBox="0 0 200 200" class="wheel">
        <g transform="translate(100,100) rotate(${angle})">
          ${SPIN_OPTS.map((opt, i) => {
            const a0 = ((i * per - 90) * Math.PI) / 180;
            const a1 = (((i + 1) * per - 90) * Math.PI) / 180;
            const x0 = 80 * Math.cos(a0);
            const y0 = 80 * Math.sin(a0);
            const x1 = 80 * Math.cos(a1);
            const y1 = 80 * Math.sin(a1);
            const mid = ((i + 0.5) * per - 90) * (Math.PI / 180);
            return svg`
              <path
                d="M0 0 L ${x0} ${y0} A 80 80 0 0 1 ${x1} ${y1} Z"
                fill="hsl(${(i * 360) / SPIN_OPTS.length} 70% 60%)"
              />
              <text
                x=${50 * Math.cos(mid)}
                y=${50 * Math.sin(mid)}
                font-size="9"
                text-anchor="middle"
                dominant-baseline="middle"
                fill="white"
              >${opt}</text>
            `;
          })}
        </g>
        <polygon points="100,6 92,22 108,22" fill="#222"></polygon>
      </svg>
      <button
        @click=${() =>
          setData({
            spin: {
              startTimeMs: Date.now(),
              durationMs: 4000,
              targetIndex: Math.floor(Math.random() * SPIN_OPTS.length),
              rotations: 5,
            },
          })}
      >Spin 🎡</button>
      ${data.spin && settled
        ? html`<p>→ <strong>${SPIN_OPTS[data.spin.targetIndex]}</strong></p>`
        : null}
    `;
  },
  onMount: ({ getData, requestUpdate }) => {
    let raf = 0;
    const tick = () => {
      const s = getData().spin;
      if (s && Date.now() - s.startTimeMs < s.durationMs) requestUpdate();
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  },
});

// ── Poll (keyed per-user votes) ────────────────────────────────────────────
const POLL_OPTS = ["Drawing", "Shared Music", "Whiteboard", "Game"];
playhtml.register<{ votesByUser: Record<string, string> }>("poll", {
  defaultData: { votesByUser: {} },
  view: ({ data, setData }) => {
    const tally: Record<string, number> = {};
    POLL_OPTS.forEach((o) => (tally[o] = 0));
    Object.values(data.votesByUser).forEach((o) => {
      if (o in tally) tally[o] += 1;
    });
    const total = Object.values(tally).reduce((a, b) => a + b, 0);
    const mine = data.votesByUser[stableUserId];
    return html`${POLL_OPTS.map((opt) => {
      const pct = total ? Math.round((100 * tally[opt]) / total) : 0;
      return html`
        <div class="poll-row">
          <button
            class=${mine === opt ? "voted" : ""}
            @click=${() =>
              setData((d) => { d.votesByUser[stableUserId] = opt; })}
          >${mine === opt ? "✔" : "○"}</button>
          <span>${opt}</span>
          <span>${tally[opt]} (${pct}%)</span>
          <div class="bar"><div class="fill" style=${`width:${pct}%`}></div></div>
        </div>
      `;
    })}`;
  },
});

// ── Live reactions (events + transient bursts + requestUpdate fade) ─────────
const REACTION_EVENT = "view-playground-reaction";
type Burst = { id: string; emoji: string; at: number; x: number };
playhtml.register<{}, { bursts: Burst[] }>("reactions", {
  defaultData: {},
  defaultLocalData: { bursts: [] },
  view: ({ localData }) => html`
    <button
      @click=${() =>
        playhtml.dispatchPlayEvent({
          type: REACTION_EVENT,
          eventPayload: { emoji: "💥" },
        })}
    >React 💥</button>
    <div class="stage">
      ${repeat(localData.bursts, (b) => b.id, (b) => {
        const t = Math.min(1, (Date.now() - b.at) / 2000);
        return html`<span
          class="burst"
          style=${`left:${b.x}px; bottom:${t * 110}px; opacity:${1 - t}`}
          >${b.emoji}</span
        >`;
      })}
    </div>
  `,
  onMount: ({ setLocalData, requestUpdate }) => {
    const listenerId = playhtml.registerPlayEventListener(REACTION_EVENT, {
      onEvent: (payload: any) => {
        setLocalData((d) => {
          d.bursts.push({
            id: Math.random().toString(36).slice(2),
            emoji: payload?.emoji || "💥",
            at: Date.now(),
            x: 20 + Math.random() * 180,
          });
        });
      },
    });
    let raf = 0;
    const tick = () => {
      setLocalData((d) => {
        d.bursts = d.bursts.filter((b) => Date.now() - b.at < 2000);
      });
      requestUpdate();
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      playhtml.removePlayEventListener(REACTION_EVENT, listenerId);
      cancelAnimationFrame(raf);
    };
  },
});

// ── Live chat (define + localData + view-rendered mount points) ────────────
type ChatMsg = { id: string; text: string };
playhtml.define<{ messages: ChatMsg[] }, { open: boolean }>("can-chat", {
  defaultData: { messages: [] },
  defaultLocalData: { open: false },
  view: ({ data, localData, setData, setLocalData, element }) => {
    const name = element.dataset.name ?? "room";
    const send = (e: Event) => {
      e.preventDefault();
      const form = e.target as HTMLFormElement;
      const text = (new FormData(form).get("t") as string)?.trim();
      if (!text) return;
      setData((d) => {
        d.messages.push({ id: crypto.randomUUID(), text });
      });
      form.reset();
    };
    return html`
      <div class="chat ${localData.open ? "open" : ""}">
        <div
          class="chat-head"
          @click=${() => setLocalData((d) => { d.open = !d.open; })}
        >
          <span># ${name}</span><span>${localData.open ? "–" : "⬆︎"}</span>
        </div>
        ${localData.open
          ? html`
              <div class="chat-body">
                ${repeat(
                  data.messages,
                  (m) => m.id,
                  (m) => html`<div>${m.text}</div>`,
                )}
              </div>
              <form @submit=${send}>
                <input name="t" placeholder="message…" autocomplete="off" />
                <button>send</button>
              </form>
            `
          : null}
      </div>
    `;
  },
});

playhtml.register<{ names: string[] }>("chats", {
  defaultData: { names: ["general"] },
  view: ({ data, setData }) => {
    const create = (e: Event) => {
      e.preventDefault();
      const form = e.target as HTMLFormElement;
      const name = (new FormData(form).get("n") as string)?.trim();
      if (!name) return;
      setData((d) => {
        if (!d.names.includes(name)) d.names.push(name);
      });
      form.reset();
    };
    return html`
      ${repeat(
        data.names,
        (n) => n,
        (n) => html`<div id="chat-${n}" can-chat data-name=${n}></div>`,
      )}
      <form @submit=${create}>
        <input name="n" placeholder="new room…" autocomplete="off" />
        <button>create room</button>
      </form>
    `;
  },
});
