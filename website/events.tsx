import { PlayContext } from "@playhtml/react/src/PlayProvider";
import { useContext, useEffect } from "react";

const ConfettiEventType = "confetti";

export function Confetti() {
  const {
    registerPlayEventListener,
    removePlayEventListener,
    dispatchPlayEvent,
  } = useContext(PlayContext);

  useEffect(() => {
    const id = registerPlayEventListener(ConfettiEventType, {
      onEvent: () => {
        confetti({
          particleCount: 100,
          spread: 70,
          origin: { y: 0.6 },
        });
      },
    });

    return () => removePlayEventListener(ConfettiEventType, id);
  }, []);
}

export function triggerConfetti() {
  const { dispatchPlayEvent } = useContext(PlayContext);
  dispatchPlayEvent(ConfettiEventType);
}

// interface ReactionEvent {
//     type: 'reaction';
//     emoji: string;
//     size?: number;
// }
// export function LiveReaction() {
//     window.dispatchEvent({
//         type:
//     })
// }
