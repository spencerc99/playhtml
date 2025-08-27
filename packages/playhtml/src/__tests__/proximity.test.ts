import { describe, it, expect, beforeEach, vi } from "vitest";
import { calculateDistance, PROXIMITY_THRESHOLD } from "@playhtml/common";
import type { Cursor, CursorPresence, PlayerIdentity } from "@playhtml/common";

// Mock the CursorClientAwareness class for testing proximity logic
import { SpatialGrid } from "../cursors/spatial-grid";

class MockCursorClient {
  private spatialGrid = new SpatialGrid<CursorPresence>(300);
  private proximityUsers = new Set<string>();
  private currentCursor: Cursor | null = null;

  public onProximityEntered = vi.fn();
  public onProximityLeft = vi.fn();

  setCurrentCursor(cursor: Cursor | null) {
    this.currentCursor = cursor;
  }

  setCursors(cursors: Map<string, CursorPresence>) {
    this.spatialGrid.clear();

    for (const [connectionId, presence] of cursors) {
      if (presence.cursor) {
        this.spatialGrid.insert({
          id: connectionId,
          x: presence.cursor.x,
          y: presence.cursor.y,
          data: presence,
        });
      }
    }
  }

  checkProximityOptimized(
    proximityThreshold: number = PROXIMITY_THRESHOLD
  ): void {
    if (!this.currentCursor) return;

    const currentProximity = new Set<string>();

    // Use spatial grid to efficiently find nearby cursors
    const nearbyItems = this.spatialGrid.findNearby(
      this.currentCursor.x,
      this.currentCursor.y,
      proximityThreshold
    );

    // Check precise distance for nearby candidates
    for (const item of nearbyItems) {
      const presence = item.data;
      if (!presence.cursor) continue;

      const distance = calculateDistance(this.currentCursor, presence.cursor);
      const isNear = distance < proximityThreshold;

      if (isNear) {
        currentProximity.add(item.id);

        // Trigger proximity entered if this is new
        if (!this.proximityUsers.has(item.id)) {
          this.onProximityEntered(presence.playerIdentity);
        }
      }
    }

    // Check for users who left proximity
    for (const connectionId of this.proximityUsers) {
      if (!currentProximity.has(connectionId)) {
        this.onProximityLeft(connectionId);
      }
    }

    this.proximityUsers = currentProximity;
  }

  getProximityUsers() {
    return new Set(this.proximityUsers);
  }
}

describe("Proximity Detection", () => {
  let mockClient: MockCursorClient;

  beforeEach(() => {
    mockClient = new MockCursorClient();
    vi.clearAllMocks();
  });

  describe("calculateDistance", () => {
    it("should calculate correct distance between two points", () => {
      const cursor1: Cursor = { x: 0, y: 0, pointer: "mouse" };
      const cursor2: Cursor = { x: 3, y: 4, pointer: "mouse" };

      expect(calculateDistance(cursor1, cursor2)).toBe(5); // 3-4-5 triangle
    });

    it("should handle same position cursors", () => {
      const cursor1: Cursor = { x: 100, y: 100, pointer: "mouse" };
      const cursor2: Cursor = { x: 100, y: 100, pointer: "mouse" };

      expect(calculateDistance(cursor1, cursor2)).toBe(0);
    });

    it("should handle negative coordinates", () => {
      const cursor1: Cursor = { x: -10, y: -10, pointer: "mouse" };
      const cursor2: Cursor = { x: -7, y: -6, pointer: "mouse" };

      expect(calculateDistance(cursor1, cursor2)).toBe(5); // 3-4-5 triangle
    });
  });

  // Helper functions for tests
  const createPlayerIdentity = (id: string): PlayerIdentity => ({
    publicKey: id,
    playerStyle: { colorPalette: ["#ff0000"] },
    discoveredSites: [],
    createdAt: Date.now(),
  });

  const createCursorPresence = (
    x: number,
    y: number,
    id: string
  ): CursorPresence => ({
    cursor: { x, y, pointer: "mouse" },
    playerIdentity: createPlayerIdentity(id),
    lastSeen: Date.now(),
  });

  describe("proximity detection logic", () => {
    it("should detect when users enter proximity", () => {
      mockClient.setCurrentCursor({ x: 100, y: 100, pointer: "mouse" });

      const cursors = new Map([
        ["user1", createCursorPresence(120, 120, "user1")], // ~28 pixels away (within default threshold)
        ["user2", createCursorPresence(300, 300, "user2")], // ~283 pixels away (outside threshold)
      ]);

      mockClient.setCursors(cursors);
      mockClient.checkProximityOptimized();

      expect(mockClient.onProximityEntered).toHaveBeenCalledTimes(1);
      expect(mockClient.onProximityEntered).toHaveBeenCalledWith(
        cursors.get("user1")?.playerIdentity
      );
      expect(mockClient.getProximityUsers()).toEqual(new Set(["user1"]));
    });

    it("should detect when users leave proximity", () => {
      mockClient.setCurrentCursor({ x: 100, y: 100, pointer: "mouse" });

      // First, establish proximity
      const cursors1 = new Map([
        ["user1", createCursorPresence(120, 120, "user1")],
      ]);
      mockClient.setCursors(cursors1);
      mockClient.checkProximityOptimized();

      expect(mockClient.getProximityUsers()).toEqual(new Set(["user1"]));

      // Then move user1 away
      const cursors2 = new Map([
        ["user1", createCursorPresence(300, 300, "user1")],
      ]);
      mockClient.setCursors(cursors2);
      mockClient.checkProximityOptimized();

      expect(mockClient.onProximityLeft).toHaveBeenCalledTimes(1);
      expect(mockClient.onProximityLeft).toHaveBeenCalledWith("user1");
      expect(mockClient.getProximityUsers()).toEqual(new Set());
    });

    it("should handle custom proximity threshold", () => {
      mockClient.setCurrentCursor({ x: 100, y: 100, pointer: "mouse" });

      const cursors = new Map([
        ["user1", createCursorPresence(130, 130, "user1")], // ~42 pixels away
      ]);
      mockClient.setCursors(cursors);

      // Test with small threshold (user1 should not be in proximity)
      mockClient.checkProximityOptimized(30);
      expect(mockClient.onProximityEntered).not.toHaveBeenCalled();

      // Test with large threshold (user1 should be in proximity)
      mockClient.checkProximityOptimized(50);
      expect(mockClient.onProximityEntered).toHaveBeenCalledWith(
        cursors.get("user1")?.playerIdentity
      );
    });

    it("should handle multiple users in proximity", () => {
      mockClient.setCurrentCursor({ x: 100, y: 100, pointer: "mouse" });

      const cursors = new Map([
        ["user1", createCursorPresence(110, 110, "user1")], // ~14 pixels
        ["user2", createCursorPresence(90, 90, "user2")], // ~14 pixels
        ["user3", createCursorPresence(120, 80, "user3")], // ~28 pixels
      ]);

      mockClient.setCursors(cursors);
      mockClient.checkProximityOptimized();

      expect(mockClient.onProximityEntered).toHaveBeenCalledTimes(3);
      expect(mockClient.getProximityUsers()).toEqual(
        new Set(["user1", "user2", "user3"])
      );
    });

    it("should ignore users without cursor position", () => {
      mockClient.setCurrentCursor({ x: 100, y: 100, pointer: "mouse" });

      const cursors = new Map([
        [
          "user1",
          {
            cursor: null,
            playerIdentity: createPlayerIdentity("user1"),
            lastSeen: Date.now(),
          },
        ],
        ["user2", createCursorPresence(110, 110, "user2")],
      ]);

      mockClient.setCursors(cursors);
      mockClient.checkProximityOptimized();

      expect(mockClient.onProximityEntered).toHaveBeenCalledTimes(1);
      expect(mockClient.getProximityUsers()).toEqual(new Set(["user2"]));
    });

    it("should handle when current cursor is null", () => {
      mockClient.setCurrentCursor(null);

      const cursors = new Map([
        ["user1", createCursorPresence(100, 100, "user1")],
      ]);

      mockClient.setCursors(cursors);
      mockClient.checkProximityOptimized();

      expect(mockClient.onProximityEntered).not.toHaveBeenCalled();
      expect(mockClient.onProximityLeft).not.toHaveBeenCalled();
    });

    it("should maintain proximity state across updates", () => {
      mockClient.setCurrentCursor({ x: 100, y: 100, pointer: "mouse" });

      // Initial proximity
      const cursors1 = new Map([
        ["user1", createCursorPresence(110, 110, "user1")],
      ]);
      mockClient.setCursors(cursors1);
      mockClient.checkProximityOptimized();

      expect(mockClient.onProximityEntered).toHaveBeenCalledTimes(1);

      // User stays in proximity (should not trigger enter again)
      const cursors2 = new Map([
        ["user1", createCursorPresence(115, 115, "user1")], // Still close
      ]);
      mockClient.setCursors(cursors2);
      mockClient.checkProximityOptimized();

      // Should not call onProximityEntered again
      expect(mockClient.onProximityEntered).toHaveBeenCalledTimes(1);
      expect(mockClient.getProximityUsers()).toEqual(new Set(["user1"]));
    });
  });

  describe("performance with spatial partitioning", () => {
    it("should efficiently handle large numbers of cursors", () => {
      mockClient.setCurrentCursor({ x: 1000, y: 1000, pointer: "mouse" });

      // Create 100 cursors scattered across space
      const cursors = new Map();
      for (let i = 0; i < 100; i++) {
        const x = Math.random() * 5000; // Spread across large area
        const y = Math.random() * 5000;
        cursors.set(`user${i}`, createCursorPresence(x, y, `user${i}`));
      }

      // Add a few cursors near our position
      cursors.set("near1", createCursorPresence(1020, 1020, "near1"));
      cursors.set("near2", createCursorPresence(1050, 1050, "near2"));

      const startTime = performance.now();
      mockClient.setCursors(cursors);
      mockClient.checkProximityOptimized();
      const endTime = performance.now();

      // Should complete quickly even with 100+ cursors
      expect(endTime - startTime).toBeLessThan(10); // Less than 10ms

      // Should only find the nearby cursors
      const proximityUsers = mockClient.getProximityUsers();
      expect(proximityUsers.size).toBeLessThan(10); // Much fewer than total
      expect(proximityUsers.has("near1")).toBe(true);
      expect(proximityUsers.has("near2")).toBe(true);
    });
  });
});
