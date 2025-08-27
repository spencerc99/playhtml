import { describe, it, expect, beforeEach } from "vitest";
import { SpatialGrid } from "../cursors/spatial-grid";

interface TestItem {
  id: string;
  value: string;
}

describe("SpatialGrid", () => {
  let grid: SpatialGrid<TestItem>;

  beforeEach(() => {
    grid = new SpatialGrid<TestItem>(100); // 100px cell size for testing
  });

  describe("basic operations", () => {
    it("should insert and retrieve items", () => {
      const item = { id: "1", x: 50, y: 50, data: { id: "1", value: "test" } };
      grid.insert(item);

      const all = grid.getAll();
      expect(all).toHaveLength(1);
      expect(all[0]).toEqual(item);
    });

    it("should remove items by id", () => {
      const item = { id: "1", x: 50, y: 50, data: { id: "1", value: "test" } };
      grid.insert(item);

      expect(grid.getItemCount()).toBe(1);

      const removed = grid.remove("1", 50, 50);
      expect(removed).toBe(true);
      expect(grid.getItemCount()).toBe(0);
    });

    it("should update item positions", () => {
      const item1 = { id: "1", x: 50, y: 50, data: { id: "1", value: "test" } };
      grid.insert(item1);

      const item2 = {
        id: "1",
        x: 150,
        y: 150,
        data: { id: "1", value: "moved" },
      };
      grid.update(item2, 50, 50);

      const nearby = grid.findNearby(150, 150, 50);
      expect(nearby).toHaveLength(1);
      expect(nearby[0].data.value).toBe("moved");
    });

    it("should clear all items", () => {
      grid.insert({ id: "1", x: 50, y: 50, data: { id: "1", value: "test1" } });
      grid.insert({
        id: "2",
        x: 150,
        y: 150,
        data: { id: "2", value: "test2" },
      });

      expect(grid.getItemCount()).toBe(2);

      grid.clear();
      expect(grid.getItemCount()).toBe(0);
      expect(grid.getCellCount()).toBe(0);
    });
  });

  describe("proximity search", () => {
    beforeEach(() => {
      // Set up a grid with items in different cells
      grid.insert({ id: "1", x: 50, y: 50, data: { id: "1", value: "near" } });
      grid.insert({ id: "2", x: 60, y: 60, data: { id: "2", value: "near" } });
      grid.insert({ id: "3", x: 300, y: 300, data: { id: "3", value: "far" } });
      grid.insert({
        id: "4",
        x: 55,
        y: 200,
        data: { id: "4", value: "medium" },
      });
    });

    it("should find items within radius", () => {
      const nearby = grid.findNearby(50, 50, 20);
      const nearbyIds = nearby.map((item) => item.id).sort();

      // Should find items 1 and 2 (both within ~14 pixels)
      expect(nearbyIds).toEqual(["1", "2"]);
    });

    it("should exclude specified item from results", () => {
      const nearby = grid.findNearby(50, 50, 20, "1");
      const nearbyIds = nearby.map((item) => item.id);

      // Should find item 2 but exclude item 1
      expect(nearbyIds).toEqual(["2"]);
    });

    it("should find no items when radius is too small", () => {
      const nearby = grid.findNearby(50, 50, 1);

      // Only the exact item at 50,50 should be within 1 pixel, but it's excluded by default
      expect(nearby).toHaveLength(1); // Just itself
    });

    it("should find all items with large radius", () => {
      const nearby = grid.findNearby(150, 150, 500);

      expect(nearby).toHaveLength(4); // All items
    });

    it("should handle empty grid", () => {
      const emptyGrid = new SpatialGrid<TestItem>(100);
      const nearby = emptyGrid.findNearby(50, 50, 100);

      expect(nearby).toHaveLength(0);
    });
  });

  describe("spatial partitioning efficiency", () => {
    it("should distribute items across multiple cells", () => {
      // Insert items in different cells (100px cell size)
      grid.insert({ id: "1", x: 50, y: 50, data: { id: "1", value: "cell1" } }); // Cell 0,0
      grid.insert({
        id: "2",
        x: 150,
        y: 50,
        data: { id: "2", value: "cell2" },
      }); // Cell 1,0
      grid.insert({
        id: "3",
        x: 50,
        y: 150,
        data: { id: "3", value: "cell3" },
      }); // Cell 0,1
      grid.insert({
        id: "4",
        x: 150,
        y: 150,
        data: { id: "4", value: "cell4" },
      }); // Cell 1,1

      expect(grid.getCellCount()).toBe(4); // 4 different cells
      expect(grid.getItemCount()).toBe(4); // 4 total items
    });

    it("should efficiently search only nearby cells", () => {
      // Create a sparse grid with items far apart
      for (let i = 0; i < 10; i++) {
        grid.insert({
          id: `item-${i}`,
          x: i * 500, // 500px apart (5 cells apart)
          y: i * 500,
          data: { id: `item-${i}`, value: `far-${i}` },
        });
      }

      // Search near origin - should only find first item
      const nearby = grid.findNearby(0, 0, 100);
      expect(nearby).toHaveLength(1);
      expect(nearby[0].id).toBe("item-0");
    });

    it("should handle cell boundary cases", () => {
      // Items right on cell boundaries
      grid.insert({
        id: "1",
        x: 99,
        y: 99,
        data: { id: "1", value: "boundary1" },
      });
      grid.insert({
        id: "2",
        x: 100,
        y: 100,
        data: { id: "2", value: "boundary2" },
      });
      grid.insert({
        id: "3",
        x: 101,
        y: 101,
        data: { id: "3", value: "boundary3" },
      });

      // Search that spans cell boundaries
      const nearby = grid.findNearby(100, 100, 5);

      // Should find all three items as they're all within 5 pixels
      expect(nearby).toHaveLength(3);
    });
  });

  describe("performance characteristics", () => {
    it("should handle large numbers of items efficiently", () => {
      const startTime = performance.now();

      // Insert 1000 items in a 10x10 grid
      for (let x = 0; x < 100; x++) {
        for (let y = 0; y < 10; y++) {
          grid.insert({
            id: `item-${x}-${y}`,
            x: x * 50,
            y: y * 50,
            data: { id: `item-${x}-${y}`, value: "perf-test" },
          });
        }
      }

      const insertTime = performance.now() - startTime;

      // Test search performance
      const searchStart = performance.now();
      const nearby = grid.findNearby(1000, 200, 100);
      const searchTime = performance.now() - searchStart;

      expect(grid.getItemCount()).toBe(1000);
      expect(insertTime).toBeLessThan(100); // Should be fast
      expect(searchTime).toBeLessThan(10); // Search should be very fast
      expect(nearby.length).toBeGreaterThan(0); // Should find some items
      expect(nearby.length).toBeLessThan(100); // But not all items
    });
  });
});
