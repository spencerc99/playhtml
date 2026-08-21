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
