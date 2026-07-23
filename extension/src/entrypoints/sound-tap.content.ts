// ABOUTME: Observes media playback from the page's MAIN JavaScript world.
// ABOUTME: Bridges metadata for play calls and play events to the isolated collector.

export const SOUND_PLAY_MESSAGE_TYPE = "wewe:sound-play";

type SoundMediaKind = "audio" | "video";

interface SoundPlayMessage {
  type: typeof SOUND_PLAY_MESSAGE_TYPE;
  src: string;
  mediaKind: SoundMediaKind;
  detached: boolean;
  duration?: number;
  timestamp: number;
}

function postSoundPlay(element: HTMLMediaElement): void {
  try {
    const duration = element.duration;
    const message: SoundPlayMessage = {
      type: SOUND_PLAY_MESSAGE_TYPE,
      src: element.currentSrc || element.src,
      mediaKind: element.tagName.toLowerCase() === "video" ? "video" : "audio",
      detached: !element.isConnected,
      timestamp: Date.now(),
    };

    if (Number.isFinite(duration)) {
      message.duration = duration;
    }

    window.postMessage(message, "*");
  } catch {
    // Page-defined media accessors and postMessage patches must not affect playback.
  }
}

export function installSoundTap(): () => void {
  const mediaPrototype = HTMLMediaElement.prototype;
  const originalPlay = mediaPrototype.play;

  function play(
    this: HTMLMediaElement,
    ...args: Parameters<HTMLMediaElement["play"]>
  ) {
    postSoundPlay(this);
    return Reflect.apply(originalPlay, this, args);
  }

  const playEventHandler = (event: Event) => {
    try {
      if (event.target instanceof HTMLMediaElement) {
        postSoundPlay(event.target);
      }
    } catch {
      // Page-defined event properties must not affect other document listeners.
    }
  };

  try {
    mediaPrototype.play = play;
    document.addEventListener("play", playEventHandler, true);
  } catch {
    // A page may lock either object before this document-start script runs.
  }

  return () => {
    try {
      document.removeEventListener("play", playEventHandler, true);
      if (mediaPrototype.play === play) {
        mediaPrototype.play = originalPlay;
      }
    } catch {
      // Cleanup must not overwrite a page's later patch or throw into page code.
    }
  };
}

export default defineContentScript({
  matches: ["http://*/*", "https://*/*"],
  runAt: "document_start",
  allFrames: false,
  world: "MAIN",
  main() {
    installSoundTap();
  },
});
