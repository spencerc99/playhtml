// Spatial partitioning grid for efficient proximity detection
// Divides screen space into cells and only checks cursors in nearby cells

export interface Point {
  x: number;
  y: number;
}

export interface GridItem<T> extends Point {
  id: string;
  data: T;
}

export class SpatialGrid<T> {
  private cellSize: number;
  private grid: Map<string, Map<string, GridItem<T>>> = new Map();
  
  constructor(cellSize: number = 200) {
    this.cellSize = cellSize;
  }

  private getCellKey(x: number, y: number): string {
    const cellX = Math.floor(x / this.cellSize);
    const cellY = Math.floor(y / this.cellSize);
    return `${cellX},${cellY}`;
  }

  private getNearbyCellKeys(x: number, y: number, radius: number): string[] {
    const cells: string[] = [];
    const cellRadius = Math.ceil(radius / this.cellSize);
    const centerCellX = Math.floor(x / this.cellSize);
    const centerCellY = Math.floor(y / this.cellSize);

    for (let dx = -cellRadius; dx <= cellRadius; dx++) {
      for (let dy = -cellRadius; dy <= cellRadius; dy++) {
        cells.push(`${centerCellX + dx},${centerCellY + dy}`);
      }
    }
    return cells;
  }

  insert(item: GridItem<T>): void {
    const cellKey = this.getCellKey(item.x, item.y);
    
    if (!this.grid.has(cellKey)) {
      this.grid.set(cellKey, new Map());
    }
    
    this.grid.get(cellKey)!.set(item.id, item);
  }

  remove(id: string, x?: number, y?: number): boolean {
    if (x !== undefined && y !== undefined) {
      // Fast removal if we know the position
      const cellKey = this.getCellKey(x, y);
      const cell = this.grid.get(cellKey);
      if (cell && cell.has(id)) {
        cell.delete(id);
        if (cell.size === 0) {
          this.grid.delete(cellKey);
        }
        return true;
      }
    } else {
      // Slower removal - search all cells
      for (const [cellKey, cell] of this.grid) {
        if (cell.has(id)) {
          cell.delete(id);
          if (cell.size === 0) {
            this.grid.delete(cellKey);
          }
          return true;
        }
      }
    }
    return false;
  }

  update(item: GridItem<T>, oldX?: number, oldY?: number): void {
    if (oldX !== undefined && oldY !== undefined) {
      this.remove(item.id, oldX, oldY);
    } else {
      this.remove(item.id);
    }
    this.insert(item);
  }

  findNearby(x: number, y: number, radius: number, excludeId?: string): GridItem<T>[] {
    const nearby: GridItem<T>[] = [];
    const cellKeys = this.getNearbyCellKeys(x, y, radius);
    const radiusSquared = radius * radius;

    for (const cellKey of cellKeys) {
      const cell = this.grid.get(cellKey);
      if (!cell) continue;

      for (const item of cell.values()) {
        if (excludeId && item.id === excludeId) continue;
        
        const dx = item.x - x;
        const dy = item.y - y;
        const distanceSquared = dx * dx + dy * dy;
        
        if (distanceSquared <= radiusSquared) {
          nearby.push(item);
        }
      }
    }

    return nearby;
  }

  getAll(): GridItem<T>[] {
    const all: GridItem<T>[] = [];
    for (const cell of this.grid.values()) {
      all.push(...cell.values());
    }
    return all;
  }

  clear(): void {
    this.grid.clear();
  }

  // Debug info
  getCellCount(): number {
    return this.grid.size;
  }

  getItemCount(): number {
    let count = 0;
    for (const cell of this.grid.values()) {
      count += cell.size;
    }
    return count;
  }
}