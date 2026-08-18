// ABOUTME: Tests WWO admin access-control parsing and authenticated request shapes.
// ABOUTME: Covers bulk public-ID input and cohort feature updates.

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  addPeople,
  parsePeopleInput,
  updateCohortFeatures,
} from "./accessControlApi";

vi.mock("@movement/config", () => ({ WORKER_URL: "https://worker.example" }));

const PUBLIC_ID = `pk_${"a".repeat(130)}`;
const SECOND_PUBLIC_ID = `pk_${"b".repeat(130)}`;

describe("accessControlApi", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("parses newline and CSV people input and removes duplicate IDs", () => {
    expect(parsePeopleInput(
      `${PUBLIC_ID}, TESTER@EXAMPLE.COM\n${SECOND_PUBLIC_ID}\n${PUBLIC_ID}`,
    )).toEqual([
      { publicId: PUBLIC_ID, email: "tester@example.com" },
      { publicId: SECOND_PUBLIC_ID, email: null },
    ]);
  });

  it("reports the exact invalid bulk-input line", () => {
    expect(() => parsePeopleInput(`${PUBLIC_ID}\npk_short`)).toThrow(
      "Line 2 needs a valid public ID",
    );
  });

  it("bulk-adds people to the selected cohort with bearer authentication", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ added: 1 }), { status: 201 }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const people = [{ publicId: PUBLIC_ID, email: "tester@example.com" }];

    await addPeople("secret", "closed-beta", people);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://worker.example/admin/access-control/people",
      {
        method: "POST",
        headers: {
          Authorization: "Bearer secret",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ cohortId: "closed-beta", people }),
      },
    );
  });

  it("updates one cohort's feature grants", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await updateCohortFeatures("secret", "closed-beta", ["COMMUTE", "SCRAPS"]);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://worker.example/admin/access-control/cohorts/closed-beta",
      expect.objectContaining({
        method: "PUT",
        body: JSON.stringify({ featureIds: ["COMMUTE", "SCRAPS"] }),
      }),
    );
  });
});
