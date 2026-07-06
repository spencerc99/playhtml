// ABOUTME: The corner shop — single-owner permissions demo: the shopkeeper's key
// ABOUTME: (an `admin` pk in the well-known file) gates the sign + marquee; the bell is open.
import { playhtml } from "../packages/playhtml/src";

const $ = (id: string) => document.getElementById(id)!;

// --- marquee: admin-gated free text ---------------------------------------
interface MarqueeData {
  text: string;
}
const marqueeEl = $("shop-marquee");
(marqueeEl as any).defaultData = {
  text: "back in five minutes (five minutes may be years)",
} satisfies MarqueeData;
(marqueeEl as any).updateElement = ({ data }: { data: MarqueeData }) => {
  marqueeEl.textContent = `“${data.text}”`;
};
let setMarquee: ((d: MarqueeData) => void) | null = null;
(marqueeEl as any).onMount = ({ setData }: { setData: (d: MarqueeData) => void }) => {
  setMarquee = setData;
};

// --- doorbell: ungated counter, to contrast with the gated sign -----------
interface BellData {
  rings: number;
}
const bellCountEl = $("bell-count");
(bellCountEl as any).defaultData = { rings: 0 } satisfies BellData;
(bellCountEl as any).updateElement = ({ data }: { data: BellData }) => {
  bellCountEl.textContent = `rung ${data.rings} time(s) by passers-by`;
};
let bellApi: { getData: () => BellData; setData: (d: BellData) => void } | null =
  null;
(bellCountEl as any).onMount = (api: typeof bellApi) => {
  bellApi = api;
};
$("doorbell").addEventListener("click", () => {
  if (!bellApi) return;
  bellApi.setData({ rings: bellApi.getData().rings + 1 });
});

// --- shopkeeper panel -------------------------------------------------------
function renderKeeper(): void {
  const me = playhtml.me;
  const keeper = playhtml.can("write", "#shop-sign");
  $("keeper-status").textContent = keeper
    ? "🗝️ you hold the shopkeeper's key. the sign and marquee obey you."
    : playhtml.permissionsEnforced
      ? "🔒 the shop has a keeper, and it isn't you. the sign won't budge."
      : "🔒 no key checked (client-only mode) — the sign is locked for everyone.";
  ($("keeper-controls") as HTMLElement).hidden = !keeper;
  ($("claim-help") as HTMLElement).hidden = keeper;
  $("claim-pid").textContent = me.pid ?? "(identity still loading)";
}

$("marquee-save").addEventListener("click", () => {
  const text = ($("marquee-input") as HTMLInputElement).value.trim();
  if (!text || !setMarquee) return;
  setMarquee({ text });
});

document.addEventListener("permissiondenied", (e) => {
  const detail = (e as CustomEvent).detail;
  const el = document.getElementById(detail.elementId);
  el?.classList.add("denied");
  setTimeout(() => el?.classList.remove("denied"), 400);
  $("keeper-status").textContent = `⛔ ${detail.elementId}: not your shop (${detail.reason})`;
  setTimeout(renderKeeper, 2500);
});

playhtml.onIdentityChange(renderKeeper);

// The shop-sign can-toggle + shop-marquee rules also live in
// /.well-known/playhtml.json so the server enforces them; the `permissions`
// attributes on the elements handle the client-side (UX) half.
void playhtml.init({ cursors: { enabled: true } });
playhtml.ready.then(renderKeeper);
renderKeeper();
