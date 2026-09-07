// ABOUTME: WWO admin office for feature stages, access cohorts, and beta testers.
// ABOUTME: Supports direct and bulk membership plus pending access approvals.

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { FEATURE_STAGES, type FeatureStage } from "../../shared/featureCatalog";
import {
  addPeople,
  getAccessOverview,
  parsePeopleInput,
  parsePersonInput,
  PersonInputError,
  reviewAccessRequest,
  updateCohortFeatures,
  updateFeatureStage,
  updatePersonCohorts,
  type AccessOverview,
} from "./accessControlApi";
import { AdminHeader, AdminLogin, useAdminToken } from "./adminAuth";
import "./style.scss";

const STAGE_LABELS: Record<FeatureStage, string> = {
  internal: "Internal",
  beta: "Closed beta",
  released: "Released",
};

function shortPublicId(publicId: string): string {
  return `${publicId.slice(0, 12)}…${publicId.slice(-10)}`;
}

function InternalOffice() {
  const auth = useAdminToken();
  const { token } = auth;
  const [overview, setOverview] = useState<AccessOverview | null>(null);
  const [publicId, setPublicId] = useState("");
  const [email, setEmail] = useState("");
  const [peopleInput, setPeopleInput] = useState("");
  const [cohortId, setCohortId] = useState("closed-beta");
  const [approvalCohortId, setApprovalCohortId] = useState("closed-beta");
  const [query, setQuery] = useState("");
  const [error, setError] = useState("");
  const [addPersonError, setAddPersonError] = useState<PersonInputError | null>(null);
  const [notice, setNotice] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  const loadOverview = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setError("");
    try {
      setOverview(await getAccessOverview(token));
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : String(requestError));
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    loadOverview().catch(() => {});
  }, [loadOverview]);

  const mutate = async (action: () => Promise<void>) => {
    setSaving(true);
    setError("");
    setNotice("");
    try {
      await action();
      await loadOverview();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : String(requestError));
    } finally {
      setSaving(false);
    }
  };

  const filteredPeople = useMemo(() => {
    if (!overview) return [];
    const normalizedQuery = query.trim().toLowerCase();
    if (!normalizedQuery) return overview.people;
    return overview.people.filter((person) =>
      person.publicId.toLowerCase().includes(normalizedQuery) ||
      person.email?.toLowerCase().includes(normalizedQuery),
    );
  }, [overview, query]);

  if (!token) {
    return <AdminLogin onLogin={auth.login} />;
  }

  const submitPerson = async (event: FormEvent) => {
    event.preventDefault();
    setAddPersonError(null);
    let person;
    try {
      person = parsePersonInput(publicId, email);
    } catch (inputError) {
      setNotice("");
      if (inputError instanceof PersonInputError) {
        setAddPersonError(inputError);
      } else {
        setError(inputError instanceof Error ? inputError.message : String(inputError));
      }
      return;
    }
    await mutate(async () => {
      const cohort = overview.cohorts.find((candidate) => candidate.id === cohortId);
      if (!cohort) throw new Error("Selected cohort is unavailable");
      await addPeople(token, cohortId, [person]);
      setPublicId("");
      setEmail("");
      setNotice(`Added ${shortPublicId(person.publicId)} to ${cohort.name}.`);
    });
  };

  const submitPeople = async (event: FormEvent) => {
    event.preventDefault();
    await mutate(async () => {
      const people = parsePeopleInput(peopleInput);
      if (people.length === 0) throw new Error("Enter at least one public ID");
      await addPeople(token, cohortId, people);
      setPeopleInput("");
    });
  };

  return (
    <div className="office-shell">
      <AdminHeader currentPage="access" onLogout={auth.logout} />

      <main className="office-main">
        <section className="office-intro">
          <div>
            <span className="office-section-number">ACCESS CONTROL</span>
            <h2>Experiments</h2>
            <p>Choose who can discover each experiment. Access makes a feature available; testers still turn it on for themselves.</p>
          </div>
          <div className="office-count"><strong>{overview?.people.length ?? 0}</strong><span>approved people</span></div>
        </section>

        {error && <p className="office-error">{error}</p>}
        {loading && !overview ? <p className="office-empty">Loading access policy…</p> : null}

        {overview && <>
          <section className="office-panel office-features">
            <div className="office-list-header">
              <div><span className="office-section-number">DESK 01</span><h3>Feature stages</h3></div>
              <button onClick={() => loadOverview()} disabled={loading || saving}>{loading ? "Refreshing…" : "Refresh"}</button>
            </div>
            <div className="office-card-grid">
              {overview.features.map((feature) => (
                <label className="office-feature-card" key={feature.id}>
                  <span><strong>{feature.name}</strong><small>{feature.description}</small></span>
                  <select aria-label={`${feature.name} stage`} value={feature.stage} disabled={saving}
                    onChange={(event) => mutate(() => updateFeatureStage(token, feature.id, event.target.value as FeatureStage))}>
                    {FEATURE_STAGES.map((stage) => <option key={stage} value={stage}>{STAGE_LABELS[stage]}</option>)}
                  </select>
                </label>
              ))}
            </div>
          </section>

          <section className="office-panel office-cohorts">
            <div className="office-list-header"><div><span className="office-section-number">DESK 02</span><h3>Cohort grants</h3></div></div>
            <div className="office-card-grid">
              {overview.cohorts.map((cohort) => (
                <article className="office-cohort-card" key={cohort.id}>
                  <header><strong>{cohort.name}</strong><code>{cohort.id}</code></header>
                  {cohort.grantsAllUnreleased ? (
                    <p>Receives every unreleased feature, including features added later.</p>
                  ) : (
                    <div className="office-check-list">
                      {overview.features.filter((feature) => feature.stage !== "released").map((feature) => (
                        <label key={feature.id}>
                          <input type="checkbox" checked={cohort.featureIds.includes(feature.id)} disabled={saving}
                            onChange={() => {
                              const featureIds = cohort.featureIds.includes(feature.id)
                                ? cohort.featureIds.filter((id) => id !== feature.id)
                                : [...cohort.featureIds, feature.id];
                              mutate(() => updateCohortFeatures(token, cohort.id, featureIds));
                            }} />
                          <span>{feature.name}</span>
                        </label>
                      ))}
                    </div>
                  )}
                </article>
              ))}
            </div>
          </section>

          <section className="office-panel">
            <div className="office-list-header"><div><span className="office-section-number">DESK 03</span><h3>Add person</h3></div></div>
            <form className="office-add office-add--person" onSubmit={submitPerson}>
              <label><span>Public ID</span><input aria-label="Public ID" value={publicId}
                aria-invalid={addPersonError?.field === "publicId"}
                aria-describedby={addPersonError?.field === "publicId" ? "add-person-public-id-error" : undefined}
                onChange={(event) => {
                  setPublicId(event.target.value);
                  if (addPersonError?.field === "publicId") setAddPersonError(null);
                }} placeholder="pk_…" spellCheck={false} autoComplete="off" /></label>
              <label><span>Email <small>optional</small></span><input aria-label="Email" type="email" value={email}
                aria-invalid={addPersonError?.field === "email"}
                aria-describedby={addPersonError?.field === "email" ? "add-person-email-error" : undefined}
                onChange={(event) => {
                  setEmail(event.target.value);
                  if (addPersonError?.field === "email") setAddPersonError(null);
                }} placeholder="tester@example.com" autoComplete="off" /></label>
              <label><span>Cohort</span><select aria-label="Cohort" value={cohortId} onChange={(event) => setCohortId(event.target.value)}>
                {overview.cohorts.map((cohort) => <option key={cohort.id} value={cohort.id}>{cohort.name}</option>)}
              </select></label>
              <button type="submit" disabled={!publicId.trim() || saving}>Add person</button>
              {addPersonError && <p id={`add-person-${addPersonError.field === "publicId" ? "public-id" : "email"}-error`}
                className="office-add__error" role="alert">{addPersonError.message}</p>}
              {notice && <p className="office-add__success" role="status">{notice}</p>}
            </form>
            <details className="office-bulk-import">
              <summary>Import multiple people</summary>
              <form className="office-add office-add--bulk" onSubmit={submitPeople}>
                <label htmlFor="people-input">Public IDs</label>
                <textarea id="people-input" value={peopleInput} onChange={(event) => setPeopleInput(event.target.value)}
                  placeholder={`One per line, optionally followed by an email\npk_…\npk_…, tester@example.com`} spellCheck={false} />
                <div>
                  <select aria-label="Bulk import cohort" value={cohortId} onChange={(event) => setCohortId(event.target.value)}>
                    {overview.cohorts.map((cohort) => <option key={cohort.id} value={cohort.id}>{cohort.name}</option>)}
                  </select>
                  <button type="submit" disabled={!peopleInput.trim() || saving}>Import people</button>
                </div>
                <small>Paste up to 500 IDs or CSV rows. Email is optional and only stored when supplied.</small>
              </form>
            </details>
          </section>

          {overview.requests.length > 0 && <section className="office-panel">
            <div className="office-list-header">
              <div><span className="office-section-number">INBOX</span><h3>Pending requests</h3></div>
              <select value={approvalCohortId} onChange={(event) => setApprovalCohortId(event.target.value)}>
                {overview.cohorts.map((cohort) => <option key={cohort.id} value={cohort.id}>{cohort.name}</option>)}
              </select>
            </div>
            <ul className="office-list">
              {overview.requests.map((accessRequest) => <li key={accessRequest.id}>
                <div><code title={accessRequest.publicId}>{shortPublicId(accessRequest.publicId)}</code><span>{accessRequest.email ?? "No email shared"}</span></div>
                <div className="office-row-actions">
                  <button disabled={saving} onClick={() => mutate(() => reviewAccessRequest(token, accessRequest.id, "approved", approvalCohortId))}>Approve</button>
                  <button className="office-button--quiet" disabled={saving} onClick={() => mutate(() => reviewAccessRequest(token, accessRequest.id, "denied"))}>Deny</button>
                </div>
              </li>)}
            </ul>
          </section>}

          <section className="office-panel">
            <div className="office-list-header">
              <div><span className="office-section-number">DIRECTORY</span><h3>Approved people</h3></div>
              <input aria-label="Search approved people" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search ID or email" />
            </div>
            {filteredPeople.length === 0 ? <p className="office-empty">{overview.people.length === 0 ? "No people have access yet." : "No people match that search."}</p> : (
              <ul className="office-list office-people-list">
                {filteredPeople.map((person) => <li key={person.publicId}>
                  <div><code title={person.publicId}>{shortPublicId(person.publicId)}</code><span>{person.email ?? "No email shared"}</span></div>
                  <div className="office-memberships">
                    {overview.cohorts.map((cohort) => <label key={cohort.id}>
                      <input type="checkbox" checked={person.cohortIds.includes(cohort.id)} disabled={saving}
                        onChange={() => {
                          const cohortIds = person.cohortIds.includes(cohort.id)
                            ? person.cohortIds.filter((id) => id !== cohort.id)
                            : [...person.cohortIds, cohort.id];
                          mutate(() => updatePersonCohorts(token, person.publicId, cohortIds));
                        }} />
                      <span>{cohort.name}</span>
                    </label>)}
                  </div>
                </li>)}
              </ul>
            )}
          </section>
        </>}

        <aside className="office-roadmap">
          <span className="office-section-number">NEXT DESK</span>
          <h2>Commute curation</h2>
          <p>The commute stop review tool can use this same D1-backed office and navigation.</p>
        </aside>
      </main>
    </div>
  );
}

createRoot(document.getElementById("root") as HTMLElement).render(<InternalOffice />);
