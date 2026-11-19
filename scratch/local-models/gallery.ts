// ABOUTME: Builds index.html in a make-benchmark output folder: one row per task, one column per model and condition.
// ABOUTME: bun scratch/local-models/gallery.ts <outDir>

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { TASKS } from "./make";

const outDir = process.argv[2];
const rows: any[] = JSON.parse(readFileSync(join(outDir, "results.json"), "utf8"));
const cols = [...new Set(rows.map((r) => `${r.target}/${r.condition}`))];
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
let html = `<!doctype html><meta charset="utf-8"><title>Local model make bench</title>
<style>body{font:13px system-ui;margin:16px}table{border-collapse:collapse}td,th{border:1px solid #ccc;padding:6px;vertical-align:top}iframe{width:320px;height:240px;border:1px solid #ddd;background:#fff}.bad{color:#b00}.meta{color:#555;font-size:11px}</style>
<h1>Local model make bench</h1><p>Each cell is that model's single-file page for the task. Opening a page connects to playhtml's live server.</p><table><tr><th>task</th>${cols.map((c) => `<th>${esc(c)}</th>`).join("")}</tr>`;
for (const task of TASKS) {
  html += `<tr><th>${task.id}</th>`;
  for (const c of cols) {
    const r = rows.find((x) => `${x.target}/${x.condition}` === c && x.task === task.id && x.run === 1);
    const rel = `${c}/${task.id}-1`;
    if (!r) html += `<td></td>`;
    else if (!r.hasHtml) html += `<td class="bad">no html<br><a href="${rel}.raw.txt">raw</a></td>`;
    else {
      const flags = [!r.loadsPlayhtml && "no playhtml", !r.callsInit && "no init", r.capElsWithoutId > 0 && `${r.capElsWithoutId} missing id`, r.fakeApis?.length && `fake: ${r.fakeApis.join(",")}`].filter(Boolean);
      html += `<td><iframe loading="lazy" src="${rel}.html"></iframe><div class="meta"><a href="${rel}.html" target="_blank">open</a> · <a href="${rel}.raw.txt">raw</a> · ${Math.round(r.ms / 1000)}s ${flags.length ? `<span class="bad">${esc(flags.join("; "))}</span>` : "checks ok"}</div></td>`;
    }
  }
  html += `</tr>`;
}
html += `</table>`;
writeFileSync(join(outDir, "index.html"), html);
console.log(`wrote ${join(outDir, "index.html")}`);
