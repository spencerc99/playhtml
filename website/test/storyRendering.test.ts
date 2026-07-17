// ABOUTME: Tests rendering persisted words in the one-word story.
// ABOUTME: Ensures untrusted shared text remains text instead of markup.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, test } from "vitest";

const storyHtml = readFileSync(
  resolve(process.cwd(), "website/story.html"),
  "utf8",
);

const storyScript = storyHtml.match(
  /<script>\s*(const explicitSlurRegexes[\s\S]*?input\.updateElement = \(\{ data \}\) => \{[\s\S]*?\n\s*\};)\s*<\/script>/,
)?.[1];

function runStoryScript() {
  if (!storyScript) {
    throw new Error("Could not find the one-word story script");
  }

  new Function(storyScript)();
}

describe("one-word story rendering", () => {
  test("renders hostile persisted words literally", () => {
    document.body.innerHTML = `
      <input id="colorPicker" type="color" />
      <input id="wordInput" />
      <button class="wordSubmit"></button>
      <span id="storyContent"></span>
      <span id="typingIndicators"></span>
      <span id="activeUsersCount"></span>
      <span id="lastUpdatedTime"></span>
    `;
    localStorage.clear();
    Object.assign(globalThis, {
      activeUsersCount: document.getElementById("activeUsersCount"),
      colorPicker: document.getElementById("colorPicker"),
      lastUpdatedTime: document.getElementById("lastUpdatedTime"),
    });
    runStoryScript();

    const storyContent = document.getElementById("storyContent");
    const input = document.getElementById("wordInput");
    const hostileWord = "<svg/onload=alert()>";

    input.updateElement({
      data: [
        { word: "together", color: "#112233", ts: 0 },
        { word: hostileWord, color: "#abcdef", ts: 1 },
      ],
    });

    const words = storyContent.querySelectorAll(".word");
    expect(words).toHaveLength(2);
    expect(words[0].textContent).toBe("together");
    expect(words[0].style.getPropertyValue("--word-color")).toBe(
      "17, 34, 51",
    );
    expect(words[1].textContent).toBe(hostileWord);
    expect(words[1].style.getPropertyValue("--word-color")).toBe(
      "171, 205, 239",
    );
    expect(storyContent.querySelector("svg, img, [onload], [onerror]")).toBeNull();
  });
});
