// ABOUTME: Offers an explicit, cancellable check for matching photos in the local archive.
// ABOUTME: Requests small background batches and refreshes the collage after progress is saved.

import React, { useEffect, useRef, useState } from "react";
import browser from "webextension-polyfill";

const buttonStyle: React.CSSProperties = {
  padding: "5px 9px",
  border: "1px solid #d5d0c7",
  borderRadius: 4,
  background: "#f5f0e8",
  color: "inherit",
  font: "inherit",
  cursor: "pointer",
};

export function PhotoCheck({ onComplete }: { onComplete: () => void }) {
  const [running, setRunning] = useState(false);
  const [status, setStatus] = useState("");
  const cancelled = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      cancelled.current = true;
    };
  }, []);

  async function checkPhotos() {
    if (running) return;
    cancelled.current = false;
    setRunning(true);
    let checked = 0;
    let skipped = 0;
    let afterId: string | undefined;
    setStatus("Checking photos…");
    try {
      while (!cancelled.current) {
        const result = await browser.runtime.sendMessage({
          type: "CHECK_SCRAP_IMAGES",
          afterId,
        });
        if (
          !result ||
          result.error ||
          typeof result.checked !== "number" ||
          typeof result.skipped !== "number" ||
          typeof result.done !== "boolean"
        ) {
          throw new Error(
            result?.error || "Photos could not be checked. Please try again.",
          );
        }
        checked += result.checked;
        skipped += result.skipped;
        if (!mounted.current) return;
        setStatus(
          `${checked} checked${skipped ? ` · ${skipped} unavailable or skipped` : ""}`,
        );
        if (result.done) break;
        if (typeof result.afterId !== "string" || result.afterId === afterId)
          throw new Error("Photo check could not continue.");
        afterId = result.afterId;
      }
      if (mounted.current) {
        setStatus(
          `${cancelled.current ? "Stopped" : "Finished"}: ${checked} checked${skipped ? ` · ${skipped} unavailable or skipped` : ""}.`,
        );
      }
    } catch (error) {
      if (mounted.current)
        setStatus(
          error instanceof Error
            ? error.message
            : "Photos could not be checked.",
        );
    } finally {
      if (mounted.current) {
        setRunning(false);
        onComplete();
      }
    }
  }

  return (
    <details
      style={{
        position: "absolute",
        top: 66,
        right: 20,
        zIndex: 4,
        width: "min(280px, calc(100vw - 40px))",
        padding: "10px 12px",
        boxSizing: "border-box",
        background: "#faf9f6",
        border: "1px solid #ded9d1",
        borderRadius: 4,
        font: '10px/1.6 "Martian Mono", monospace',
        color: "#3d3833",
      }}
    >
      <summary style={{ cursor: "pointer" }}>check for matching photos</summary>
      <p>
        Checks saved photos and brings identical copies together. Every place
        you found them stays in the details.
      </p>
      <p>
        This downloads photos again, up to 5 MB each. You can stop at any time.
        Leaving this page stops the check after the current pair.
      </p>
      <button
        style={buttonStyle}
        type="button"
        disabled={running}
        onClick={() => void checkPhotos()}
      >
        Check saved photos
      </button>{" "}
      {running && (
        <button
          style={buttonStyle}
          type="button"
          onClick={() => {
            cancelled.current = true;
            setStatus("Stopping after the current photos…");
          }}
        >
          Stop
        </button>
      )}
      <p role="status" style={{ marginBottom: 0 }}>
        {status}
      </p>
    </details>
  );
}
