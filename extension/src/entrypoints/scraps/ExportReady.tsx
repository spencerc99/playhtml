// ABOUTME: On a phone, the finished exports wait here to be saved one tap at a time.
// ABOUTME: A phone cannot take a download started after a long bake, so each file gets its own save button.

import React, { useEffect, useMemo } from "react";

export interface ReadyFile {
  file: Blob;
  name: string;
  /** A short word for which file this is, where the name runs long. */
  label?: string;
}

/**
 * Whether this browser can hand a file to the system share sheet, which on a
 * phone is where "save image" and "save to files" live.
 */
export function canShareFile(file: File): boolean {
  return (
    typeof navigator !== "undefined" &&
    typeof navigator.share === "function" &&
    typeof navigator.canShare === "function" &&
    navigator.canShare({ files: [file] })
  );
}

/** Hands the browser a file to save under the given name, as a download. */
export function downloadFile(file: Blob, name: string) {
  const url = URL.createObjectURL(file);
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  // Safari reads the link after this turn, so the address has to outlive it.
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

/**
 * Saves one file from a tap: the share sheet where there is one, a download
 * where there is not. A share the person backs out of is not a problem.
 */
export async function saveFromTap(file: Blob, name: string): Promise<void> {
  const named = new File([file], name, { type: file.type });
  if (canShareFile(named)) {
    try {
      await navigator.share({ files: [named] });
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      throw error;
    }
    return;
  }
  downloadFile(file, name);
}

export function ExportReady({
  files,
  onClose,
  onProblem,
}: {
  files: readonly ReadyFile[];
  onClose: () => void;
  onProblem: (text: string) => void;
}) {
  const urls = useMemo(
    () => files.map((ready) => URL.createObjectURL(ready.file)),
    [files],
  );
  useEffect(
    () => () => urls.forEach((url) => URL.revokeObjectURL(url)),
    [urls],
  );

  return (
    <div className="collage-ready" role="dialog" aria-label="Ready to save">
      <div className="collage-ready__panel">
        <p className="collage-studio__label">ready to save</p>
        <ul className="collage-ready__list">
          {files.map((ready, index) => (
            <li key={ready.name} className="collage-ready__item">
              {ready.file.type.startsWith("image/") ? (
                <img
                  className="collage-ready__preview"
                  src={urls[index]}
                  alt={ready.name}
                />
              ) : ready.file.type.startsWith("video/") ? (
                <video
                  className="collage-ready__preview"
                  src={urls[index]}
                  muted
                  loop
                  autoPlay
                  playsInline
                />
              ) : null}
              <span className="collage-ready__name">
                {ready.label ?? ready.name}
              </span>
              <button
                type="button"
                className="collage-action collage-action--primary"
                onClick={() =>
                  void saveFromTap(ready.file, ready.name).catch(
                    (error: unknown) =>
                      onProblem(
                        `could not save ${ready.name} — ${
                          error instanceof Error ? error.message : String(error)
                        }`,
                      ),
                  )
                }
              >
                save
              </button>
            </li>
          ))}
        </ul>
        {files.some((ready) => ready.file.type.startsWith("image/")) && (
          <p className="collage-ready__hint">
            or press and hold a picture to save it
          </p>
        )}
        <button type="button" className="collage-action" onClick={onClose}>
          done
        </button>
      </div>
    </div>
  );
}
