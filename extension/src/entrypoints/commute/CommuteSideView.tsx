// ABOUTME: The camera push-in shell shared by the fogged window and under-seat views.
// ABOUTME: Holds a side view of one spot in the car until esc or close steps back out.

import { useEffect, type ReactNode } from "react";

interface CommuteSideViewProps {
  title: string;
  caption?: string;
  children: ReactNode;
  onClose: () => void;
}

export function CommuteSideView({
  title,
  caption,
  children,
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
          <strong>{title}</strong>
          {caption && <span>{caption}</span>}
          <button
            className="commute-side-view__close"
            type="button"
            onClick={onClose}
            aria-label="Step back into the carriage"
          >
            esc ×
          </button>
        </header>
        {children}
      </div>
    </div>
  );
}
