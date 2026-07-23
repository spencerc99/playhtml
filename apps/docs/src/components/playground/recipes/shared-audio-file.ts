// ABOUTME: Defines the canonical shared audio-file recipe for docs and the playground.
// ABOUTME: Synchronizes an HTML audio element with a small shared transport state.
import type { ExampleRecipe } from "./types";

export const sharedAudioFileRecipe: ExampleRecipe = {
  id: "shared-audio-file",
  title: "Shared audio file",
  description:
    "Play, pause, and restart one audio file for everyone using a shared timeline.",
  tags: ["audio", "audio file", "timeline", "late joiners"],
  capabilities: ["can-play"],
  difficulty: "intermediate",
  docsHref: "/docs/examples/shared-audio-file/",
  html: `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Shared audio file with playhtml</title>
  <style>
    :root {
      color: #1c1c1c;
      background: #f4efe5;
      font-family: ui-sans-serif, system-ui, sans-serif;
    }
    * { box-sizing: border-box; }
    body { display: grid; min-height: 100vh; margin: 0; padding: 1.5rem; place-items: center; }
    main { width: min(34rem, 100%); }
    h1 { margin: 0 0 0.5rem; font-size: clamp(2rem, 8vw, 3.5rem); line-height: 1; }
    .intro { margin: 0 0 1.25rem; color: #3b3b3b; line-height: 1.5; }
    .player {
      padding: 1.25rem;
      border: 2px solid #1c1c1c;
      background: #ebe4d5;
      box-shadow: 5px 5px 0 #1c1c1c;
    }
    .file {
      display: flex;
      align-items: center;
      gap: 0.75rem;
      margin-bottom: 1rem;
      padding: 0.75rem;
      border: 1px solid #1c1c1c;
      background: #f4efe5;
      font-family: ui-monospace, monospace;
      font-size: 0.82rem;
    }
    .file-icon { font-size: 1.5rem; }
    .controls { display: flex; flex-wrap: wrap; gap: 0.65rem; }
    button {
      padding: 0.65rem 0.9rem;
      border: 2px solid #1c1c1c;
      border-radius: 4px;
      background: #f4efe5;
      color: #1c1c1c;
      box-shadow: 2px 2px 0 #1c1c1c;
      cursor: pointer;
      font: inherit;
      font-weight: 700;
    }
    button:hover { background: #e8a63a; }
    button:active { translate: 2px 2px; box-shadow: none; }
    .primary { background: #274b9e; color: #f4efe5; }
    .primary:hover { background: #1c3875; }
    .timeline { margin-top: 1rem; }
    .timeline-head {
      display: flex;
      justify-content: space-between;
      gap: 1rem;
      margin-bottom: 0.45rem;
    }
    .track { height: 16px; overflow: hidden; border: 2px solid #1c1c1c; background: #e0d8c6; }
    .progress { width: 0%; height: 100%; background: #274b9e; }
    .status { min-height: 1.4em; margin: 0.8rem 0 0; color: #6a6a66; font-size: 0.9rem; }
  </style>
</head>
<body>
  <main>
    <h1>Shared audio file</h1>
    <p class="intro">Every window plays the same file from the shared position.</p>

    <section id="shared-audio-player" class="player" can-play>
      <audio
        data-audio
        src="https://interactive-examples.mdn.mozilla.net/media/cc0-audio/t-rex-roar.mp3"
        preload="auto"
        loop
      ></audio>

      <div class="file">
        <span class="file-icon" aria-hidden="true">♪</span>
        <span>t-rex-roar.mp3</span>
      </div>

      <div class="controls">
        <button type="button" data-action="enable-audio">Enable audio</button>
        <button class="primary" type="button" data-action="toggle">Play for everyone</button>
        <button type="button" data-action="restart">Restart</button>
      </div>

      <div class="timeline">
        <div class="timeline-head">
          <strong data-playback-state>Paused</strong>
          <span data-position>0.0s</span>
        </div>
        <div
          class="track"
          role="progressbar"
          aria-label="Audio position"
          aria-valuemin="0"
          aria-valuemax="100"
          aria-valuenow="0"
        >
          <div class="progress" data-progress></div>
        </div>
      </div>
      <p class="status" data-status role="status">Enable audio in this window before playing.</p>
    </section>
  </main>

  <script type="module">
    import { playhtml } from "playhtml";

    const player = document.getElementById("shared-audio-player");
    const audio = player.querySelector("[data-audio]");
    let audioEnabled = false;

    function durationMs() {
      return Number.isFinite(audio.duration) ? audio.duration * 1000 : 2000;
    }

    function playbackPositionMs(data, nowMs) {
      const duration = durationMs();
      const elapsed = data.isPlaying ? nowMs - data.startedAtMs : data.positionMs;
      return ((elapsed % duration) + duration) % duration;
    }

    function render(element, data, nowMs) {
      const positionMs = playbackPositionMs(data, nowMs);
      const progress = (positionMs / durationMs()) * 100;
      element.querySelector("[data-progress]").style.width = progress + "%";
      element
        .querySelector("[role='progressbar']")
        .setAttribute("aria-valuenow", String(Math.round(progress)));
      element.querySelector("[data-position]").textContent =
        (positionMs / 1000).toFixed(1) + "s";
      element.querySelector("[data-playback-state]").textContent =
        data.isPlaying ? "Playing for everyone" : "Paused for everyone";
      element.querySelector("[data-action='toggle']").textContent =
        data.isPlaying ? "Pause for everyone" : "Play for everyone";
    }

    function syncLocalAudio(data, nowMs) {
      if (!audioEnabled) return;

      const expectedSeconds = playbackPositionMs(data, nowMs) / 1000;
      const driftSeconds = Math.abs(audio.currentTime - expectedSeconds);
      if (driftSeconds > 0.25) audio.currentTime = expectedSeconds;

      if (data.isPlaying && audio.paused) {
        void audio.play().catch(() => {
          audioEnabled = false;
          player.querySelector("[data-status]").textContent =
            "Audio is blocked in this window. Enable it again.";
        });
      } else if (!data.isPlaying && !audio.paused) {
        audio.pause();
      }
    }

    async function enableAudio(data) {
      try {
        await audio.play();
        audio.pause();
        audioEnabled = true;
        player.querySelector("[data-action='enable-audio']").textContent =
          "Audio enabled";
        player.querySelector("[data-status]").textContent =
          "This window can now play the shared file.";
        syncLocalAudio(data, Date.now());
      } catch {
        player.querySelector("[data-status]").textContent =
          "The audio file could not play in this window.";
      }
    }

    player.defaultData = {
      isPlaying: false,
      startedAtMs: 0,
      positionMs: 0,
    };

    player.updateElement = ({ element, data }) => {
      render(element, data, Date.now());
    };

    player.onClick = (event, { data, setData }) => {
      const action = event.target.closest("[data-action]")?.dataset.action;
      if (!action) return;

      if (action === "enable-audio") {
        void enableAudio(data);
        return;
      }

      const nowMs = Date.now();
      if (action === "toggle") {
        const positionMs = playbackPositionMs(data, nowMs);
        setData((draft) => {
          draft.isPlaying = !data.isPlaying;
          draft.positionMs = positionMs;
          draft.startedAtMs = nowMs - positionMs;
        });
      }

      if (action === "restart") {
        setData((draft) => {
          draft.positionMs = 0;
          draft.startedAtMs = nowMs;
        });
      }
    };

    player.onMount = ({ getData, getElement }) => {
      let animationFrame = 0;
      const tick = () => {
        const data = getData();
        const nowMs = Date.now();
        render(getElement(), data, nowMs);
        syncLocalAudio(data, nowMs);
        animationFrame = requestAnimationFrame(tick);
      };
      animationFrame = requestAnimationFrame(tick);
      return () => {
        cancelAnimationFrame(animationFrame);
        audio.pause();
      };
    };

    await playhtml.init({ developmentMode: true });
  </script>
</body>
</html>`,
};
