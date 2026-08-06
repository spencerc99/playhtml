// ABOUTME: Provides the mobile orientation prompt and fullscreen control for Internet Commute.
// ABOUTME: Treats landscape locking as an optional enhancement when the browser supports it.

import { useEffect, useState } from "react";

interface LandscapeOrientation extends ScreenOrientation {
  lock?: (orientation: "landscape") => Promise<void>;
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

export function CommuteMobileControls() {
  const [canFullscreen, setCanFullscreen] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);

  useEffect(() => {
    const updateFullscreenState = () => {
      setIsFullscreen(document.fullscreenElement !== null);
    };

    setCanFullscreen(
      typeof document.documentElement.requestFullscreen === "function",
    );
    updateFullscreenState();
    document.addEventListener("fullscreenchange", updateFullscreenState);
    return () => {
      document.removeEventListener("fullscreenchange", updateFullscreenState);
    };
  }, []);

  const requestFullscreen = async () => {
    try {
      await enterLandscapeFullscreen();
    } catch {
      // The landscape prompt remains useful when fullscreen is unavailable or denied.
    }
  };

  return (
    <>
      <aside className="commute-mobile-orientation">
        <span className="commute-mobile-orientation__phone" aria-hidden="true">
          <span />
        </span>
        <strong>turn your phone sideways</strong>
        <p>the whole carriage fits better in landscape</p>
        {canFullscreen ? (
          <button type="button" onClick={() => void requestFullscreen()}>
            enter fullscreen
          </button>
        ) : null}
      </aside>

      {canFullscreen && !isFullscreen ? (
        <button
          className="commute-mobile-fullscreen"
          type="button"
          onClick={() => void requestFullscreen()}
          aria-label="Enter fullscreen"
          title="Enter fullscreen"
        >
          <span aria-hidden="true">⛶</span>
        </button>
      ) : null}
    </>
  );
}
