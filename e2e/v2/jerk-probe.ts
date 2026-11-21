import { chromium } from "@playwright/test";

const URL = process.env.PROBE_URL!;
async function main() {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.goto(URL);
  await page.waitForTimeout(3000);
  // find a hittable word
  const target = await page.evaluateHandle(() => {
    const els = [...document.querySelectorAll("[can-move] .fridgeWord, [can-move]")] as HTMLElement[];
    return els.find((e) => {
      const r = e.getBoundingClientRect();
      if (r.width < 5 || r.x < 80 || r.y < 280 || r.x > 1100 || r.y > 600) return false;
      const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
      return hit !== null && (e.contains(hit) || hit.contains(e));
    }) ?? null;
  });
  const el = target.asElement();
  if (!el) { console.log("no target"); await browser.close(); return; }
  const id = await el.evaluate((n) => (n.closest("[can-move]") as HTMLElement).id);
  // sampler: every rAF record {t, dataX, styleTransform}
  await page.evaluate((wid) => {
    (window as any).__samples = [];
    const wrapper = document.getElementById(wid) as HTMLElement;
    const handler = (window as any).playhtml.elementHandlers.get("can-move")?.get(wid);
    const loop = () => {
      (window as any).__samples.push({
        t: performance.now(),
        dataX: handler ? Math.round(handler.data.x * 10) / 10 : null,
        tf: wrapper.style.transform,
      });
      if ((window as any).__samples.length < 400) requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }, id);
  await page.evaluate(() => {
    const store = (window as any).playhtml.__v2Store;
    (window as any).__mutates = 0;
    if (!store) { (window as any).__moves = 0; return; }
    (window as any).__moves = 0;
    (window as any).__drags = 0;
    (window as any).__dragXs = [];
    const orig = store.mutate.bind(store);
    (window as any).__writtenXs = [];
    store.mutate = (...args: unknown[]) => {
      (window as any).__mutates++;
      const v = args[2] as { x?: number } | undefined;
      if (v && typeof v === "object" && typeof v.x === "number") (window as any).__writtenXs.push(Math.round(v.x));
      return orig(...args);
    };
    document.addEventListener("pointermove", () => (window as any).__moves++, true);
  });
  await page.evaluate((wid) => {
    const handler = (window as any).playhtml.elementHandlers.get("can-move")?.get(wid);
    if (handler?.onDrag) {
      const orig = handler.onDrag.bind(handler);
      handler.onDrag = (e: unknown, d: { data: { x: number } }) => {
        (window as any).__drags++;
        (window as any).__dragXs.push(Math.round(d.data.x * 10) / 10);
        return orig(e, d);
      };
    }
  }, id);
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Profiler.enable");
  await cdp.send("Profiler.start");
  // circle drag ~1.5s
  const box = (await el.boundingBox())!;
  const cx = box.x + box.width / 2, cy = box.y + box.height / 2;
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  for (let i = 0; i <= 90; i++) {
    const a = (i / 90) * 2 * Math.PI;
    await page.mouse.move(cx + Math.cos(a) * 60, cy + Math.sin(a) * 60);
    await page.waitForTimeout(16);
  }
  await page.mouse.up();
  await page.waitForTimeout(300);
  const { profile } = (await cdp.send("Profiler.stop")) as any;
  const selfTime = new Map<string, number>();
  const nodeById = new Map<number, any>(profile.nodes.map((n: any) => [n.id, n]));
  (profile.samples ?? []).forEach((id: number, i: number) => {
    const node = nodeById.get(id);
    if (!node) return;
    const fn = node.callFrame.functionName || "(anonymous)";
    const url = (node.callFrame.url || "").split("/").slice(-1)[0].split("?")[0];
    selfTime.set(fn + " @ " + url, (selfTime.get(fn + " @ " + url) ?? 0) + (profile.timeDeltas?.[i] ?? 0));
  });
  console.log("Top self-time (us):");
  for (const [k, v] of [...selfTime.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12)) console.log(String(Math.round(v)).padStart(9), k);
  const samples: { t: number; dataX: number; tf: string }[] = await page.evaluate(() => (window as any).__samples);
  const dataChanges: number[] = [];
  const tfChanges: number[] = [];
  for (let i = 1; i < samples.length; i++) {
    if (samples[i].dataX !== samples[i - 1].dataX) dataChanges.push(samples[i].t);
    if (samples[i].tf !== samples[i - 1].tf) tfChanges.push(samples[i].t);
  }
  const gaps = (ts: number[]) => {
    if (ts.length < 3) return "too few";
    const g = ts.slice(1).map((t, i) => Math.round(t - ts[i])).sort((a, b) => a - b);
    return `n=${ts.length} median=${g[Math.floor(g.length / 2)]}ms p90=${g[Math.floor(g.length * 0.9)]}ms max=${g[g.length - 1]}ms`;
  };
  console.log("pointermoves:", await page.evaluate(() => (window as any).__moves), "store.mutate calls:", await page.evaluate(() => (window as any).__mutates), "onDrag calls:", await page.evaluate(() => (window as any).__drags ?? 0));
  console.log("written x sequence:", await page.evaluate(() => ((window as any).__writtenXs ?? []).join(",")));
  const renderedXs = samples
    .filter((s, i) => i > 0 && s.tf !== samples[i - 1].tf)
    .map((s) => Math.round(parseFloat((s.tf.match(/translate\(([-\d.]+)px/) ?? [])[1] ?? "0")));
  console.log("rendered x sequence:", renderedXs.join(","));
  console.log("DATA updates:  ", gaps(dataChanges));
  console.log("RENDER updates:", gaps(tfChanges));
  await browser.close();
}
void main();
