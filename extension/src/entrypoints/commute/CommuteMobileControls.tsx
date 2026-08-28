// ABOUTME: Provides boarding, orientation, fullscreen, and joystick controls for mobile Commute.
// ABOUTME: Keeps screen-space controls outside the scaled train artwork.

import {
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type SyntheticEvent,
  useEffect,
  useRef,
  useState,
} from "react";
import type { CommutePoint } from "./commuteMobile";
import { CommuteMobileTransitPass } from "./CommuteMobileTransitPass";

interface LandscapeOrientation extends ScreenOrientation {
  lock?: (orientation: "landscape") => Promise<void>;
}

interface CommuteMobileControlsProps {
  boarded: boolean;
  onBoard: () => void;
  onMove: (vector: CommutePoint) => void;
}

const COMMUTE_BOARDING_GATE_QUERY = [
  "(hover: none) and (pointer: coarse) and (max-width: 900px) and (orientation: portrait)",
  "(hover: none) and (pointer: coarse) and (max-width: 950px) and (max-height: 600px) and (orientation: landscape)",
].join(", ");

export function keepCommuteCursorInCar(event: SyntheticEvent) {
  event.stopPropagation();
}

function shouldUseTouchFullscreen(): boolean {
  return (
    typeof window.matchMedia !== "function" ||
    window.matchMedia("(hover: none) and (pointer: coarse)").matches
  );
}

export function useCommuteBoardingGate(): boolean {
  const [visible, setVisible] = useState(
    () => window.matchMedia?.(COMMUTE_BOARDING_GATE_QUERY).matches ?? false,
  );

  useEffect(() => {
    const query = window.matchMedia?.(COMMUTE_BOARDING_GATE_QUERY);
    if (!query) return;
    const update = () => setVisible(query.matches);
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);

  return visible;
}

async function enterLandscapeFullscreen(): Promise<void> {
  const root = document.documentElement;
  if (!document.fullscreenElement && root.requestFullscreen) {
    await root.requestFullscreen({ navigationUI: "hide" });
  }

  const orientation = window.screen.orientation as LandscapeOrientation;
  if (!orientation?.lock) return;

  try {
    await orientation.lock("landscape");
  } catch {
    // Orientation locking is optional and commonly rejected outside mobile browsers.
  }
}

async function toggleFullscreen(): Promise<void> {
  if (document.fullscreenElement) {
    await document.exitFullscreen();
    return;
  }
  await enterLandscapeFullscreen();
}

export function CommuteMobileControls({
  boarded,
  onBoard,
  onMove,
}: CommuteMobileControlsProps) {
  const [canFullscreen, setCanFullscreen] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [knob, setKnob] = useState<CommutePoint>({ x: 0, y: 0 });
  const joystickCenter = useRef<CommutePoint | null>(null);
  const joystickActive = useRef(false);

  useEffect(() => {
    const updateFullscreenState = () => {
      setIsFullscreen(document.fullscreenElement !== null);
    };

    setCanFullscreen(
      shouldUseTouchFullscreen() &&
        typeof document.documentElement.requestFullscreen === "function",
    );
    updateFullscreenState();
    document.addEventListener("fullscreenchange", updateFullscreenState);
    return () => {
      document.removeEventListener("fullscreenchange", updateFullscreenState);
      onMove({ x: 0, y: 0 });
    };
  }, [onMove]);

  const updateJoystick = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!joystickActive.current || !joystickCenter.current) return;
    let x = event.clientX - joystickCenter.current.x;
    let y = event.clientY - joystickCenter.current.y;
    const magnitude = Math.hypot(x, y);
    const maximum = 34;
    if (magnitude > maximum) {
      x = (x / magnitude) * maximum;
      y = (y / magnitude) * maximum;
    }
    setKnob({ x, y });
    onMove({ x: x / maximum, y: y / maximum });
  };

  const stopJoystick = () => {
    joystickActive.current = false;
    joystickCenter.current = null;
    setKnob({ x: 0, y: 0 });
    onMove({ x: 0, y: 0 });
  };

  const board = () => {
    onBoard();
    if (!shouldUseTouchFullscreen()) return;

    void enterLandscapeFullscreen().catch(() => {
      // Boarding remains available when fullscreen is unavailable or denied.
    });
  };

  return (
    <div className="commute-mobile-controls">
      <aside className="commute-mobile-rotate" aria-label="Rotate your phone">
        <span className="commute-mobile-rotate__phone" aria-hidden>
          <span />
        </span>
        <strong>rotate to board</strong>
        <p>the train runs best sideways</p>
      </aside>

      {!boarded && (
        <aside className="commute-mobile-board">
          <span className="commute-mobile-board__wordmark">we were online</span>
          <strong>internet commute</strong>
          <p>
            A slow train through the recent web. Ride with the joystick, sit
            anywhere, step off wherever it stops
          </p>
          <button type="button" onClick={board}>
            tap to board
          </button>
          <small>GOES FULLSCREEN · BEST IN LANDSCAPE</small>
        </aside>
      )}

      {boarded && (
        <>
          <span className="commute-mobile-wordmark">we were online</span>
          {canFullscreen && (
            <button
              className="commute-mobile-fullscreen"
              type="button"
              onClick={() => void toggleFullscreen()}
              aria-label={isFullscreen ? "Exit fullscreen" : "Enter fullscreen"}
              title={isFullscreen ? "Exit fullscreen" : "Enter fullscreen"}
            >
              <svg
                width="18"
                height="18"
                viewBox="0 0 18 18"
                fill="none"
                aria-hidden
              >
                <path d="M2 6V2h4M12 2h4v4M16 12v4h-4M6 16H2v-4" />
              </svg>
            </button>
          )}

          <div
            className="commute-mobile-joystick"
            role="group"
            aria-label="Move around the train"
            onPointerDown={(event) => {
              event.currentTarget.setPointerCapture(event.pointerId);
              const bounds = event.currentTarget.getBoundingClientRect();
              joystickCenter.current = {
                x: bounds.left + bounds.width / 2,
                y: bounds.top + bounds.height / 2,
              };
              joystickActive.current = true;
              updateJoystick(event);
            }}
            onPointerMove={updateJoystick}
            onPointerUp={stopJoystick}
            onPointerCancel={stopJoystick}
          >
            <span
              style={
                {
                  "--joystick-x": `${knob.x}px`,
                  "--joystick-y": `${knob.y}px`,
                } as CSSProperties
              }
            />
          </div>

          <CommuteMobileTransitPass />
        </>
      )}
    </div>
  );
}
