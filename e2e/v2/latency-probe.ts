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
  await a.evaluate(() => { (window as any).__cpeBase = (window as any).__cpeRenders ?? 0; (window as any).__ppBase = (window as any).__ppRenders ?? 0; (window as any).__b2 = {pp: (window as any).__pp ?? 0, cpe: (window as any).__cpe ?? 0, main: (window as any).__main ?? 0, fwc: (window as any).__fwc ?? 0, srs: (window as any).__srs ?? 0, sd: (window as any).__srsData ?? 0, sa: (window as any).__srsAw ?? 0, si: (window as any).__srsAwId ?? 0, sm: (window as any).__srsMy ?? 0}; });
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
      return r.x > 40 && r.y > 200 && r.x < 1150 && r.y < 640;
    }) ?? null;
  }, SEL);
  let el = handle.asElement();
  if (!el && !process.env.PROBE_EMPTY) {
    // Pan the board so the first word lands mid-viewport, then retry.
    await a.evaluate((sel) => {
      const target = document.querySelector(sel) as HTMLElement | null;
      if (!target) return;
      const r = target.getBoundingClientRect();
      const dx = r.x - 400;
      const dy = r.y - 400;
      const steps = 10;
      for (let i = 0; i < steps; i++) {
        document.dispatchEvent(
          new WheelEvent("wheel", { deltaX: dx / steps, deltaY: dy / steps, bubbles: true, cancelable: true }),
        );
      }
    }, SEL);
    await a.waitForTimeout(300);
    console.log("first word rect after pan:", await a.evaluate((sel) => {
      const t = document.querySelector(sel) as HTMLElement | null;
      return t ? JSON.stringify(t.getBoundingClientRect()) : "none";
    }, SEL));
    const retry = await a.evaluateHandle((sel) => {
      const els = [...document.querySelectorAll(sel)] as HTMLElement[];
      return els.find((e) => {
        const r = e.getBoundingClientRect();
        return r.x > 40 && r.y > 200 && r.x < 1150 && r.y < 640;
      }) ?? null;
    }, SEL);
    el = retry.asElement();
  }
  if (!el && process.env.PROBE_EMPTY) el = await a.locator(SEL).first().elementHandle();
  if (!el) { console.log("NO VISIBLE TARGET FOUND"); await browser.close(); return; }
  const box = (await el.boundingBox())!;
  console.log("target box:", JSON.stringify(box));
  const draggedId = await el.evaluate((node) => (node.closest("[can-move]") as HTMLElement | null)?.id ?? (node as HTMLElement).id);
  console.log("dragged element id:", draggedId);
  await b.evaluate((id) => {
    const el = document.getElementById(id);
    if (!el) { (window as any).__watchMissing = true; return; }
    (window as any).__changes = [];
    new MutationObserver(() => {
      (window as any).__changes.push({ t: Date.now(), s: el.getAttribute("style") });
    }).observe(el, { attributes: true, attributeFilter: ["style"] });
  }, draggedId);
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
  console.log("page census:", await a.evaluate(() => JSON.stringify({
    canMoveElements: document.querySelectorAll("[can-move]").length,
    fridgeWordHolders: document.querySelectorAll(".fridgeWordHolder").length,
    cpeSinceLoad: (window as any).__cpe ?? 0,
  })));
  console.log("render counters during drag:", await a.evaluate(() => { const b = (window as any).__b2 ?? {pp:0,cpe:0,main:0,fwc:0,srs:0,sd:0,sa:0,si:0,sm:0}; return JSON.stringify({playProvider: ((window as any).__pp ?? 0) - b.pp, canPlayElement: ((window as any).__cpe ?? 0) - b.cpe, fridgeMain: ((window as any).__main ?? 0) - b.main, wordListContent: ((window as any).__fwc ?? 0) - b.fwc, syncCalls: ((window as any).__srs ?? 0) - b.srs, dataChanges: ((window as any).__srsData ?? 0) - b.sd, awarenessChanges: ((window as any).__srsAw ?? 0) - b.sa, awarenessByIdChanges: ((window as any).__srsAwId ?? 0) - b.si, myAwarenessChanges: ((window as any).__srsMy ?? 0) - b.sm}); }));
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
