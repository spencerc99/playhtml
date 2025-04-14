import React, { useEffect, useRef } from "react";
import { withSharedState } from "@playhtml/react";

export const SharedSound = withSharedState(
  { defaultData: { isPlaying: false, timestamp: 0 } },
  ({ data, setData }, { soundUrl }) => {
    const audioRef = useRef<HTMLAudioElement | null>(null);

    useEffect(() => {
      if (data.isPlaying) {
        audioRef.current?.play();
      } else {
        audioRef.current?.pause();
      }
    }, [data.isPlaying]);

    return (
      <div id="sound">
        <audio
          ref={audioRef}
          src={soundUrl}
          className="sound-file"
          controls
          loop
        />
        <button
          onClick={() =>
            setData({ isPlaying: !data.isPlaying, timestamp: Date.now() })
          }
        >
          {data.isPlaying ? "Pause" : "Play"}
        </button>
      </div>
    );
  }
);
