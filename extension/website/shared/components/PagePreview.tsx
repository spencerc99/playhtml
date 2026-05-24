// ABOUTME: Renders an abstract preview of a web page inside an SVG foreignObject.
// ABOUTME: Renders at desktop width then scales down to fit the viewport rect.
import React, { memo } from "react";

interface PagePreviewProps {
  url: string;
  x: number;
  y: number;
  width: number;
  height: number;
  scrollY: number;
  scrollRange: number;
}

const RENDER_WIDTH = 1280;
const YT_ASPECT = 16 / 9;

// Parse a YouTube video ID from any common YouTube URL shape, or return null.
function extractYouTubeVideoId(url: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }

  const host = parsed.hostname.replace(/^www\./, "");
  const isYouTube =
    host === "youtube.com" ||
    host === "m.youtube.com" ||
    host === "music.youtube.com" ||
    host === "youtube-nocookie.com" ||
    host === "youtu.be";
  if (!isYouTube) return null;

  // youtu.be/<id>
  if (host === "youtu.be") {
    const id = parsed.pathname.slice(1).split("/")[0];
    return /^[a-zA-Z0-9_-]{11}$/.test(id) ? id : null;
  }

  // youtube.com/watch?v=<id>
  const vParam = parsed.searchParams.get("v");
  if (vParam && /^[a-zA-Z0-9_-]{11}$/.test(vParam)) return vParam;

  // youtube.com/embed/<id>, /shorts/<id>, /live/<id>
  const m = parsed.pathname.match(/^\/(?:embed|shorts|live|v)\/([a-zA-Z0-9_-]{11})/);
  return m ? m[1] : null;
}

export const PagePreview = memo(
  ({
    url,
    x,
    y,
    width,
    height,
    scrollY,
    scrollRange,
  }: PagePreviewProps) => {
    const youtubeId = extractYouTubeVideoId(url);

    if (youtubeId) {
      // Fit a 16:9 embed inside the viewport rect, letterboxing on the shorter axis.
      const rectAspect = width / Math.max(1, height);
      let embedWidth = width;
      let embedHeight = width / YT_ASPECT;
      if (rectAspect > YT_ASPECT) {
        embedHeight = height;
        embedWidth = height * YT_ASPECT;
      }
      const offsetX = (width - embedWidth) / 2;
      const offsetY = (height - embedHeight) / 2;
      const embedSrc =
        `https://www.youtube-nocookie.com/embed/${youtubeId}` +
        `?autoplay=1&mute=1&loop=1&playlist=${youtubeId}` +
        `&controls=0&modestbranding=1&rel=0&playsinline=1&disablekb=1`;

      return (
        <foreignObject x={x} y={y} width={width} height={height}>
          <div
            xmlns="http://www.w3.org/1999/xhtml"
            style={{
              width: `${width}px`,
              height: `${height}px`,
              overflow: "hidden",
              background: "#000",
              pointerEvents: "none",
            }}
          >
            <iframe
              src={embedSrc}
              loading="lazy"
              tabIndex={-1}
              allow="autoplay; accelerometer; encrypted-media; gyroscope; picture-in-picture"
              style={{
                border: "none",
                position: "relative",
                left: `${offsetX}px`,
                top: `${offsetY}px`,
                width: `${embedWidth}px`,
                height: `${embedHeight}px`,
                pointerEvents: "none",
              }}
            />
          </div>
        </foreignObject>
      );
    }

    const scale = width / RENDER_WIDTH;
    const renderHeight = height / scale;
    const pageMultiplier = 2 + scrollRange * 4;
    const pageHeight = renderHeight * pageMultiplier;
    const scrollOffset = scrollY * (pageHeight - renderHeight);

    return (
      <foreignObject x={x} y={y} width={width} height={height}>
        <div
          xmlns="http://www.w3.org/1999/xhtml"
          style={{
            width: `${width}px`,
            height: `${height}px`,
            overflow: "hidden",
            pointerEvents: "none",
          }}
        >
          <iframe
            src={url}
            sandbox="allow-same-origin allow-scripts"
            loading="lazy"
            tabIndex={-1}
            style={{
              border: "none",
              width: `${RENDER_WIDTH}px`,
              height: `${pageHeight}px`,
              transform: `scale(${scale}) translateY(-${Math.round(scrollOffset)}px)`,
              transformOrigin: "top left",
              pointerEvents: "none",
            }}
          />
        </div>
      </foreignObject>
    );
  },
);

PagePreview.displayName = "PagePreview";
