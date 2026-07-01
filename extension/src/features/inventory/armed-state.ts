// ABOUTME: Holds the currently-armed tool and notifies subscribers on change.
// ABOUTME: Pure observable; the UI and experiments react to onArmedChange via this.

import type { ArmedTool } from "./types";

type Sub = (armed: ArmedTool | null) => void;

export class ArmedState {
  private armed: ArmedTool | null = null;
  private subs = new Set<Sub>();

  get(): ArmedTool | null {
    return this.armed;
  }

  arm(itemId: string): void {
    if (this.armed?.itemId === itemId) return;
    this.armed = { itemId };
    this.emit();
  }

  disarm(): void {
    if (this.armed === null) return;
    this.armed = null;
    this.emit();
  }

  subscribe(cb: Sub): () => void {
    this.subs.add(cb);
    return () => this.subs.delete(cb);
  }

  private emit(): void {
    for (const cb of this.subs) cb(this.armed);
  }
}
