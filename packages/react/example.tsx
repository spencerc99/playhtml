import * as React from "react";
import { CanPlayElement } from "./src/index";

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
