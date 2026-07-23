// ABOUTME: Provides the copy-paste React source for the shared audio-file example.
// ABOUTME: Mirrors the vanilla recipe with local media playback and shared transport data.

export const sharedAudioFileReactSource = `// ABOUTME: Keeps one audio file on a shared play, pause, and restart timeline.
// ABOUTME: Loads and plays the media locally while PlayHTML syncs only transport data.
import { useEffect, useRef, useState } from "react";
import { PlayProvider, withSharedState } from "@playhtml/react";

type TransportData = {
  isPlaying: boolean;
  startedAtMs: number;
  positionMs: number;
};

const AUDIO_URL =
  "https://interactive-examples.mdn.mozilla.net/media/cc0-audio/t-rex-roar.mp3";

function durationMs(audio: HTMLAudioElement | null): number {
  return audio && Number.isFinite(audio.duration) ? audio.duration * 1000 : 2000;
}

function playbackPositionMs(
  data: TransportData,
  nowMs: number,
  audio: HTMLAudioElement | null,
): number {
  const duration = durationMs(audio);
  const elapsed = data.isPlaying ? nowMs - data.startedAtMs : data.positionMs;
  return ((elapsed % duration) + duration) % duration;
}

const SharedAudioPlayer = withSharedState<TransportData>(
  {
    id: "shared-audio-player",
    defaultData: {
      isPlaying: false,
      startedAtMs: 0,
      positionMs: 0,
    },
  },
  function SharedAudioPlayerView({ data, setData }) {
    const audioRef = useRef<HTMLAudioElement | null>(null);
    const dataRef = useRef(data);
    const audioEnabledRef = useRef(false);
    const [positionMs, setPositionMs] = useState(0);
    const [audioEnabled, setAudioEnabled] = useState(false);
    const [status, setStatus] = useState(
      "Enable audio in this window before playing.",
    );

    dataRef.current = data;

    useEffect(() => {
      let animationFrame = 0;
      let cancelled = false;

      const tick = () => {
        const audio = audioRef.current;
        const transport = dataRef.current;
        const nowMs = Date.now();
        const expectedMs = playbackPositionMs(transport, nowMs, audio);
        setPositionMs(expectedMs);

        if (audio && audioEnabledRef.current) {
          const expectedSeconds = expectedMs / 1000;
          if (Math.abs(audio.currentTime - expectedSeconds) > 0.25) {
            audio.currentTime = expectedSeconds;
          }

          if (transport.isPlaying && audio.paused) {
            void audio.play().catch(() => {
              if (cancelled) return;
              audioEnabledRef.current = false;
              setAudioEnabled(false);
              setStatus("Audio is blocked in this window. Enable it again.");
            });
          } else if (!transport.isPlaying && !audio.paused) {
            audio.pause();
          }
        }

        animationFrame = requestAnimationFrame(tick);
      };

      animationFrame = requestAnimationFrame(tick);
      return () => {
        cancelled = true;
        cancelAnimationFrame(animationFrame);
        audioRef.current?.pause();
      };
    }, []);

    async function enableAudio() {
      const audio = audioRef.current;
      if (!audio) return;

      try {
        await audio.play();
        audio.pause();
        audioEnabledRef.current = true;
        setAudioEnabled(true);
        setStatus("This window can now play the shared file.");

        if (dataRef.current.isPlaying) {
          audio.currentTime =
            playbackPositionMs(dataRef.current, Date.now(), audio) / 1000;
          await audio.play();
        }
      } catch {
        audioEnabledRef.current = false;
        setAudioEnabled(false);
        setStatus("The audio file could not play in this window.");
      }
    }

    function togglePlayback() {
      const nowMs = Date.now();
      const position = playbackPositionMs(data, nowMs, audioRef.current);
      setData((draft) => {
        draft.isPlaying = !data.isPlaying;
        draft.positionMs = position;
        draft.startedAtMs = nowMs - position;
      });
    }

    function restartPlayback() {
      const nowMs = Date.now();
      setData((draft) => {
        draft.positionMs = 0;
        draft.startedAtMs = nowMs;
      });
    }

    const progress = (positionMs / durationMs(audioRef.current)) * 100;

    return (
      <section id="shared-audio-player" className="player">
        <audio ref={audioRef} src={AUDIO_URL} preload="auto" loop />

        <div className="file">
          <span className="file-icon" aria-hidden="true">♪</span>
          <span>t-rex-roar.mp3</span>
        </div>

        <div className="controls">
          <button type="button" onClick={() => void enableAudio()}>
            {audioEnabled ? "Audio enabled" : "Enable audio"}
          </button>
          <button className="primary" type="button" onClick={togglePlayback}>
            {data.isPlaying ? "Pause for everyone" : "Play for everyone"}
          </button>
          <button type="button" onClick={restartPlayback}>Restart</button>
        </div>

        <div className="timeline">
          <div className="timeline-head">
            <strong>
              {data.isPlaying ? "Playing for everyone" : "Paused for everyone"}
            </strong>
            <span>{(positionMs / 1000).toFixed(1)}s</span>
          </div>
          <div
            className="track"
            role="progressbar"
            aria-label="Audio position"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(progress)}
          >
            <div className="progress" style={{ width: progress + "%" }} />
          </div>
        </div>
        <p className="status" role="status">{status}</p>
      </section>
    );
  },
);

export default function App() {
  return (
    <PlayProvider initOptions={{ developmentMode: true }}>
      <main>
        <h1>Shared audio file</h1>
        <p className="intro">
          Every window plays the same file from the shared position.
        </p>
        <SharedAudioPlayer />
      </main>

      <style>{\`
        :root {
          color: #1c1c1c;
          background: #f4efe5;
          font-family: ui-sans-serif, system-ui, sans-serif;
        }
        * { box-sizing: border-box; }
        body { margin: 0; }
        #root {
          display: grid;
          min-height: 100vh;
          padding: 1.5rem;
          place-items: center;
        }
        main { width: min(34rem, 100%); }
        h1 {
          margin: 0 0 0.5rem;
          font-size: clamp(2rem, 8vw, 3.5rem);
          line-height: 1;
        }
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
        .track {
          height: 16px;
          overflow: hidden;
          border: 2px solid #1c1c1c;
          background: #e0d8c6;
        }
        .progress { height: 100%; background: #274b9e; }
        .status {
          min-height: 1.4em;
          margin: 0.8rem 0 0;
          color: #6a6a66;
          font-size: 0.9rem;
        }
      \`}</style>
    </PlayProvider>
  );
}
`;
