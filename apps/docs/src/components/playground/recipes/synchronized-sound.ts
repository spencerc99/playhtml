// ABOUTME: Defines the canonical synchronized-sound recipe for docs and the playground.
// ABOUTME: Demonstrates transient audio events and a persistent shared transport.
import type { ExampleRecipe } from "./types";
import { synchronizedSoundReactSource } from "./react/synchronized-sound";

export const synchronizedSoundRecipe: ExampleRecipe = {
  id: "synchronized-sound",
  title: "Synchronized sound",
  description:
    "Send a one-shot cue to everyone currently connected, or share a loop that late joiners can join.",
  tags: ["audio", "events", "timeline", "late joiners", "Web Audio"],
  capabilities: ["can-play", "events"],
  difficulty: "advanced",
  docsHref: "/docs/examples/synchronized-sound/",
  react: {
    install: "npm install playhtml @playhtml/react",
    code: synchronizedSoundReactSource,
  },
  html: `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Synchronized sound with playhtml</title>
  <style>
    :root {
      color: #3d3833;
      background: #f7f3ea;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      font-synthesis: none;
    }
    * { box-sizing: border-box; }
    body { margin: 0; min-height: 100vh; padding: clamp(1rem, 5vw, 4rem); }
    main { width: min(760px, 100%); margin: 0 auto; }
    h1 { color: #274b9e; font-size: clamp(2.4rem, 8vw, 5rem); line-height: 0.95; margin: 0 0 1rem; }
    .intro { max-width: 62ch; font-size: 1.05rem; line-height: 1.5; }
    .audio-unlock {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 0.75rem;
      margin: 1.5rem 0;
      padding: 1rem;
      border: 2px solid #3d3833;
      background: #ffe95c;
      box-shadow: 5px 5px 0 #3d3833;
    }
    .audio-unlock p { margin: 0; flex: 1 1 260px; }
    .panel {
      margin-top: 1.25rem;
      padding: clamp(1rem, 4vw, 2rem);
      border: 2px solid #3d3833;
      background: #fffdf8;
      box-shadow: 7px 7px 0 #3d3833;
    }
    .eyebrow { margin: 0; color: #5e5751; font-size: 0.75rem; font-weight: 800; letter-spacing: 0.12em; text-transform: uppercase; }
    h2 { margin: 0.35rem 0 0.6rem; font-size: 1.45rem; }
    .panel-copy { margin: 0 0 1rem; line-height: 1.5; }
    button {
      appearance: none;
      border: 2px solid #3d3833;
      border-radius: 0;
      background: #fff;
      color: inherit;
      cursor: pointer;
      font: inherit;
      font-weight: 750;
      padding: 0.7rem 1rem;
      box-shadow: 3px 3px 0 #3d3833;
    }
    button:hover { background: #ffe95c; }
    button:active { translate: 2px 2px; box-shadow: 1px 1px 0 #3d3833; }
    .primary { background: #274b9e; color: #fff; }
    .primary:hover { background: #355fae; }
    .controls { display: flex; flex-wrap: wrap; gap: 0.7rem; }
    .timeline { margin-top: 1.25rem; }
    .timeline-head { display: flex; align-items: baseline; justify-content: space-between; gap: 1rem; margin-bottom: 0.5rem; }
    .time { font-variant-numeric: tabular-nums; font-weight: 750; }
    .track { height: 18px; overflow: hidden; border: 2px solid #3d3833; background: #d9d3ca; }
    .progress { width: 0%; height: 100%; background: #274b9e; }
    .steps { display: grid; grid-template-columns: repeat(4, 1fr); gap: 0.4rem; margin-top: 0.55rem; }
    .step { height: 34px; display: grid; place-items: center; border: 2px solid #3d3833; background: #fff; font-size: 0.78rem; font-weight: 800; }
    .step[data-active="true"] { background: #ffe95c; }
    .local-status { margin: 0.8rem 0 0; min-height: 1.5em; color: #5e5751; }
    code { padding: 0.1rem 0.25rem; background: #eae5db; }
  </style>
</head>
<body>
  <main>
    <h1>Synchronized sound</h1>
    <p class="intro">
      A one-shot cue reaches people who are here now. The loop stores a shared
      play/pause timeline, so people who arrive later join at the current beat.
    </p>

    <section id="sound-transport" can-play>
      <div class="audio-unlock">
        <button type="button" data-action="enable-audio">Enable audio</button>
        <p><strong>Do this in every window.</strong> Browsers require a local click before a page can make sound.</p>
      </div>

      <div class="panel">
        <p class="eyebrow">Transient event</p>
        <h2>One-shot cue</h2>
        <p class="panel-copy">This chime plays once for everyone currently connected. It is not replayed for late joiners.</p>
        <button class="primary" type="button" data-action="send-cue">Send chime</button>
      </div>

      <div class="panel">
        <p class="eyebrow">Persistent shared data</p>
        <h2>Four-beat loop</h2>
        <p class="panel-copy">Play, pause, and position are shared. Each window generates the tones locally from the same timeline.</p>
        <div class="controls">
          <button class="primary" type="button" data-action="toggle-transport">Play loop</button>
          <button type="button" data-action="restart-transport">Restart</button>
        </div>
        <div class="timeline">
          <div class="timeline-head">
            <strong data-transport-state>Paused</strong>
            <span class="time" data-position>0.0 / 2.0s</span>
          </div>
          <div class="track" role="progressbar" aria-label="Loop position" aria-valuemin="0" aria-valuemax="2000" aria-valuenow="0">
            <div class="progress" data-progress></div>
          </div>
          <div class="steps" aria-hidden="true">
            <span class="step" data-step="0">C</span>
            <span class="step" data-step="1">E</span>
            <span class="step" data-step="2">G</span>
            <span class="step" data-step="3">C</span>
          </div>
        </div>
      </div>
      <p class="local-status" data-audio-status role="status">Audio is off in this window.</p>
    </section>
  </main>

  <script type="module">
    import { playhtml } from "playhtml";

    const CUE_EVENT = "synchronized-sound-cue";
    const STEP_MS = 500;
    const LOOP_MS = 2000;
    const PATTERN = [261.63, 329.63, 392.0, 523.25];
    const soundTransport = document.getElementById("sound-transport");

    let audioContext = null;
    let scheduledTransportStart = null;
    let nextStepToSchedule = 0;
    const activePatternGains = new Set();

    function loopPositionMs(data, nowMs) {
      const elapsedMs = data.isPlaying
        ? nowMs - data.startedAtMs
        : data.positionMs;
      return ((elapsedMs % LOOP_MS) + LOOP_MS) % LOOP_MS;
    }

    function setAudioStatus(message) {
      soundTransport.querySelector("[data-audio-status]").textContent = message;
    }

    function playTone(frequency, startTime, duration, volume, patternTone = false) {
      if (!audioContext || audioContext.state !== "running") return;
      const oscillator = audioContext.createOscillator();
      const gain = audioContext.createGain();
      const start = Math.max(audioContext.currentTime, startTime);
      oscillator.type = "sine";
      oscillator.frequency.setValueAtTime(frequency, start);
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(volume, start + 0.012);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
      oscillator.connect(gain).connect(audioContext.destination);
      oscillator.start(start);
      oscillator.stop(start + duration + 0.02);
      if (patternTone) activePatternGains.add(gain);
      oscillator.addEventListener("ended", () => {
        activePatternGains.delete(gain);
        oscillator.disconnect();
        gain.disconnect();
      }, { once: true });
    }

    function silencePattern() {
      if (!audioContext) return;
      for (const gain of activePatternGains) {
        gain.gain.cancelScheduledValues(audioContext.currentTime);
        gain.gain.setValueAtTime(0.0001, audioContext.currentTime);
      }
      activePatternGains.clear();
    }

    function playCue(payload) {
      const frequency = Number(payload && payload.frequency) || 880;
      if (!audioContext || audioContext.state !== "running") {
        setAudioStatus("A chime arrived. Enable audio to hear future sounds in this window.");
        return;
      }
      playTone(frequency, audioContext.currentTime + 0.01, 0.28, 0.16);
      setAudioStatus("Chime received in this window.");
    }

    async function enableAudio() {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (!AudioContextClass) {
        setAudioStatus("Web Audio is not available in this browser.");
        return;
      }
      if (!audioContext) audioContext = new AudioContextClass();
      await audioContext.resume();
      document.querySelector("[data-action='enable-audio']").textContent = "Audio enabled";
      setAudioStatus("Audio is enabled in this window.");
      scheduledTransportStart = null;
    }

    function renderTimeline(element, data, nowMs) {
      const positionMs = loopPositionMs(data, nowMs);
      const progress = element.querySelector("[data-progress]");
      const track = progress.parentElement;
      const step = Math.floor(positionMs / STEP_MS) % PATTERN.length;
      progress.style.width = String((positionMs / LOOP_MS) * 100) + "%";
      track.setAttribute("aria-valuenow", String(Math.round(positionMs)));
      element.querySelector("[data-position]").textContent = (positionMs / 1000).toFixed(1) + " / 2.0s";
      element.querySelector("[data-transport-state]").textContent = data.isPlaying ? "Playing" : "Paused";
      element.querySelector("[data-action='toggle-transport']").textContent = data.isPlaying ? "Pause loop" : "Play loop";
      for (const marker of element.querySelectorAll("[data-step]")) {
        marker.dataset.active = String(Number(marker.dataset.step) === step);
      }
    }

    function schedulePattern(data, nowMs) {
      if (!audioContext || audioContext.state !== "running" || !data.isPlaying) {
        if (scheduledTransportStart !== null) silencePattern();
        scheduledTransportStart = null;
        return;
      }

      if (scheduledTransportStart !== data.startedAtMs) {
        silencePattern();
        scheduledTransportStart = data.startedAtMs;
        const elapsedMs = Math.max(0, nowMs - data.startedAtMs);
        const currentStep = Math.floor(elapsedMs / STEP_MS);
        playTone(
          PATTERN[currentStep % PATTERN.length],
          audioContext.currentTime + 0.01,
          0.18,
          0.09,
          true,
        );
        nextStepToSchedule = currentStep + 1;
      }

      const scheduleThroughMs = nowMs + 120;
      let beatAtMs = data.startedAtMs + nextStepToSchedule * STEP_MS;
      while (beatAtMs <= scheduleThroughMs) {
        if (beatAtMs >= nowMs - 20) {
          const delaySeconds = Math.max(0, beatAtMs - nowMs) / 1000;
          playTone(
            PATTERN[nextStepToSchedule % PATTERN.length],
            audioContext.currentTime + delaySeconds,
            0.18,
            0.09,
            true,
          );
        }
        nextStepToSchedule += 1;
        beatAtMs = data.startedAtMs + nextStepToSchedule * STEP_MS;
      }
    }

    soundTransport.defaultData = {
      isPlaying: false,
      startedAtMs: 0,
      positionMs: 0,
    };

    soundTransport.updateElement = ({ element, data }) => {
      renderTimeline(element, data, Date.now());
    };

    soundTransport.onClick = (event, { data, setData }) => {
      const button = event.target.closest("[data-action]");
      if (!button) return;

      if (button.dataset.action === "enable-audio") {
        void enableAudio();
        return;
      }

      if (button.dataset.action === "send-cue") {
        playhtml.dispatchPlayEvent({
          type: CUE_EVENT,
          eventPayload: { frequency: 880 },
        });
        return;
      }

      const nowMs = Date.now();
      if (button.dataset.action === "toggle-transport") {
        const positionMs = loopPositionMs(data, nowMs);
        setData((draft) => {
          draft.isPlaying = !data.isPlaying;
          draft.positionMs = positionMs;
          draft.startedAtMs = nowMs - positionMs;
        });
      }

      if (button.dataset.action === "restart-transport") {
        setData((draft) => {
          draft.positionMs = 0;
          draft.startedAtMs = nowMs;
        });
      }
    };

    soundTransport.onMount = ({ getData, getElement }) => {
      let animationFrame = 0;
      const tick = () => {
        const nowMs = Date.now();
        const data = getData();
        renderTimeline(getElement(), data, nowMs);
        schedulePattern(data, nowMs);
        animationFrame = requestAnimationFrame(tick);
      };
      animationFrame = requestAnimationFrame(tick);
      return () => {
        cancelAnimationFrame(animationFrame);
        silencePattern();
      };
    };

    await playhtml.init({
      developmentMode: true,
      events: {
        [CUE_EVENT]: {
          type: CUE_EVENT,
          onEvent: playCue,
        },
      },
    });
  </script>
</body>
</html>`,
};
