// ABOUTME: Provides the copy-paste React source for the synchronized-sound example.
// ABOUTME: Mirrors event-driven cues and a shared generated-audio transport.

export const synchronizedSoundReactSource = `// ABOUTME: Broadcasts one-shot tones and shares a generated loop transport.
// ABOUTME: Keeps Web Audio permission and scheduling local to each browser.
import { useCallback, useEffect, useRef, useState } from "react";
import {
  PlayProvider,
  usePlayContext,
  withSharedState,
} from "@playhtml/react";

type TransportData = {
  isPlaying: boolean;
  startedAtMs: number;
  positionMs: number;
};

const CUE_EVENT = "synchronized-sound-cue";
const STEP_MS = 500;
const LOOP_MS = 2000;
const PATTERN = [261.63, 329.63, 392, 523.25];

function loopPositionMs(data: TransportData, nowMs: number): number {
  const elapsedMs = data.isPlaying
    ? nowMs - data.startedAtMs
    : data.positionMs;
  return ((elapsedMs % LOOP_MS) + LOOP_MS) % LOOP_MS;
}

const SharedSound = withSharedState<TransportData>(
  {
    id: "sound-transport",
    defaultData: {
      isPlaying: false,
      startedAtMs: 0,
      positionMs: 0,
    },
  },
  function SharedSoundView({ data, setData }) {
    const {
      dispatchPlayEvent,
      registerPlayEventListener,
      removePlayEventListener,
    } = usePlayContext();
    const dataRef = useRef(data);
    const audioContextRef = useRef<AudioContext | null>(null);
    const scheduledStartRef = useRef<number | null>(null);
    const nextStepRef = useRef(0);
    const patternGainsRef = useRef(new Set<GainNode>());
    const [audioEnabled, setAudioEnabled] = useState(false);
    const [audioStatus, setAudioStatus] = useState(
      "Audio is off in this window.",
    );
    const [positionMs, setPositionMs] = useState(0);

    dataRef.current = data;

    const playTone = useCallback((
      frequency: number,
      startTime: number,
      duration: number,
      volume: number,
      patternTone = false,
    ) => {
      const audioContext = audioContextRef.current;
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

      if (patternTone) patternGainsRef.current.add(gain);
      oscillator.addEventListener("ended", () => {
        patternGainsRef.current.delete(gain);
        oscillator.disconnect();
        gain.disconnect();
      }, { once: true });
    }, []);

    const silencePattern = useCallback(() => {
      const audioContext = audioContextRef.current;
      if (!audioContext) return;

      for (const gain of patternGainsRef.current) {
        gain.gain.cancelScheduledValues(audioContext.currentTime);
        gain.gain.setValueAtTime(0.0001, audioContext.currentTime);
      }
      patternGainsRef.current.clear();
    }, []);

    const playCue = useCallback(() => {
      const audioContext = audioContextRef.current;
      if (!audioContext || audioContext.state !== "running") {
        setAudioStatus(
          "A chime arrived. Enable audio to hear future sounds in this window.",
        );
        return;
      }
      playTone(880, audioContext.currentTime + 0.01, 0.28, 0.16);
      setAudioStatus("Chime received in this window.");
    }, [playTone]);

    useEffect(() => {
      const listenerId = registerPlayEventListener(CUE_EVENT, {
        onEvent: playCue,
      });
      return () => removePlayEventListener(CUE_EVENT, listenerId);
    }, [
      playCue,
      registerPlayEventListener,
      removePlayEventListener,
    ]);

    const schedulePattern = useCallback((
      transport: TransportData,
      nowMs: number,
    ) => {
      const audioContext = audioContextRef.current;
      if (
        !audioContext ||
        audioContext.state !== "running" ||
        !transport.isPlaying
      ) {
        if (scheduledStartRef.current !== null) silencePattern();
        scheduledStartRef.current = null;
        return;
      }

      if (scheduledStartRef.current !== transport.startedAtMs) {
        silencePattern();
        scheduledStartRef.current = transport.startedAtMs;
        const elapsedMs = Math.max(0, nowMs - transport.startedAtMs);
        const currentStep = Math.floor(elapsedMs / STEP_MS);
        playTone(
          PATTERN[currentStep % PATTERN.length],
          audioContext.currentTime + 0.01,
          0.18,
          0.09,
          true,
        );
        nextStepRef.current = currentStep + 1;
      }

      const scheduleThroughMs = nowMs + 120;
      let beatAtMs =
        transport.startedAtMs + nextStepRef.current * STEP_MS;
      while (beatAtMs <= scheduleThroughMs) {
        if (beatAtMs >= nowMs - 20) {
          const delaySeconds = Math.max(0, beatAtMs - nowMs) / 1000;
          playTone(
            PATTERN[nextStepRef.current % PATTERN.length],
            audioContext.currentTime + delaySeconds,
            0.18,
            0.09,
            true,
          );
        }
        nextStepRef.current += 1;
        beatAtMs =
          transport.startedAtMs + nextStepRef.current * STEP_MS;
      }
    }, [playTone, silencePattern]);

    useEffect(() => {
      let animationFrame = 0;
      const tick = () => {
        const nowMs = Date.now();
        const transport = dataRef.current;
        setPositionMs(loopPositionMs(transport, nowMs));
        schedulePattern(transport, nowMs);
        animationFrame = requestAnimationFrame(tick);
      };

      animationFrame = requestAnimationFrame(tick);
      return () => {
        cancelAnimationFrame(animationFrame);
        silencePattern();
        void audioContextRef.current?.close();
      };
    }, [schedulePattern, silencePattern]);

    async function enableAudio() {
      const AudioContextClass =
        window.AudioContext ||
        (window as typeof window & {
          webkitAudioContext?: typeof AudioContext;
        }).webkitAudioContext;

      if (!AudioContextClass) {
        setAudioStatus("Web Audio is not available in this browser.");
        return;
      }

      if (!audioContextRef.current) {
        audioContextRef.current = new AudioContextClass();
      }
      await audioContextRef.current.resume();
      scheduledStartRef.current = null;
      setAudioEnabled(true);
      setAudioStatus("Audio is enabled in this window.");
    }

    function toggleTransport() {
      const nowMs = Date.now();
      const position = loopPositionMs(data, nowMs);
      setData((draft) => {
        draft.isPlaying = !data.isPlaying;
        draft.positionMs = position;
        draft.startedAtMs = nowMs - position;
      });
    }

    function restartTransport() {
      const nowMs = Date.now();
      setData((draft) => {
        draft.positionMs = 0;
        draft.startedAtMs = nowMs;
      });
    }

    const activeStep = Math.floor(positionMs / STEP_MS) % PATTERN.length;

    return (
      <section id="sound-transport">
        <div className="audio-unlock">
          <button type="button" onClick={() => void enableAudio()}>
            {audioEnabled ? "Audio enabled" : "Enable audio"}
          </button>
          <p>
            <strong>Do this in every window.</strong> Browsers require a local
            click before a page can make sound.
          </p>
        </div>

        <div className="panel">
          <p className="eyebrow">Transient event</p>
          <h2>One-shot cue</h2>
          <p className="panel-copy">
            This chime plays once for everyone currently connected. It is not
            replayed for late joiners.
          </p>
          <button
            className="primary"
            type="button"
            onClick={() => dispatchPlayEvent({ type: CUE_EVENT })}
          >
            Send chime
          </button>
        </div>

        <div className="panel">
          <p className="eyebrow">Persistent shared data</p>
          <h2>Four-beat loop</h2>
          <p className="panel-copy">
            Play, pause, and position are shared. Each window generates the
            tones locally from the same timeline.
          </p>
          <div className="controls">
            <button
              className="primary"
              type="button"
              onClick={toggleTransport}
            >
              {data.isPlaying ? "Pause loop" : "Play loop"}
            </button>
            <button type="button" onClick={restartTransport}>Restart</button>
          </div>
          <div className="timeline">
            <div className="timeline-head">
              <strong>
                {data.isPlaying ? "Playing for everyone" : "Paused for everyone"}
              </strong>
              <span className="time">
                {(positionMs / 1000).toFixed(1)} / 2.0s
              </span>
            </div>
            <div
              className="track"
              role="progressbar"
              aria-label="Loop position"
              aria-valuemin={0}
              aria-valuemax={LOOP_MS}
              aria-valuenow={Math.round(positionMs)}
            >
              <div
                className="progress"
                style={{ width: (positionMs / LOOP_MS) * 100 + "%" }}
              />
            </div>
            <div className="steps" aria-hidden="true">
              {["C", "E", "G", "C"].map((note, index) => (
                <span
                  className="step"
                  data-active={index === activeStep}
                  key={index}
                >
                  {note}
                </span>
              ))}
            </div>
          </div>
        </div>
        <p className="local-status" role="status">{audioStatus}</p>
      </section>
    );
  },
);

export default function App() {
  return (
    <PlayProvider initOptions={{ developmentMode: true }}>
      <main>
        <h1>Synchronized sound</h1>
        <p className="intro">
          A one-shot cue reaches people who are here now. The loop stores a
          shared timeline, so late joiners start on the current beat.
        </p>
        <SharedSound />
      </main>

      <style>{\`
        :root {
          color: #3d3833;
          background: #f7f3ea;
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
          font-synthesis: none;
        }
        * { box-sizing: border-box; }
        body { margin: 0; }
        #root { min-height: 100vh; padding: clamp(1rem, 5vw, 4rem); }
        main { width: min(760px, 100%); margin: 0 auto; }
        h1 {
          margin: 0 0 1rem;
          color: #274b9e;
          font-size: clamp(2.4rem, 8vw, 5rem);
          line-height: 0.95;
        }
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
        .eyebrow {
          margin: 0;
          color: #5e5751;
          font-size: 0.75rem;
          font-weight: 800;
          letter-spacing: 0.12em;
          text-transform: uppercase;
        }
        h2 { margin: 0.35rem 0 0.6rem; font-size: 1.45rem; }
        .panel-copy { margin: 0 0 1rem; line-height: 1.5; }
        button {
          appearance: none;
          padding: 0.7rem 1rem;
          border: 2px solid #3d3833;
          border-radius: 0;
          background: #fff;
          color: inherit;
          box-shadow: 3px 3px 0 #3d3833;
          cursor: pointer;
          font: inherit;
          font-weight: 750;
        }
        button:hover { background: #ffe95c; }
        button:active {
          translate: 2px 2px;
          box-shadow: 1px 1px 0 #3d3833;
        }
        .primary { background: #274b9e; color: #fff; }
        .primary:hover { background: #355fae; }
        .controls { display: flex; flex-wrap: wrap; gap: 0.7rem; }
        .timeline { margin-top: 1.25rem; }
        .timeline-head {
          display: flex;
          align-items: baseline;
          justify-content: space-between;
          gap: 1rem;
          margin-bottom: 0.5rem;
        }
        .time { font-variant-numeric: tabular-nums; font-weight: 750; }
        .track {
          height: 18px;
          overflow: hidden;
          border: 2px solid #3d3833;
          background: #d9d3ca;
        }
        .progress { height: 100%; background: #274b9e; }
        .steps {
          display: grid;
          grid-template-columns: repeat(4, 1fr);
          gap: 0.4rem;
          margin-top: 0.55rem;
        }
        .step {
          display: grid;
          height: 34px;
          border: 2px solid #3d3833;
          background: #fff;
          place-items: center;
          font-size: 0.78rem;
          font-weight: 800;
        }
        .step[data-active="true"] { background: #ffe95c; }
        .local-status {
          min-height: 1.5em;
          margin: 0.8rem 0 0;
          color: #5e5751;
        }
      \`}</style>
    </PlayProvider>
  );
}
`;
