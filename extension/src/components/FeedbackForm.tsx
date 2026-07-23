// ABOUTME: Collects freeform feedback from the extension popup.
// ABOUTME: Sends reports with extension context to the feedback Worker endpoint.

import React, { useState } from "react";
import browser from "webextension-polyfill";
import { WORKER_URL } from "@movement/config";
import "./InternetPortraitHome.scss";

type SubmissionState = "idle" | "submitting" | "success" | "error";

export function FeedbackForm() {
  const [isOpen, setIsOpen] = useState(false);
  const [message, setMessage] = useState("");
  const [submissionState, setSubmissionState] =
    useState<SubmissionState>("idle");

  const close = () => {
    setIsOpen(false);
    setMessage("");
    setSubmissionState("idle");
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    const trimmedMessage = message.trim();
    if (!trimmedMessage || submissionState === "submitting") return;

    setSubmissionState("submitting");
    try {
      const response = await fetch(`${WORKER_URL}/feedback`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: trimmedMessage,
          extensionVersion: browser.runtime.getManifest().version,
          browser: navigator.userAgent,
        }),
      });
      if (!response.ok) throw new Error(`Feedback request failed: ${response.status}`);
      setMessage("");
      setSubmissionState("success");
    } catch {
      setSubmissionState("error");
    }
  };

  if (!isOpen) {
    return (
      <button
        className="portrait-home__feedback"
        type="button"
        onClick={() => setIsOpen(true)}
      >
        send feedback
      </button>
    );
  }

  return (
    <div className="feedback-form">
      <div className="feedback-form__header">
        <span>feedback</span>
        <button
          type="button"
          className="feedback-form__close"
          aria-label="Close feedback form"
          onClick={close}
        >
          ×
        </button>
      </div>

      {submissionState === "success" ? (
        <p className="feedback-form__success" role="status">
          thanks — received
        </p>
      ) : (
        <form onSubmit={submit}>
          <textarea
            className="feedback-form__input"
            aria-label="Feedback"
            autoFocus
            maxLength={4000}
            placeholder="bug, idea, or anything else…"
            required
            value={message}
            onChange={(event) => {
              setMessage(event.target.value);
              if (submissionState === "error") setSubmissionState("idle");
            }}
          />
          <div className="feedback-form__actions">
            <span className="feedback-form__context">
              includes extension + browser version
            </span>
            <button
              className="feedback-form__submit"
              type="submit"
              disabled={!message.trim() || submissionState === "submitting"}
            >
              {submissionState === "submitting" ? "sending…" : "send"}
            </button>
          </div>
          {submissionState === "error" && (
            <p className="feedback-form__error" role="alert">
              couldn’t send — try again
            </p>
          )}
        </form>
      )}
    </div>
  );
}
