// ABOUTME: Measures end-to-end remote sync latency between two browser contexts.
// ABOUTME: Run: bun scratchpad/latency-probe.ts (servers on 5178/2000 must be up)

import { chromium } from "@playwright/test";

const SITE = process.env.PROBE_URL ?? "http://localhost:5178/test/v2.html?room=latency-" + Math.floor(Math.random() * 1e6);

const SEL = process.env.PROBE_SEL ?? "#movable";

async function main() {
  const browser = await chromium.launch();
  const ctxA = await browser.newContext();
  const ctxB = await browser.newContext();
  const a = await ctxA.newPage();
  const b = await ctxB.newPage();
  await a.goto(SITE);
  await b.goto(SITE);
  await a.waitForTimeout(1500);
  await b.waitForTimeout(500);

  // B: record wall-clock time of every style change on the movable element.
  await b.evaluate((sel) => {
    const el = document.querySelector(sel)!;
    (window as any).__changes = [];
    new MutationObserver(() => {
      (window as any).__changes.push({ t: Date.now(), s: el.getAttribute("style") });
    }).observe(el, { attributes: true, attributeFilter: ["style"] });
  }, SEL);




  // Count cursor-presence change callbacks during the drag on A.
  await a.evaluate(() => {
    (window as any).__presenceCount = 0;
    (window as any).__usersCount = 0;
    const client = (window as any).playhtml?.cursorClient;
    client?.onCursorPresencesChange?.(() => { (window as any).__presenceCount++; });
    (window as any).playhtml?.users?.onChange?.(() => { (window as any).__usersCount++; });
  });
  await a.evaluate(() => { (window as any).__cpeBase = (window as any).__cpeRenders ?? 0; (window as any).__ppBase = (window as any).__ppRenders ?? 0; (window as any).__b = {d: (window as any).__cDataSet ?? 0, r: (window as any).__cRender ?? 0, ac: (window as any).__cAwareCheck ?? 0, af: (window as any).__cAwareFire ?? 0}; });
  // CPU-profile page A during the drag.
  const cdp = await ctxA.newCDPSession(a);
  await cdp.send("Profiler.enable");
  await cdp.send("Profiler.start");
  // A: real mouse drag at ~60Hz for 1s, recording wall-clock per step.
  // Pick a target that is actually inside the viewport.
  const handle = await a.evaluateHandle((sel) => {
    const els = [...document.querySelectorAll(sel)] as HTMLElement[];
    return els.find((e) => {
      const r = e.getBoundingClientRect();
      return r.x > 40 && r.y > 260 && r.x + r.width < 1150 && r.y + r.height < 640 && r.width > 5;
    }) ?? null;
  }, SEL);
  const el = handle.asElement()!;
  if (!el) { console.log("NO VISIBLE TARGET FOUND"); await browser.close(); return; }
  const box = (await el.boundingBox())!;
  console.log("target box:", JSON.stringify(box));
  const startX = process.env.PROBE_EMPTY ? 900 : box.x + box.width / 2;
  const startY = process.env.PROBE_EMPTY ? 140 : box.y + box.height / 2;
  await a.mouse.move(startX, startY);
  if (!process.env.PROBE_NO_DRAG) await a.mouse.down();
  const sendTimes: number[] = [];
  for (let i = 1; i <= 60; i++) {
    await a.mouse.move(startX + i * 3, startY + i * 2);
    sendTimes.push(Date.now());
    await a.waitForTimeout(16);
  }
  if (!process.env.PROBE_NO_DRAG) await a.mouse.up();
  sendTimes.push(Date.now());



  console.log("CanPlayElement renders during drag:", await a.evaluate(() => {
    const n = (window as any).__cpeRenders ?? 0;
    return n - ((window as any).__cpeBase ?? 0);
  }));
  console.log("core counters during drag:", await a.evaluate(() => { const b = (window as any).__b ?? {d:0,r:0,ac:0,af:0}; return JSON.stringify({dataSets: ((window as any).__cDataSet ?? 0) - b.d, renders: ((window as any).__cRender ?? 0) - b.r, awareChecks: ((window as any).__cAwareCheck ?? 0) - b.ac, awareFires: ((window as any).__cAwareFire ?? 0) - b.af}); }));
  console.log("PlayProvider renders during drag:", await a.evaluate(() => ((window as any).__ppRenders ?? 0) - ((window as any).__ppBase ?? 0)));
  console.log("A presence callbacks:", await a.evaluate(() => (window as any).__presenceCount), "users.onChange callbacks:", await a.evaluate(() => (window as any).__usersCount));
  const { profile } = (await cdp.send("Profiler.stop")) as any;
  const selfTime = new Map<string, number>();
  const timeDeltas: number[] = profile.timeDeltas ?? [];
  const samples: number[] = profile.samples ?? [];
  const nodeById = new Map<number, any>(profile.nodes.map((n: any) => [n.id, n]));
  samples.forEach((id: number, i: number) => {
    const node = nodeById.get(id);
    if (!node) return;
    const fn = node.callFrame.functionName || "(anonymous)";
    const url = (node.callFrame.url || "").split("/").slice(-1)[0].split("?")[0];
    const key = fn + " @ " + url;
    selfTime.set(key, (selfTime.get(key) ?? 0) + (timeDeltas[i] ?? 0));
  });
  const top = [...selfTime.entries()].sort((x, y) => y[1] - x[1]).slice(0, 15);
  console.log("Top self-time during drag (us):");
  for (const [k, v] of top) console.log(String(Math.round(v)).padStart(9), k);
  await b.waitForTimeout(1500);
  const changes: { t: number }[] = await b.evaluate(() => (window as any).__changes);

  console.log(`A sent ${sendTimes.length} moves over ${sendTimes[sendTimes.length - 1] - sendTimes[0]}ms`);
  console.log(`B observed ${changes.length} style changes`);
  if (changes.length > 1) {
    const first = changes[0].t - sendTimes[0];
    const last = changes[changes.length - 1].t - sendTimes[sendTimes.length - 1];
    const gaps = changes.slice(1).map((c, i) => c.t - changes[i].t);
    gaps.sort((x, y) => x - y);
    console.log(`first-update latency: ${first}ms, settle latency after last send: ${last}ms`);
    console.log(`inter-update gaps on B: median ${gaps[Math.floor(gaps.length / 2)]}ms, p90 ${gaps[Math.floor(gaps.length * 0.9)]}ms, max ${gaps[gaps.length - 1]}ms`);
  }

  // Inspect B's data layer: did the ops arrive in the store?
  const bReport = await b.evaluate((sel) => {
    const el = document.querySelector(sel)!;
    const id = el.id;
    const store = (window as any).playhtml?.__v2Store;
    const snap = store?.getSnapshot?.();
    return {
      elementId: id,
      hasStore: Boolean(store),
      dataInStore: snap ? JSON.stringify(snap.state["can-move"]?.[id]) : null,
      styleNow: el.getAttribute("style"),
    };
  }, SEL);
  console.log("B data-layer report:", JSON.stringify(bReport));
  const aReport = await a.evaluate((sel) => {
    const el = document.querySelector(sel)!;
    const id = el.id;
    const store = (window as any).playhtml?.__v2Store;
    const snap = store?.getSnapshot?.();
    return {
      elementId: id,
      dataInStore: snap ? JSON.stringify(snap.state["can-move"]?.[id]) : null,
      pendingOps: store?.getPendingOperations?.().length ?? -1,
    };
  }, SEL);
  console.log("A data-layer report:", JSON.stringify(aReport));
  await browser.close();
}

void main();
