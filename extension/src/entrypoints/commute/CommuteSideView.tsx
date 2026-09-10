// ABOUTME: The camera push-in shell shared by the fogged window and under-seat views.
// ABOUTME: Holds a side view of one spot in the car until esc or close steps back out.

import { useEffect, type ReactNode } from "react";

interface CommuteSideViewNote {
  label: string;
  body: ReactNode;
  tone?: "muted" | "rust";
}

interface CommuteSideViewProps {
  /** Two-digit plate on the header rule, as drawn on the artboards. */
  index: string;
  title: string;
  caption?: string;
  children: ReactNode;
  /** The paired "the act" / "at zero riders" columns under the scene. */
  notes?: CommuteSideViewNote[];
  onClose: () => void;
}

export function CommuteSideView({
  index,
  title,
  caption,
  children,
  notes,
  onClose,
}: CommuteSideViewProps) {
  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      onClose();
    };

    window.addEventListener("keydown", handleKey, true);
    return () => window.removeEventListener("keydown", handleKey, true);
  }, [onClose]);

  return (
    <div
      className="commute-side-view"
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <div className="commute-side-view__frame">
        <header className="commute-side-view__header">
          <span className="commute-side-view__index" aria-hidden>
            {index}
          </span>
          <h2>{title}</h2>
          {caption && (
            <span className="commute-side-view__caption">{caption}</span>
          )}
          <button
            className="commute-side-view__close"
            type="button"
            onClick={onClose}
            aria-label="Step back into the carriage"
          >
            esc ×
          </button>
        </header>

        <div className="commute-side-view__scene">{children}</div>

        {notes && notes.length > 0 && (
          <footer className="commute-side-view__notes">
            {notes.map((note) => (
              <div
                className={`commute-side-view__note commute-side-view__note--${
                  note.tone ?? "muted"
                }`}
                key={note.label}
              >
                <span>{note.label}</span>
                <p>{note.body}</p>
              </div>
            ))}
          </footer>
        )}
      </div>
    </div>
  );
}
