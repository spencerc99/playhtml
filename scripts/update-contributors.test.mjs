// ABOUTME: Tests the README contributors generator's bot filter, grouping, and rendering.
// ABOUTME: Uses fake git log records and a stub login resolver, so it never hits the network.

import assert from "node:assert/strict";
import test from "node:test";
import {
  collectContributors,
  isBot,
  loginFromNoreply,
  parseGitLog,
  renderGrid,
  replaceBlock,
} from "./update-contributors.mjs";

const F = "\x1f";
const R = "\x1e";

test("filters bots and coding agents but keeps people", () => {
  for (const bot of [
    { name: "Claude", email: "noreply@anthropic.com" },
    { name: "Claude Opus 5.5", email: "noreply@anthropic.com" },
    { name: "claude[bot]", email: "209825114+claude[bot]@users.noreply.github.com" },
    { name: "Cursor Agent", email: "cursoragent@cursor.com" },
    { name: "Copilot", email: "175728472+Copilot@users.noreply.github.com" },
    { name: "github-actions[bot]", email: "41898282+github-actions[bot]@users.noreply.github.com" },
    { login: "dependabot[bot]" },
  ]) {
    assert.equal(isBot(bot), true, JSON.stringify(bot));
  }
  for (const person of [
    { name: "Spencer Chang", email: "spencerc99@gmail.com" },
    { name: "Claude Monet", email: "claude@monet.fr" },
    { name: "Jessa", email: "git@jessa0.com" },
  ]) {
    assert.equal(isBot(person), false, JSON.stringify(person));
  }
});

test("reads logins from GitHub noreply emails", () => {
  assert.equal(loginFromNoreply("14796580+spencerc99@users.noreply.github.com"), "spencerc99");
  assert.equal(loginFromNoreply("spencerc99@users.noreply.github.com"), "spencerc99");
  assert.equal(loginFromNoreply("a@b.com"), null);
});

test("groups authors and co-authors by login and orders by commits", async () => {
  const raw = [
    `a1${F}Spencer Chang${F}spencerc99@gmail.com${F}Claude <noreply@anthropic.com>\n${R}`,
    `\na2${F}Spencer Chang${F}14796580+spencerc99@users.noreply.github.com${F}${R}`,
    `\na3${F}Spencer Chang${F}spencerc99@gmail.com${F}Jessa <git@jessa0.com>\n${R}`,
    `\na4${F}Alex${F}alex@example.com${F}${R}`,
    `\na5${F}Nobody${F}nobody@example.com${F}${R}`,
    `\na6${F}github-actions[bot]${F}41898282+github-actions[bot]@users.noreply.github.com${F}${R}\n`,
  ].join("");
  const logins = { "alex@example.com": "alex" };
  const { contributors, unresolved } = await collectContributors(parseGitLog(raw), async (p) => {
    const email = p.email.toLowerCase();
    return logins[email] ?? (email === "spencerc99@gmail.com" ? "spencerc99" : email === "git@jessa0.com" ? "jessa0" : loginFromNoreply(email));
  });
  assert.deepEqual(
    contributors.map(({ login, name, commits }) => ({ login, name, commits })),
    [
      { login: "spencerc99", name: "Spencer Chang", commits: 3 },
      { login: "jessa0", name: "Jessa", commits: 1 },
      { login: "alex", name: "Alex", commits: 1 },
    ],
  );
  assert.deepEqual(unresolved, ["Nobody <nobody@example.com>"]);
});

test("renders a linked avatar grid between the markers", () => {
  const block = renderGrid([{ login: "a", name: "A <b>" }]);
  assert.match(block, /<a href="https:\/\/github.com\/a"><img src="https:\/\/github.com\/a.png\?size=128"/);
  assert.match(block, /A &lt;b&gt;/);
  const readme = "top\n<!-- contributors:start -->\nold\n<!-- contributors:end -->\nbottom\n";
  const next = replaceBlock(readme, block);
  assert.ok(next.startsWith("top\n<!-- contributors:start -->"));
  assert.ok(next.endsWith("<!-- contributors:end -->\nbottom\n"));
  assert.equal(replaceBlock(next, block), next);
  assert.throws(() => replaceBlock("no markers", block), /markers/);
});
