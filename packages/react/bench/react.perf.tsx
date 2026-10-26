// ABOUTME: Counts React re-renders on common paths: remote edits, own edits, presence churn.
// ABOUTME: Writes deterministic counts (and info-only *_ms timings) to bench/out/metrics.json.
import React from "react";
import * as fs from "node:fs";
import * as path from "node:path";
import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { act, cleanup, render, waitFor } from "@testing-library/react";
import * as Y from "yjs";
import { elementHandlers, playhtml, resetPlayHTML, TagType } from "playhtml";
import { PlayProvider, usePresence, withSharedState } from "../src/index";

const OUT = path.resolve(__dirname, "out/metrics.json");
const metrics: Record<string, number> = {};
const CARDS = 50;

// jsdom has no layout; the cursor client asks what is under the pointer.
document.elementFromPoint ??= () => document.body;

let renders: Record<string, number> = {};
const setters: Record<string, (data: { count: number }) => void> = {};

const Card = withSharedState(
  ({ id }: { id: string }) => ({ id, defaultData: { count: 0 } }),
  ({ data, setData }, { id }: { id: string }) => {
    renders[id] = (renders[id] ?? 0) + 1;
    setters[id] = setData;
    return <div>{data.count}</div>;
  },
);

function StatusBadge() {
  const { presences } = usePresence("status");
  renders.status = (renders.status ?? 0) + 1;
  return <span>{presences.size}</span>;
}

function Page() {
  return (
    <>
      {Array.from({ length: CARDS }, (_, i) => (
        <Card key={i} id={`card-${i}`} />
      ))}
      <StatusBadge />
    </>
  );
}

function provider(): any {
  return ((globalThis as any).PLAYHTML_TEST_PROVIDERS as any[]).at(-1);
}

function sum(keys: string[]) {
  return keys.reduce((total, key) => total + (renders[key] ?? 0), 0);
}

const otherCards = Array.from({ length: CARDS - 1 }, (_, i) => `card-${i + 1}`);

async function mountPage(room: string, cursors = false) {
  history.replaceState(null, "", room);
  const view = render(
    <PlayProvider initOptions={{ cursors: { enabled: cursors } }}>
      <Page />
    </PlayProvider>,
  );
  await waitFor(() => {
    expect(elementHandlers.get(TagType.CanPlay)?.size).toBe(CARDS);
  });
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 50));
  });
  return view;
}

// Someone else bumps card-0's count once per frame.
async function remoteEdits(count: number) {
  const doc: Y.Doc = provider().doc;
  const remote = new Y.Doc();
  Y.applyUpdate(remote, Y.encodeStateAsUpdate(doc));
  for (let i = 1; i <= count; i += 1) {
    const vector = Y.encodeStateVector(remote);
    const records = remote.getMap("play").get("can-play") as Y.Map<any>;
    const entry = records.get("card-0");
    remote.transact(() => {
      if (entry instanceof Y.Map) entry.set("count", i);
      else records.set("card-0", { count: i });
    });
    await act(async () => {
      Y.applyUpdate(doc, Y.encodeStateAsUpdate(remote, vector), "remote");
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
}

beforeEach(async () => {
  (globalThis as any).PLAYHTML_TEST_DISABLE_AUTO_SYNC = false;
  (globalThis as any).PLAYHTML_TEST_PROVIDERS = [];
  await resetPlayHTML();
  document.body.innerHTML = "";
  renders = {};
});

afterEach(async () => {
  vi.useRealTimers();
  cleanup();
  await resetPlayHTML();
});

afterAll(() => {
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(metrics, null, 2));
});

describe("react render performance", () => {
  it("remote edits to one element", async () => {
    await mountPage("/bench-react-remote");
    renders = {};
    await remoteEdits(20);
    expect(document.body.textContent).toContain("20");
    metrics.react_remote_own_renders = renders["card-0"] ?? 0;
    metrics.react_remote_unrelated_renders = sum([...otherCards, "status"]);
  });

  it("own edits to one element", async () => {
    await mountPage("/bench-react-local");
    renders = {};
    for (let i = 1; i <= 20; i += 1) {
      await act(async () => {
        setters["card-0"]({ count: i });
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
    }
    expect(document.body.textContent).toContain("20");
    metrics.react_local_own_renders = renders["card-0"] ?? 0;
    metrics.react_local_unrelated_renders = sum([...otherCards, "status"]);
  });

  // 20 people move their cursors for 2 s. Nothing on the page reads cursors,
  // so ideally nothing re-renders.
  it("presence churn", async () => {
    await mountPage("/bench-react-presence", true);
    const socket = (
      (globalThis as any).PLAYHTML_TEST_PRESENCE_SOCKETS as any[]
    ).find(
      (candidate) =>
        candidate.options.room === playhtml.roomId && !candidate.closed,
    );
    const cursor = (i: number, step: number) => ({
      cursor: { x: 10 + step, y: 10 + i * 5, pointer: "mouse" },
      page: "/",
      zone: null,
      at: Date.now(),
    });
    const peers: Record<string, Record<string, unknown>> = {};
    for (let i = 0; i < 20; i += 1) {
      peers[`conn-${i}`] = {
        identity: {
          publicKey: `peer-${i}`,
          playerStyle: { colorPalette: ["#4a9a8a"] },
        },
        cursor: cursor(i, 0),
      };
    }
    await act(async () => {
      socket.receive({ type: "presence-sync", peers });
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    renders = {};
    vi.useFakeTimers({
      toFake: [
        "setTimeout",
        "clearTimeout",
        "Date",
        "performance",
        "requestAnimationFrame",
        "cancelAnimationFrame",
      ],
    });
    for (let frame = 1; frame <= 120; frame += 1) {
      const updates: Record<string, Record<string, unknown>> = {};
      for (let i = 0; i < 20; i += 1)
        updates[`conn-${i}`] = { cursor: cursor(i, frame) };
      await act(async () => {
        socket.receive({ type: "presence-changes", updates, removes: {} });
        await vi.advanceTimersByTimeAsync(16);
      });
    }
    vi.useRealTimers();
    expect(document.querySelectorAll(".playhtml-cursor-other").length).toBe(20);
    metrics.react_presence_card_renders = sum(
      Object.keys(renders).filter((k) => k !== "status"),
    );
    metrics.react_presence_status_renders = renders.status ?? 0;
  });

  // Info-only: time to mount and sync a page of shared cards.
  it("mount time", async () => {
    const timings: number[] = [];
    for (let run = 0; run < 5; run += 1) {
      cleanup();
      await resetPlayHTML();
      (globalThis as any).PLAYHTML_TEST_PROVIDERS = [];
      const start = performance.now();
      await mountPage(`/bench-react-mount-${run}`);
      timings.push(performance.now() - start);
    }
    timings.sort((a, b) => a - b);
    metrics.react_mount_50_ms = +timings[2].toFixed(1);
  });
});
