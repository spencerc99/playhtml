import * as React from "react";
import {
  CanPlayElement,
  CanToggleElement,
  playhtml,
  withPlay,
} from "./src/index";
import { useState } from "react";

playhtml.init();

export const Candle = withPlay()(
  { defaultData: { on: false } },
  ({ data, setData }) => {
    return (
      <img
        src={data.on ? "/candle-gif.gif" : "/candle-off.png"}
        selector-id=".candle"
        className="candle"
        onClick={() => setData({ on: !data.on })}
      />
    );
  }
);
interface Reaction {
  emoji: string;
  count: number;
}

// something like.. "userData" ?
export const ReactionView = withPlay<{ reaction: Reaction }>()(
  ({ reaction: { count } }) => ({
    defaultData: { count },
  }),
  ({ props, data, setData, ref }) => {
    const {
      reaction: { emoji },
    } = props;
    const [hasReacted, setHasReacted] = useState(false);

    React.useEffect(() => {
      if (ref.current) {
        console.log("effect", ref.current.id);
        // This should be managed by playhtml.. it should be stored in some sort of
        // locally-persisted storage.
        setHasReacted(Boolean(localStorage.getItem(ref.current.id)));
      }
    }, [ref.current?.id]);

    return (
      <button
        onClick={(_e) => {
          const { count } = data;
          console.log("onclick", ref.current?.id);
          if (hasReacted) {
            setData({ count: count - 1 });
            if (ref.current) {
              localStorage.removeItem(ref.current.id);
            }
            setHasReacted(false);
          } else {
            setData({ count: count + 1 });
            if (ref.current) {
              localStorage.setItem(ref.current.id, "true");
            }
            setHasReacted(true);
          }
        }}
        className={`reaction ${hasReacted ? "reacted" : ""}`}
        selector-id=".reactions reaction"
      >
        {emoji} <span className="count">{data.count}</span>
      </button>
    );
  }
);

export function Lamp() {
  return (
    <CanToggleElement>
      {({ data }) => {
        const on = typeof data === "object" ? data.on : data;
        return (
          <img
            src="/noguchi-akari-a1.png"
            selector-id=".lamp"
            className="lamp"
            id="lamp"
            style={{ opacity: on ? 1 : 0.5 }}
          />
        );
      }}
    </CanToggleElement>
  );
}

export const OnlineIndicator = withPlay()(
  { defaultData: {}, myDefaultAwareness: "#008000", id: "online-indicator" },
  ({ myAwareness, setMyAwareness, awareness }) => {
    const myAwarenessIdx = myAwareness ? awareness.indexOf(myAwareness) : -1;
    return (
      <>
        {awareness.map((val, idx) => (
          <div
            key={idx}
            style={{
              width: "50px",
              height: "50px",
              borderRadius: "50%",
              background: val,
              boxShadow:
                idx === myAwarenessIdx
                  ? "0px 0px 30px 10px rgb(245, 169, 15)"
                  : undefined,
            }}
          ></div>
        ))}
        <input
          type="color"
          onChange={(e) => setMyAwareness(e.target.value)}
          value={myAwareness}
        />
      </>
    );
  }
);

export const SharedSound = withPlay<{ soundUrl: string }>()(
  { defaultData: { isPlaying: false } },
  ({ data, setData, props, ref }) => {
    const { soundUrl } = props;
    const { isPlaying } = data;
    React.useEffect(() => {
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

export function SharedYoutube(video: string) {
  // TODO: extract url
  // 2. This code loads the IFrame Player API code asynchronously.
  var tag = document.createElement("script");

  tag.src = "https://www.youtube.com/iframe_api";
  var firstScriptTag = document.getElementsByTagName("script")[0];
  firstScriptTag.parentNode.insertBefore(tag, firstScriptTag);

  // 3. This function creates an <iframe> (and YouTube player)
  //    after the API code downloads.
  var player;
  function onYouTubeIframeAPIReady() {
    player = new YT.Player("player", {
      height: "390",
      width: "640",
      videoId: video,
      playerVars: {
        playsinline: 1,
      },
      events: {
        onReady: onPlayerReady,
        onStateChange: onPlayerStateChange,
      },
    });
  }

  // 4. The API will call this function when the video player is ready.
  function onPlayerReady(event) {
    event.target.playVideo();
  }

  // 5. The API calls this function when the player's state changes.
  //    The function indicates that when playing a video (state=1),
  //    the player should play for six seconds and then stop.
  var done = false;
  function onPlayerStateChange(event) {
    if (event.data == YT.PlayerState.PLAYING && !done) {
      setTimeout(stopVideo, 6000);
      done = true;
    }
  }
  function stopVideo() {
    player.stopVideo();
  }

  const defaultData = {
    isPlaying: false,
    playbackTime: 0,
  };

  return <CanPlayElement defaultData={defaultData}></CanPlayElement>;
}

/*
youtube video with playback time and playing status.
- on video play, do you broadcast the new playback time? a lot of unnecessary events.. Ideally, you only want to see playback when you join the room.
- when new client connects, sync with playback time and playback status,
*/

export function MirrorableElement() {
  const testRef = React.useRef<HTMLDivElement>(null);
  return <input can-mirror="true"></input>;
}
