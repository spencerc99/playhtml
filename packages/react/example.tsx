import * as React from "react";
import { CanPlayElement, CanToggleElement, playhtml } from "./src/index";
import { useState } from "react";

playhtml.init();

export function Candle() {
  return (
    <CanPlayElement
      defaultData={{ on: false }}
      onClick={(_e, { data, setData }) => {
        setData({ on: !data.on });
      }}
    >
      {({ data }) => (
        <img
          src={data.on ? "/candle-gif.gif" : "/candle-off.png"}
          selector-id=".candle"
          className="candle"
        />
      )}
    </CanPlayElement>
  );
}

interface Reaction {
  emoji: string;
  count: number;
}

export function ReactionView({ reaction }: { reaction: Reaction }) {
  const [hasReacted, setHasReacted] = useState(false);

  return (
    <CanPlayElement
      defaultData={{ count: reaction.count }}
      onClick={(_e, { setData, data, element }) => {
        const { count } = data;
        if (hasReacted) {
          setData({ count: count - 1 });
          localStorage.removeItem(element.id);
          setHasReacted(false);
        } else {
          setData({ count: count + 1 });
          localStorage.setItem(element.id, "true");
          setHasReacted(true);
        }
      }}
      onMount={({ getElement }) => {
        setHasReacted(Boolean(localStorage.getItem(getElement().id)));
      }}
    >
      {({ data }) => {
        return (
          <button
            className={`reaction ${hasReacted ? "reacted" : ""}`}
            selector-id=".reactions reaction"
          >
            {reaction.emoji} <span className="count">{data.count}</span>
          </button>
        );
      }}
    </CanPlayElement>
  );
}

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

export function OnlineIndicator() {
  return (
    <CanPlayElement
      defaultData={{}}
      myDefaultAwareness={"#008000"}
      id="online-indicator"
    >
      {({ myAwareness, setMyAwareness, awareness }) => {
        const myAwarenessIdx = myAwareness
          ? awareness.indexOf(myAwareness)
          : -1;
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
      }}
    </CanPlayElement>
  );
}

export function SharedSound({ soundUrl }: { soundUrl: string }) {
  return (
    <CanPlayElement
      defaultData={{ isPlaying: false }}
      onMount={({ getData, getElement }) => {
        // This is only needed because of chrome's disabling of autoplay until you have interacted with the page.
        document.addEventListener("click", () => {
          const { isPlaying } = getData();

          if (isPlaying) {
            (getElement() as HTMLAudioElement)?.play();
          } else if (!isPlaying) {
            (getElement() as HTMLAudioElement)?.pause();
          }
        });
      }}
    >
      {({ data: { isPlaying }, setData, ref }) => {
        if (isPlaying) {
          (ref.current as HTMLAudioElement)?.play();
        } else if (!isPlaying) {
          (ref.current as HTMLAudioElement)?.pause();
        }
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
      }}
    </CanPlayElement>
  );
}

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
