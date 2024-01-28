import React from "react";
import { PlayContext } from "@playhtml/react";
import { useContext, useEffect } from "react";

const ConfettiEventType = "confetti";

export function useConfetti() {
  const {
    registerPlayEventListener,
    removePlayEventListener,
    dispatchPlayEvent,
  } = useContext(PlayContext);

  useEffect(() => {
    const id = registerPlayEventListener(ConfettiEventType, {
      onEvent: () => {
        // requires importing <script src="https://cdn.jsdelivr.net/npm/canvas-confetti@1.9.2/dist/confetti.browser.min.js"></script>
        // somewhere in your app
        window.confetti({
          particleCount: 100,
          spread: 70,
          origin: { y: 0.6 },
        });
      },
    });

    return () => removePlayEventListener(ConfettiEventType, id);
  }, []);

  return () => {
    dispatchPlayEvent({ type: ConfettiEventType });
  };
}

export function ConfettiZone() {
  const triggerConfetti = useConfetti();

  return (
    <div
      style={{ width: "400px", height: "400px", border: "1px red solid" }}
      id="confettiZone"
      onClick={() => triggerConfetti()}
    >
      <h1>CONFETTI ZONE</h1>
    </div>
  );
}
