// ABOUTME: Tests rendering persisted words in the one-word story.
// ABOUTME: Ensures untrusted shared text remains text instead of markup.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, test } from "vitest";

const storyHtml = readFileSync(
  resolve(process.cwd(), "website/story.html"),
  "utf8",
);

const colorHelperSource = storyHtml.match(
  /(function convertHexToRGB\(hex\) \{[\s\S]*?)(?=\n\s*if \(getUserColor)/,
)?.[1];
const updateElementSource = storyHtml.match(
  /updateElement:\s*(\(\{ data \}\) => \{[\s\S]*?\n\s*\}),\n\s*\}\);/,
)?.[1];

function getUpdateElement() {
  if (!colorHelperSource || !updateElementSource) {
    throw new Error("Could not find the one-word story renderer");
  }

  return new Function(
    "storyContent",
    "lastUpdatedTime",
    `${colorHelperSource}
return ${updateElementSource};`,
  )(
    document.getElementById("storyContent"),
    document.getElementById("lastUpdatedTime"),
  );
}

describe("one-word story rendering", () => {
  test("renders hostile persisted words literally", () => {
    document.body.innerHTML = `
      <span id="storyContent"></span>
      <span id="lastUpdatedTime"></span>
    `;

    const storyContent = document.getElementById("storyContent");
    const hostileWord = "<svg/onload=alert()>";

    getUpdateElement()({
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

const randomColorSource = storyHtml.match(
  /function randomColor\(\) \{[\s\S]*?\n\s*\}/,
)?.[0];
const wordCheckSource = storyHtml.match(
  /(const explicitSlurRegexes = \[[\s\S]*?const hasExplicitSlur = [\s\S]*?\n\s*\};)/,
)?.[1];
const isValidWordSource = storyHtml.match(
  /function isValidWord\(word\) \{[\s\S]*?\n\s*\}/,
)?.[0];
const onSubmitSource = storyHtml.match(
  /const onSubmit = (\(\) => \{[\s\S]*?\n\s*\});\n\s*submitBtn\.addEventListener/,
)?.[1];

function getRandomColor(random: () => number) {
  if (!randomColorSource) {
    throw new Error("Could not find the one-word story color picker");
  }
  return new Function(
    "Math",
    `${randomColorSource}
return randomColor;`,
  )({ floor: Math.floor, random });
}

// Submits one word through the story's real submit handler and returns the
// story list it saved, plus any alert the visitor saw.
function submitWord(value: string) {
  if (!wordCheckSource || !isValidWordSource || !onSubmitSource) {
    throw new Error("Could not find the one-word story submit handler");
  }
  let story: Array<{ word: string; color: string; ts: number }> = [];
  const alerts: string[] = [];
  const input = { value };
  const onSubmit = new Function(
    "input",
    "submitBtn",
    "getData",
    "setData",
    "setMyAwareness",
    "getUserColor",
    "alert",
    `${wordCheckSource}
${isValidWordSource}
return ${onSubmitSource};`,
  )(
    input,
    { disabled: false },
    () => story,
    (next: typeof story) => {
      story = next;
    },
    () => {},
    () => "#112233",
    (message: string) => alerts.push(message),
  );
  onSubmit();
  return { story, alerts };
}

describe("one-word story submissions", () => {
  test("random colors are six-digit hex even when the number is small", () => {
    expect(getRandomColor(() => 0.0001)()).toBe("#00068d");
    expect(getRandomColor(() => 0)()).toBe("#000000");
    expect(getRandomColor(() => 0.5)()).toMatch(/^#[0-9a-f]{6}$/);
  });

  test("saves a word typed with surrounding spaces, trimmed", () => {
    const { story, alerts } = submitWord("  hello ");
    expect(alerts).toEqual([]);
    expect(story.map((entry) => entry.word)).toEqual(["hello"]);
  });

  test("rejects blank and multi-word input", () => {
    expect(submitWord("   ")).toEqual({
      story: [],
      alerts: ["please enter a single word!"],
    });
    expect(submitWord("two words")).toEqual({
      story: [],
      alerts: ["please enter a single word!"],
    });
  });
});
