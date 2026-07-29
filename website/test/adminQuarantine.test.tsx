// ABOUTME: Verifies quarantine visibility in the browser admin console.
// ABOUTME: Covers the global room index and detailed selected-room safety state.
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import {
  QuarantinedRoomsOverview,
  RoomQuarantinePanel,
  type RoomQuarantineStatus,
} from "../adminQuarantine";

const AUTOMATIC_QUARANTINE: RoomQuarantineStatus = {
  roomId: "playhtml.fun-%2Fweek%2F2",
  quarantined: true,
  reason: "repeated-failures",
  detail: "load work failed 8 times in a row",
  quarantinedAt: "2026-07-29T05:00:00.000Z",
  failures: {
    load: 8,
    alarm: 0,
    quarantineAfter: 8,
    loadRetryAt: null,
    alarmRetryAt: null,
  },
  compaction: {
    parked: true,
    documentBytes: 6 * 1024 * 1024,
    maxInDurableObjectBytes: 4 * 1024 * 1024,
  },
  loadDeferred: {
    active: false,
    until: null,
  },
  externalQuarantineFlag: "load work failed 8 times in a row",
};

describe("QuarantinedRoomsOverview", () => {
  test("shows every room and opens the selected room", () => {
    const onSelectRoom = vi.fn();

    render(
      <QuarantinedRoomsOverview
        overview={{
          state: "ready",
          rooms: [
            {
              roomId: "playhtml.fun-%2Fweek%2F2",
              detail: "load work failed 8 times in a row",
            },
            {
              roomId: "playhtml.fun-%2Fbunny",
              detail: "operator investigation",
            },
          ],
        }}
        onRefresh={() => {}}
        onSelectRoom={onSelectRoom}
      />
    );

    expect(screen.getByText("playhtml.fun-/week/2")).toBeTruthy();
    expect(screen.getByText("playhtml.fun-/bunny")).toBeTruthy();

    fireEvent.click(
      screen.getByRole("button", {
        name: /playhtml\.fun-\/week\/2/i,
      })
    );
    expect(onSelectRoom).toHaveBeenCalledWith(
      "playhtml.fun-%2Fweek%2F2"
    );
  });

  test("only claims the list is empty after a successful read", () => {
    const { rerender } = render(
      <QuarantinedRoomsOverview
        overview={{ state: "ready", rooms: [] }}
        onRefresh={() => {}}
        onSelectRoom={() => {}}
      />
    );

    expect(
      screen.getByText("No rooms are currently quarantined.")
    ).toBeTruthy();

    rerender(
      <QuarantinedRoomsOverview
        overview={{
          state: "error",
          rooms: [],
          message: "Failed to read the quarantine control plane",
        }}
        onRefresh={() => {}}
        onSelectRoom={() => {}}
      />
    );

    expect(
      screen.queryByText("No rooms are currently quarantined.")
    ).toBeNull();
    expect(
      screen.getByText("Failed to read the quarantine control plane")
    ).toBeTruthy();
  });
});

describe("RoomQuarantinePanel", () => {
  test("shows automatic quarantine and the failure ledger", () => {
    render(<RoomQuarantinePanel status={AUTOMATIC_QUARANTINE} />);

    expect(screen.getByText("Automatically quarantined")).toBeTruthy();
    expect(
      screen.getAllByText("load work failed 8 times in a row", {
        selector: ".room-quarantine-details span",
      })
    ).toHaveLength(2);
    expect(
      screen.getByText(/8 load \/ 0 alarm failures; quarantine at 8/)
    ).toBeTruthy();
    expect(screen.getByText(/Parked at 6\.00 MB/)).toBeTruthy();
  });
});
