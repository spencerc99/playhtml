export const meta = {
  name: 'bottle-review',
  description: 'Review the social-bottles PR diff across dimensions, adversarially verify each finding',
  phases: [
    { title: 'Review', detail: 'one finder per dimension over the PR diff' },
    { title: 'Verify', detail: 'independent skeptic per finding' },
    { title: 'Synthesize', detail: 'ranked report of confirmed issues' },
  ],
}

const DIFF_CMD = 'git diff origin/main...HEAD'
const FILES_HINT = `The change adds a "social experiments" scaffold + a "message bottles" feature to a browser extension (we were online / playhtml). Key files:
- extension/src/features/social/{types,registry,bottles}.ts  (scaffold + registry adapter)
- extension/src/features/global.ts  (iterates registry, gates on FLAGS + internalDevFeaturesEnabled dev override)
- extension/src/features/BottleManager.ts  (playhtml pageData channel, spawn logic, localStorage cooldowns/rate-limit)
- extension/src/features/bottle-anchor.ts  (document-anchored placement: grid-scan empty space, selector+offset anchors)
- extension/src/components/{MessageBottle.tsx,BottleOverlay.tsx}  (shadow-DOM rendered bottle + dialog)
- extension/src/components/sealing/{SealingCeremony.tsx,common.ts}  (Three.js drag-to-seal ceremony)
- extension/src/entrypoints/content.ts (+ inject-ui.ts)  (wires initGlobalFeatures; shadow mount helper)
Project rules (from extension/CLAUDE.md) that matter here:
- NEVER write shared playhtml data (channel.setData) from a callback that re-runs when that data changes — it loops forever and, because the data is a CRDT, concurrent writes append instead of overwrite so it never converges (crashed a production room: 1.2M ops / 23 MB). Write from explicit user events.
- Changing the SHAPE of already-persisted shared data needs migration or a new field name — defaultData only seeds brand-new channels.
- All extension UI injected into host pages MUST use Shadow DOM (style isolation).`

const FINDING_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    findings: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          title: { type: 'string' },
          file: { type: 'string' },
          location: { type: 'string', description: 'function / line / symbol' },
          severity: { type: 'string', enum: ['critical', 'high', 'medium', 'low'] },
          description: { type: 'string', description: 'what is wrong and why it matters' },
          evidence: { type: 'string', description: 'the specific code that demonstrates it' },
          suggestion: { type: 'string' },
        },
        required: ['title', 'file', 'location', 'severity', 'description', 'evidence', 'suggestion'],
      },
    },
  },
  required: ['findings'],
}

const VERDICT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    verdict: { type: 'string', enum: ['CONFIRMED', 'PLAUSIBLE', 'REFUTED'] },
    reasoning: { type: 'string' },
    correctedSeverity: { type: 'string', enum: ['critical', 'high', 'medium', 'low'] },
  },
  required: ['verdict', 'reasoning', 'correctedSeverity'],
}

const DIMENSIONS = [
  {
    key: 'playhtml-data-loops',
    prompt: `Read \`${DIFF_CMD}\` and the touched files. ${FILES_HINT}

Focus ONLY on the playhtml shared-data rules. Hunt for:
- Any channel.setData() / shared-data write invoked from a callback that re-runs when that same data changes (onUpdate handlers, useEffects depending on the data, render loops). This is the self-triggering write loop that crashed production.
- Shared-data writes that aren't gated behind an explicit user event.
- Any change to the persisted bottle-data SHAPE without migration / new-field-name handling (defaultData only seeds new channels).
- Non-idempotent or append-on-concurrent-write CRDT mutations.
Report concrete findings only — file, location, the exact offending code, why it loops/diverges.`,
  },
  {
    key: 'lifecycle-memory',
    prompt: `Read \`${DIFF_CMD}\` and the touched files. ${FILES_HINT}

Focus on resource lifecycle + memory leaks in the content-script context (long-lived pages, SPA navigations):
- Event listeners (window/document/pointer/scroll/resize/MutationObserver), requestAnimationFrame loops, setInterval/setTimeout, Three.js renderers/geometries/materials/textures — are they all disposed/removed on cleanup?
- The SocialExperiment init→cleanup contract: does each experiment's returned cleanup actually tear everything down? Does global.ts call it?
- Shadow-DOM hosts and React roots: unmounted + removed on destroy?
- The sealing ceremony (Three.js): WebGL context, geometry.dispose, material.dispose, texture.dispose, cancelAnimationFrame, listener removal — any leak across repeated open/close?
Report concrete leaks with the missing disposal.`,
  },
  {
    key: 'correctness-bugs',
    prompt: `Read \`${DIFF_CMD}\` and the touched files. ${FILES_HINT}

Focus on logic/correctness bugs:
- bottle-anchor: selector generation/resolution, off-by-one, positions that won't survive reload/scroll, grid-scan edge cases, null/empty DOM.
- BottleManager: spawn probability, cooldown / rate-limit logic, localStorage parse/quota failures, channel key collisions, race conditions.
- The dev-override gating in global.ts (FLAGS[flag] || devEnabled) — correct? Any async ordering bug?
- BottleOverlay scroll/resize re-resolution; React state/effect bugs.
- SealingCeremony geometry/animation math that could NaN or mis-render.
Report concrete bugs with repro reasoning.`,
  },
  {
    key: 'security-isolation',
    prompt: `Read \`${DIFF_CMD}\` and the touched files. ${FILES_HINT}

Focus on security + host-page isolation:
- Untrusted message text: is it ever rendered as HTML / innerHTML (XSS) vs textContent? Drawn to canvas/texture safely?
- Shadow-DOM isolation: any UI injected into host pages WITHOUT shadow DOM (style/script bleed)? z-index/pointer-events leaking into or capturing host-page events?
- Author pid (ECDSA key): ever exposed in the DOM/UI when it shouldn't be?
- Reading host-page DOM for anchoring — any way a malicious page poisons selectors or causes the extension to act on attacker-controlled content?
- Channel names derived from URL — any injection / cross-page-data-bleed?
Report concrete issues with severity.`,
  },
  {
    key: 'scaffold-quality',
    prompt: `Read \`${DIFF_CMD}\` and the touched files. ${FILES_HINT}

Focus on the social-experiment scaffold's design quality + the project conventions (the platform that quarantine-tape + ambient-copresence will build on):
- Is the SocialExperiment interface clean and sufficient? Will a second experiment plug in without touching shared files beyond the registry line?
- types.ts uses \`import("../../flags").FLAGS\` in a type position — is that sound? Any circular-import or build risk?
- flags default OFF + dev override: is the inert-for-users guarantee actually airtight, or are there code paths that run regardless of the flag?
- Naming/comment conventions (the repo requires 2-line // ABOUTME: headers; no temporal/historical names). Any violations in the new files?
- Error handling: does one experiment throwing take down the others?
Report concrete issues + any design smell that will bite the parallel features.`,
  },
]

phase('Review')
const reviewed = await pipeline(
  DIMENSIONS,
  (d) => agent(d.prompt, {
    label: `review:${d.key}`,
    phase: 'Review',
    sandbox: 'read-only',
    effort: 'high',
    schema: FINDING_SCHEMA,
  }),
  (review, d) => parallel((review?.findings ?? []).map((f) => () =>
    agent(`Adversarially verify this code-review finding. Read the actual code at ${f.file} (${f.location}) via \`${DIFF_CMD}\` and the file itself. Try to REFUTE it — is it a real issue or a false positive? Default to PLAUSIBLE if you can't fully confirm, REFUTED only if you're confident it's wrong. Correct the severity if the finder over/under-rated it.

Finding: ${f.title}
Severity claimed: ${f.severity}
Description: ${f.description}
Evidence: ${f.evidence}
Suggestion: ${f.suggestion}`, {
      label: `verify:${d.key}:${f.file.split('/').pop()}`,
      phase: 'Verify',
      sandbox: 'read-only',
      effort: 'high',
      schema: VERDICT_SCHEMA,
    }).then((v) => ({ ...f, dimension: d.key, verdict: v })))),
)

const all = reviewed.flat().filter(Boolean)
const survivors = all.filter((f) => f.verdict && f.verdict.verdict !== 'REFUTED')
log(`${all.length} findings, ${survivors.length} survived verification (${all.length - survivors.length} refuted)`)

phase('Synthesize')
const report = await agent(`You are writing the final code-review report for the "social-bottles" PR (message-bottle feature + social-experiment scaffold for a browser extension).

Here are the verified findings (REFUTED ones already removed). Each has a verifier verdict (CONFIRMED / PLAUSIBLE) and a corrected severity.

${JSON.stringify(survivors.map((f) => ({
  title: f.title,
  file: f.file,
  location: f.location,
  dimension: f.dimension,
  severity: f.verdict?.correctedSeverity ?? f.severity,
  verdict: f.verdict?.verdict,
  description: f.description,
  evidence: f.evidence,
  suggestion: f.suggestion,
  verifierReasoning: f.verdict?.reasoning,
})), null, 2)}

Write a concise, prioritized markdown report:
1. **Summary** — one paragraph: overall health, is this safe to merge (it ships flag-OFF / dev-only), biggest risks.
2. **Must-fix before enabling for users** — CONFIRMED critical/high issues, especially anything touching the playhtml data-loop rule or host-page security. For each: file:location, what's wrong, the fix.
3. **Should-fix** — medium issues + CONFIRMED lows worth doing.
4. **Notes / nits** — PLAUSIBLE items and minor polish.
5. **Scaffold verdict** — is the social-experiment platform sound for the parallel tape + co-presence features to build on?
Group by theme, not by dimension. Be specific and cite file:location. Don't pad.`, {
  label: 'synthesize',
  phase: 'Synthesize',
  sandbox: 'read-only',
  effort: 'high',
})

return report
