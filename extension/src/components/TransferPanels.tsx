// ABOUTME: Settings cards for moving data between browsers: pick what to export,
// ABOUTME: watch it pack, and preview an import with the choice of who to be.

import React from "react";
import type { ExportContents } from "../utils/importStream";
import { CursorSvg } from "./icons";
import type { TransferSection } from "../utils/transferSections";
import "./TransferPanels.scss";

export type SectionChoices = Record<TransferSection, boolean>;

function CursorMark({ color, size = 18 }: { color: string; size?: number }) {
  return <CursorSvg size={size} color={color} />;
}

function plural(count: number, one: string, many = `${one}s`): string {
  return `${count.toLocaleString()} ${count === 1 ? one : many}`;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(bytes < 10 * 1024 * 1024 ? 1 : 0)} MB`;
}

// ── Export picker ────────────────────────────────────────────────────────────

export interface ExportCounts {
  history: number;
  scraps: number;
  collages: number | null;
}

export function ExportPicker({
  counts,
  choices,
  onChange,
  onExport,
  onCancel,
  youColor,
}: {
  counts: ExportCounts;
  choices: SectionChoices;
  onChange: (choices: SectionChoices) => void;
  onExport: () => void;
  onCancel: () => void;
  youColor: string | null;
}) {
  const rows: {
    key: TransferSection;
    name: React.ReactNode;
    detail: string;
  }[] = [
    {
      key: "history",
      name: "Browsing history",
      detail: plural(counts.history, "event"),
    },
    {
      key: "scraps",
      name: "Scraps",
      detail: plural(counts.scraps, "scrap"),
    },
    {
      key: "collages",
      name: "Collages",
      detail:
        counts.collages === null ? "" : plural(counts.collages, "collage"),
    },
    {
      key: "you",
      name: <>You {youColor && <CursorMark color={youColor} size={20} />}</>,
      detail:
        "Your cursor, color, name if you set one, and the key that lets the new browser be you",
    },
  ];
  const picked = rows.filter((row) => choices[row.key]).length;

  return (
    <div className="transfer-card" role="group" aria-label="Export data">
      <div className="transfer-card__head">
        <div className="transfer-card__title">Export data</div>
        <div className="transfer-card__sub">
          Pick what to take with you. You can bring this file into any browser
          with we were online.
        </div>
      </div>
      <div className="transfer-card__rows">
        {rows.map((row) => (
          <label key={row.key} className="transfer-card__row">
            <input
              type="checkbox"
              checked={choices[row.key]}
              onChange={() =>
                onChange({ ...choices, [row.key]: !choices[row.key] })
              }
            />
            <span className="transfer-card__row-text">
              <span className="transfer-card__row-name">{row.name}</span>
              <span className="transfer-card__row-detail">{row.detail}</span>
              {row.key === "you" && choices.you && (
                <span className="transfer-card__warn">
                  Anyone with this file can show up as you. Keep it to yourself
                  and only open it in your own browser.
                </span>
              )}
            </span>
          </label>
        ))}
      </div>
      <div className="transfer-card__actions">
        <button
          className="transfer-card__primary"
          onClick={onExport}
          disabled={picked === 0}
        >
          {picked === 0 ? "Pick at least one thing" : `Export ${picked} of 4`}
        </button>
        <button className="transfer-card__quiet" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}

// ── Export progress and result ───────────────────────────────────────────────

export interface ExportProgressRow {
  label: string;
  written: number;
  total: number | null;
  state: "waiting" | "packing" | "done";
}

export function ExportProgress({ rows }: { rows: ExportProgressRow[] }) {
  return (
    <div className="transfer-card" role="status">
      <div className="transfer-card__title">Packing it up…</div>
      <div className="transfer-card__bars">
        {rows.map((row) => {
          const share =
            row.state === "done"
              ? 1
              : row.total
                ? Math.min(row.written / row.total, 1)
                : 0;
          const note =
            row.state === "waiting"
              ? "waiting"
              : row.state === "done"
                ? `done · ${row.written.toLocaleString()}`
                : row.total
                  ? `${row.written.toLocaleString()} of ${row.total.toLocaleString()}`
                  : row.written.toLocaleString();
          return (
            <div
              key={row.label}
              className={`transfer-card__bar-row transfer-card__bar-row--${row.state}`}
            >
              <div className="transfer-card__bar-label">
                <span>{row.label}</span>
                <span className="transfer-card__mono">{note}</span>
              </div>
              <div className="transfer-card__bar">
                <div style={{ width: `${share * 100}%` }} />
              </div>
            </div>
          );
        })}
      </div>
      <div className="transfer-card__sub">
        Keep this tab open until it's done.
      </div>
    </div>
  );
}

export function ExportReady({
  fileName,
  bytes,
  summary,
  onDone,
}: {
  fileName: string;
  bytes: number;
  summary: string;
  onDone: () => void;
}) {
  return (
    <div className="transfer-card" role="status">
      <div className="transfer-card__title transfer-card__title--done">
        <svg
          width="18"
          height="18"
          viewBox="0 0 20 20"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          aria-hidden="true"
        >
          <circle cx="10" cy="10" r="8" />
          <path d="M6 10.5l2.5 2.5L14 7.5" />
        </svg>
        Your file is ready
      </div>
      <div className="transfer-card__file">
        {fileName} · {formatBytes(bytes)}
      </div>
      <div className="transfer-card__sub">
        {summary} Over in your new browser, install we were online, go to
        Settings › Your data › Import data, and pick this file.
      </div>
      <div className="transfer-card__actions">
        <button className="transfer-card__quiet" onClick={onDone}>
          Done
        </button>
      </div>
    </div>
  );
}

/** "Your history, 412 scraps and 12 collages are all in here." */
export function exportSummary(
  choices: SectionChoices,
  written: { scraps: number; collages: number },
): string {
  const parts: string[] = [];
  if (choices.history) parts.push("your history");
  if (choices.scraps) parts.push(plural(written.scraps, "scrap"));
  if (choices.collages) parts.push(plural(written.collages, "collage"));
  if (choices.you) parts.push("you");
  if (parts.length === 0) return "";
  const list =
    parts.length === 1
      ? parts[0]
      : `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
  const sentence = list.charAt(0).toUpperCase() + list.slice(1);
  const one =
    parts.length === 1 && (parts[0] === "your history" || /^1 /.test(parts[0]));
  if (parts.length === 1 && parts[0] === "you") return "You're all in here.";
  return `${sentence} ${one ? "is" : "are"} all in here.`;
}

// ── Import preview ───────────────────────────────────────────────────────────

export type ImportWho = "file" | "here";

export function ImportPreview({
  title,
  packedOn,
  contents,
  choices,
  onChange,
  who,
  onWhoChange,
  hereColor,
  onImport,
  onCancel,
}: {
  title: string;
  packedOn: string | null;
  /** Null for an older file, which only says it holds events. */
  contents: ExportContents | null;
  choices: SectionChoices;
  onChange: (choices: SectionChoices) => void;
  who: ImportWho;
  onWhoChange: (who: ImportWho) => void;
  hereColor: string | null;
  onImport: () => void;
  onCancel: () => void;
}) {
  const rows: { key: TransferSection; name: string; count: string | null }[] =
    [];
  if (!contents) {
    rows.push({
      key: "history",
      name: "Browsing history and scraps",
      count: null,
    });
  } else {
    if (contents.history)
      rows.push({
        key: "history",
        name: "Browsing history",
        count: `+${plural(contents.history, "event")}`,
      });
    if (contents.scraps)
      rows.push({
        key: "scraps",
        name: "Scraps",
        count: `+${contents.scraps.toLocaleString()}`,
      });
    if (contents.collages)
      rows.push({
        key: "collages",
        name: "Collages",
        count: `+${contents.collages.toLocaleString()}`,
      });
  }
  const picked =
    rows.some((row) => choices[row.key]) || (contents?.you && who === "file");

  return (
    <div className="transfer-card" role="group" aria-label="Import data">
      <div className="transfer-card__head">
        <div className="transfer-card__title">Import {title}</div>
        <div className="transfer-card__sub">
          {packedOn ? `Exported ${packedOn}. ` : ""}Imports only add, nothing is
          deleted.
        </div>
      </div>
      {rows.length > 0 && (
        <div className="transfer-card__rows">
          {rows.map((row) => (
            <label
              key={row.key}
              className="transfer-card__row transfer-card__row--center"
            >
              <input
                type="checkbox"
                checked={choices[row.key]}
                onChange={() => {
                  const on = !choices[row.key];
                  onChange(
                    contents
                      ? { ...choices, [row.key]: on }
                      : { ...choices, history: on, scraps: on },
                  );
                }}
              />
              <span className="transfer-card__row-name transfer-card__grow">
                {row.name}
              </span>
              {row.count && (
                <span className="transfer-card__mono transfer-card__plus">
                  {row.count}
                </span>
              )}
            </label>
          ))}
        </div>
      )}
      {contents?.you && (
        <div className="transfer-card__who" role="radiogroup">
          <div className="transfer-card__question">
            This file remembers who you were. Who do you want to be here?
          </div>
          {(
            [
              {
                id: "file",
                name: "Keep being you",
                detail: "Same cursor, color and beta features as before.",
                color: contents.youColor ?? "#b5aea5",
              },
              {
                id: "here",
                name: "Start fresh",
                detail: "A new you. Your history still comes along.",
                color: hereColor ?? "#b5aea5",
              },
            ] as const
          ).map((option) => (
            <label
              key={option.id}
              className={`transfer-card__choice${
                who === option.id ? " transfer-card__choice--on" : ""
              }`}
            >
              <input
                type="radio"
                name="import-who"
                checked={who === option.id}
                onChange={() => onWhoChange(option.id)}
              />
              <CursorMark color={option.color} size={28} />
              <span className="transfer-card__row-text">
                <span className="transfer-card__row-name">{option.name}</span>
                <span className="transfer-card__row-detail">
                  {option.detail}
                </span>
              </span>
            </label>
          ))}
        </div>
      )}
      <div className="transfer-card__actions">
        <button
          className="transfer-card__primary"
          onClick={onImport}
          disabled={!picked}
        >
          Import
        </button>
        <button className="transfer-card__quiet" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}
