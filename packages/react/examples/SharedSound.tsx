import { withPlay } from "@playhtml/react";
import { useEffect } from "react";

export const SharedSound = withPlay<{ soundUrl: string }>()(
  { defaultData: { isPlaying: false } },
  ({ data, setData, props, ref }) => {
    const { soundUrl } = props;
    const { isPlaying } = data;
    useEffect(() => {
      // This is only needed because of chrome's disabling of autoplay until you have interacted with the page.
      const listener = () => {
        if (isPlaying) {
          (ref.current as HTMLAudioElement)?.play();
        } else if (!isPlaying) {
          (ref.current as HTMLAudioElement)?.pause();
        }
      };
      document.addEventListener("click", listener);

      () => document.removeEventListener("click", listener);
    }, []);

    return (
      <audio
        className="sound-file"
        id="sound"
        controls
        src={soundUrl}
        loop
        autoPlay={isPlaying}
        muted
        onPlay={() => setData({ isPlaying: true })}
      />
    );
  }
);
