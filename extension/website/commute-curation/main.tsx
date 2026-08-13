// ABOUTME: Renders the browser-local Internet Commute curation workbench.
// ABOUTME: Lets an administrator record, revise, and export destination decisions.

import React, { FormEvent, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  createCuratedPlace,
  CURATION_STORAGE_KEY,
  CURATION_VERDICTS,
  CuratedPlace,
  CurationVerdict,
  parseStoredCuration,
  serializeCurationArtifact,
  upsertCuratedPlace,
} from "./curation";
import "./style.scss";

const VERDICT_LABELS: Record<CurationVerdict, string> = {
  promoted: "Promoted stop",
  "scenery-only": "Scenery only",
  blocked: "Blocked",
};

function loadPlaces(): CuratedPlace[] {
  return parseStoredCuration(localStorage.getItem(CURATION_STORAGE_KEY));
}

function App() {
  const [places, setPlaces] = useState<CuratedPlace[]>(loadPlaces);
  const [input, setInput] = useState("");
  const [verdict, setVerdict] = useState<CurationVerdict>("promoted");
  const [comment, setComment] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [copyState, setCopyState] = useState("Copy artifact");

  const counts = useMemo(
    () =>
      Object.fromEntries(
        CURATION_VERDICTS.map((value) => [
          value,
          places.filter((place) => place.verdict === value).length,
        ]),
      ) as Record<CurationVerdict, number>,
    [places],
  );
  const artifact = useMemo(
    () => serializeCurationArtifact(places, new Date().toISOString()),
    [places],
  );

  function savePlaces(nextPlaces: CuratedPlace[]) {
    setPlaces(nextPlaces);
    localStorage.setItem(CURATION_STORAGE_KEY, JSON.stringify(nextPlaces));
  }

  function resetForm() {
    setInput("");
    setVerdict("promoted");
    setComment("");
    setEditingId(null);
    setError("");
  }

  function submitDecision(event: FormEvent) {
    event.preventDefault();

    try {
      const priorEntry = places.find((place) => place.id === editingId);
      const place = createCuratedPlace({
        id: priorEntry?.id ?? crypto.randomUUID(),
        input,
        verdict,
        comment,
        updatedAt: new Date().toISOString(),
      });
      const withoutEditedEntry = editingId
        ? places.filter((candidate) => candidate.id !== editingId)
        : places;
      savePlaces(upsertCuratedPlace(withoutEditedEntry, place));
      resetForm();
    } catch (submissionError) {
      setError(
        submissionError instanceof Error
          ? submissionError.message
          : "This place could not be reviewed.",
      );
    }
  }

  function editPlace(place: CuratedPlace) {
    setInput(place.place);
    setVerdict(place.verdict);
    setComment(place.comment);
    setEditingId(place.id);
    setError("");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function copyArtifact() {
    try {
      await navigator.clipboard.writeText(artifact);
      setCopyState("Copied for Codex");
      window.setTimeout(() => setCopyState("Copy artifact"), 1800);
    } catch {
      setCopyState("Select text below");
    }
  }

  return (
    <main>
      <header className="masthead">
        <div className="masthead__identity">
          <img src="/icon.png" alt="" />
          <div>
            <span className="eyebrow">WWO / INTERNAL OFFICE</span>
            <h1>
              Internet Commute
              <br />
              Curation Desk
            </h1>
          </div>
        </div>
        <div className="masthead__notice">
          <span>LOCAL RECORD</span>
          <strong>NOT CONNECTED TO PRODUCTION</strong>
          <small>decisions stay in this browser</small>
        </div>
      </header>

      <section className="verdict-key" aria-label="Curation totals">
        {CURATION_VERDICTS.map((value, index) => (
          <div className={`verdict-key__item verdict--${value}`} key={value}>
            <span>0{index + 1}</span>
            <strong>{VERDICT_LABELS[value]}</strong>
            <b>{counts[value]}</b>
          </div>
        ))}
      </section>

      <div className="workbench">
        <section className="intake panel">
          <div className="panel__heading">
            <span>FORM 01</span>
            <h2>{editingId ? "Revise a place" : "Review a place"}</h2>
          </div>
          <form onSubmit={submitDecision}>
            <label>
              <span>Domain or public URL</span>
              <input
                autoFocus
                value={input}
                onChange={(event) => setInput(event.target.value)}
                placeholder="example.org or https://example.org/page"
              />
            </label>

            <fieldset>
              <legend>Disposition</legend>
              <div className="verdict-options">
                {CURATION_VERDICTS.map((value) => (
                  <label
                    className={`verdict-option verdict--${value}`}
                    key={value}
                  >
                    <input
                      type="radio"
                      name="verdict"
                      checked={verdict === value}
                      onChange={() => setVerdict(value)}
                    />
                    <span>{VERDICT_LABELS[value]}</span>
                  </label>
                ))}
              </div>
            </fieldset>

            <label>
              <span>
                Reviewer note <i>optional</i>
              </span>
              <textarea
                value={comment}
                onChange={(event) => setComment(event.target.value)}
                placeholder="Why this is ambiguous, or what broader rule it suggests…"
              />
            </label>

            {error && <p className="form-error">{error}</p>}
            <div className="form-actions">
              <button className="primary-action" type="submit">
                {editingId ? "Save revision" : "File decision"} →
              </button>
              {editingId && (
                <button
                  className="text-action"
                  type="button"
                  onClick={resetForm}
                >
                  Cancel
                </button>
              )}
            </div>
          </form>
        </section>

        <section className="queue panel">
          <div className="panel__heading panel__heading--queue">
            <div>
              <span>REGISTER 02</span>
              <h2>Decision queue</h2>
            </div>
            <small>{places.length} total / newest first</small>
          </div>

          {places.length === 0 ? (
            <div className="empty-state">
              <span>NO DECISIONS FILED</span>
              <p>Enter a place to begin building a review artifact.</p>
            </div>
          ) : (
            <ol className="place-list">
              {places.map((place, index) => (
                <li
                  className={`place-card verdict--${place.verdict}`}
                  key={place.id}
                >
                  <span className="place-card__index">
                    {String(places.length - index).padStart(3, "0")}
                  </span>
                  <div className="place-card__body">
                    <div className="place-card__topline">
                      <strong>{place.domain}</strong>
                      <span>{VERDICT_LABELS[place.verdict]}</span>
                    </div>
                    <a
                      href={
                        place.place.includes("://")
                          ? place.place
                          : `https://${place.place}`
                      }
                      target="_blank"
                      rel="noreferrer"
                    >
                      {place.place} ↗
                    </a>
                    {place.comment && <p>{place.comment}</p>}
                  </div>
                  <div className="place-card__actions">
                    <button type="button" onClick={() => editPlace(place)}>
                      Edit
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        savePlaces(
                          places.filter(
                            (candidate) => candidate.id !== place.id,
                          ),
                        )
                      }
                    >
                      Remove
                    </button>
                  </div>
                </li>
              ))}
            </ol>
          )}
        </section>
      </div>

      <section className="export-panel panel">
        <div className="panel__heading">
          <span>OUTPUT 03</span>
          <h2>Policy handoff</h2>
        </div>
        <div className="export-panel__intro">
          <p>
            Copy this artifact into a Codex task. Notes can become broader URL
            policy; individual decisions can remain catalog entries.
          </p>
          <button type="button" onClick={copyArtifact}>
            {copyState}
          </button>
        </div>
        <textarea
          className="artifact"
          readOnly
          value={artifact}
          aria-label="Curation artifact"
        />
      </section>

      <footer>
        <span>INTERNET COMMUTE DESTINATION CONTROL</span>
        <span>WE WERE ONLINE / LOCAL PROTOTYPE</span>
      </footer>
    </main>
  );
}

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
