// ABOUTME: Offers public mobile commute riders an emailed desktop install link.
// ABOUTME: Keeps a collapsible transit-pass tab available throughout the ride.

import { type FormEvent, useEffect, useState } from "react";
import { WORKER_URL } from "@movement/config";
import { useExtensionInstallState } from "./commuteInstallState";

const SUBSCRIBED_KEY = "wewere.subscribed";

type FormState =
  | { status: "idle" }
  | { status: "submitting" }
  | { status: "success"; firstTime: boolean; email: string }
  | { status: "error"; message: string };

interface SubscribeResponse {
  ok: boolean;
  alreadySubscribed?: boolean;
  error?: string;
}

function isLocallySubscribed(): boolean {
  try {
    return localStorage.getItem(SUBSCRIBED_KEY) === "1";
  } catch {
    return false;
  }
}

function markSubscribed(): void {
  try {
    localStorage.setItem(SUBSCRIBED_KEY, "1");
  } catch {
    // localStorage may be blocked without preventing the email request.
  }
}

export function CommuteMobileTransitPass() {
  const installState = useExtensionInstallState();
  const [expanded, setExpanded] = useState(false);
  const [email, setEmail] = useState("");
  const [state, setState] = useState<FormState>(() =>
    isLocallySubscribed()
      ? { status: "success", firstTime: false, email: "" }
      : { status: "idle" },
  );

  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key === SUBSCRIBED_KEY && event.newValue === "1") {
        setState({ status: "success", firstTime: false, email: "" });
      }
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  if (installState !== "missing") return null;

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmed = email.trim();
    if (!trimmed) {
      setState({ status: "error", message: "please enter an email address" });
      return;
    }

    setState({ status: "submitting" });

    try {
      const response = await fetch(`${WORKER_URL}/subscribe`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: trimmed, source: "website" }),
      });
      const data = (await response.json()) as SubscribeResponse;

      if (!response.ok || !data.ok) {
        setState({
          status: "error",
          message:
            data.error ||
            (response.status === 429
              ? "slow down — try again in a minute"
              : "something went wrong. try again?"),
        });
        return;
      }

      markSubscribed();
      window.dispatchEvent(
        new StorageEvent("storage", {
          key: SUBSCRIBED_KEY,
          newValue: "1",
        }),
      );
      setState({
        status: "success",
        firstTime: !data.alreadySubscribed,
        email: trimmed,
      });
    } catch {
      setState({ status: "error", message: "connection error. try again?" });
    }
  };

  const submitting = state.status === "submitting";
  const errorMessage = state.status === "error" ? state.message : null;

  return (
    <div className="commute-mobile-transit-pass">
      {expanded && (
        <section
          className="commute-mobile-transit-pass__panel"
          aria-label="Internet transit pass"
        >
          <button
            className="commute-mobile-transit-pass__close"
            type="button"
            aria-label="Collapse the internet transit pass"
            onClick={() => setExpanded(false)}
          >
            ×
          </button>
          <span className="commute-mobile-transit-pass__label">
            internet transit pass
          </span>
          <strong>join the ride</strong>
          <p>
            the extension is desktop-only — we'll email you the install link for
            your computer
          </p>
          {state.status === "success" ? (
            <p className="commute-mobile-transit-pass__success" role="status">
              {state.firstTime && state.email ? (
                <>
                  sent to <b>{state.email}</b>! excited to make internet feel
                  more alive together :)
                </>
              ) : (
                <>install link sent — check your email :)</>
              )}
            </p>
          ) : (
            <form onSubmit={submit}>
              <span className="commute-mobile-transit-pass__form-row">
                <input
                  type="email"
                  inputMode="email"
                  autoComplete="email"
                  required
                  placeholder="your email"
                  value={email}
                  disabled={submitting}
                  aria-invalid={errorMessage ? "true" : undefined}
                  onChange={(event) => setEmail(event.target.value)}
                />
                <button type="submit" disabled={submitting}>
                  {submitting ? "sending…" : "send"}
                </button>
              </span>
              {errorMessage && (
                <span
                  className="commute-mobile-transit-pass__error"
                  role="alert"
                >
                  {errorMessage}
                </span>
              )}
            </form>
          )}
        </section>
      )}

      <button
        className="commute-mobile-transit-pass__tab"
        type="button"
        aria-expanded={expanded}
        aria-label="Open the internet transit pass"
        onClick={() => setExpanded(true)}
      >
        <span
          className="commute-mobile-transit-pass__perforation"
          aria-hidden
        />
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden>
          <rect x="3" y="7" width="18" height="11" rx="2" />
          <path d="M3 12h18M8 7v11" strokeDasharray="2 2" />
        </svg>
        <span>
          <small>internet transit pass</small>
          <strong>join the ride</strong>
        </span>
      </button>
    </div>
  );
}
