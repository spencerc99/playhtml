// ABOUTME: The scraps page's line under the search field for searching by what's in pictures.
// ABOUTME: Offers the one-time model download, then shows its progress, and lets it be removed again.

import React, { useState } from "react";
import type { MeaningSearchStatus } from "./useMeaningSearch";
import { MEANING_MODEL } from "./meaningModelInfo";

interface Props {
  status: MeaningSearchStatus;
  onEnable: () => void;
  onRemove: () => void;
}

function megabytes(bytes: number): string {
  return `${Math.round(bytes / 1_000_000)} MB`;
}

export function MeaningSearchControl({ status, onEnable, onRemove }: Props) {
  const [offered, setOffered] = useState(false);

  let line: React.ReactNode;
  if (status.phase === "off") {
    line = offered ? (
      <>
        <span>
          downloads a picture-reading model (
          {MEANING_MODEL.approximateMegabytes} MB) once. it runs on this
          computer; your scraps never leave it.
        </span>{" "}
        <button
          type="button"
          className="meaning-search__action"
          onClick={onEnable}
        >
          download
        </button>{" "}
        <button
          type="button"
          className="meaning-search__action meaning-search__action--quiet"
          onClick={() => setOffered(false)}
        >
          not now
        </button>
      </>
    ) : (
      <button
        type="button"
        className="meaning-search__action"
        onClick={() => setOffered(true)}
      >
        search by what's in pictures
        <span className="meaning-search__beta">beta</span>
      </button>
    );
  } else if (status.phase === "downloading") {
    const share = status.total > 0 ? status.loaded / status.total : 0;
    line = (
      <>
        <span>
          {status.total > 0
            ? `downloading model · ${megabytes(status.loaded)} of ${megabytes(status.total)}`
            : "getting the model ready"}
        </span>
        <span className="meaning-search__bar" aria-hidden="true">
          <span style={{ width: `${Math.round(share * 100)}%` }} />
        </span>
      </>
    );
  } else if (status.phase === "reading") {
    line = (
      <>
        <span>
          reading pictures · {status.read} of {status.total}
        </span>
        <span className="meaning-search__bar" aria-hidden="true">
          <span
            style={{
              width: `${status.total ? Math.round((status.read / status.total) * 100) : 0}%`,
            }}
          />
        </span>
      </>
    );
  } else if (status.phase === "ready") {
    line = (
      <>
        <span>searching by what's in pictures too</span>{" "}
        <button
          type="button"
          className="meaning-search__action meaning-search__action--quiet"
          title="Turn this off and delete the model and what it read"
          onClick={onRemove}
        >
          remove
        </button>
      </>
    );
  } else {
    line = (
      <>
        <span title={status.message}>the picture model could not load</span>{" "}
        <button
          type="button"
          className="meaning-search__action meaning-search__action--quiet"
          onClick={onRemove}
        >
          remove
        </button>
      </>
    );
  }

  return (
    <div className="meaning-search" role="status" aria-live="polite">
      <style>{MEANING_SEARCH_STYLES}</style>
      {line}
    </div>
  );
}

const MEANING_SEARCH_STYLES = `
  .meaning-search {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 4px 6px;
    margin-top: 8px;
    color: #827a72;
    font-family: "Martian Mono", monospace;
    font-size: 9px;
    line-height: 1.5;
  }

  .meaning-search__action {
    appearance: none;
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 0;
    border: 0;
    background: none;
    color: #3d3833;
    font: inherit;
    text-decoration: underline;
    text-decoration-color: rgba(61, 56, 51, 0.3);
    text-underline-offset: 2px;
    cursor: pointer;
  }

  .meaning-search__action:hover,
  .meaning-search__action:focus-visible {
    text-decoration-color: currentColor;
    outline: none;
  }

  .meaning-search__action--quiet {
    color: #a39b92;
  }

  .meaning-search__beta {
    padding: 1px 5px;
    border: 1px solid rgba(61, 56, 51, 0.18);
    border-radius: 999px;
    color: #827a72;
    font-size: 8px;
    text-decoration: none;
  }

  .meaning-search__bar {
    position: relative;
    flex: 0 0 80px;
    height: 3px;
    overflow: hidden;
    border-radius: 999px;
    background: rgba(61, 56, 51, 0.1);
  }

  .meaning-search__bar > span {
    position: absolute;
    inset: 0 auto 0 0;
    background: #3d3833;
    transition: width 200ms ease;
  }
`;
