// ABOUTME: Queues can-mirror observer data writes before they sync through Yjs.
// ABOUTME: Keeps high-frequency DOM mutation bursts to one transaction per frame.
import * as Y from "yjs";

type PendingCanMirrorDataChange = {
  targetDoc: Y.Doc;
  apply: () => void;
};

export class CanMirrorDataQueue {
  private pendingChanges: PendingCanMirrorDataChange[] = [];
  private cancelFlush: (() => void) | null = null;
  private readonly getDoc: () => Y.Doc;

  constructor(getDoc: () => Y.Doc) {
    this.getDoc = getDoc;
  }

  queue(apply: () => void): void {
    this.pendingChanges.push({ targetDoc: this.getDoc(), apply });
    this.requestFlush();
  }

  clear(): void {
    if (this.cancelFlush) {
      this.cancelFlush();
      this.cancelFlush = null;
    }
    this.pendingChanges = [];
  }

  private flush(): void {
    this.cancelFlush = null;
    const changes = this.pendingChanges;
    this.pendingChanges = [];
    if (!changes.length) {
      return;
    }

    const changesByDoc = new Map<Y.Doc, Array<() => void>>();
    for (const change of changes) {
      const docChanges = changesByDoc.get(change.targetDoc) ?? [];
      docChanges.push(change.apply);
      changesByDoc.set(change.targetDoc, docChanges);
    }

    for (const [targetDoc, docChanges] of changesByDoc) {
      targetDoc.transact(() => {
        for (const apply of docChanges) {
          apply();
        }
      });
    }
  }

  private requestFlush(): void {
    if (this.cancelFlush) {
      return;
    }

    const flush = () => this.flush();
    if (typeof window.requestAnimationFrame === "function") {
      const frame = window.requestAnimationFrame(flush);
      this.cancelFlush = () => window.cancelAnimationFrame(frame);
      return;
    }

    const timeout = window.setTimeout(flush, 0);
    this.cancelFlush = () => window.clearTimeout(timeout);
  }
}
