// ABOUTME: Non-shared homepage behaviors: label-maker letters, code peeks, the mirror demo,
// ABOUTME: and live GitHub and Discord counts that quietly stay hidden if a fetch fails.

import { formatSimpleNumber } from "../../../packages/react/examples/utils";

const PeekHideDelayMs = 3500;

// Splits a label's text into letters with a small, stable jitter so it reads
// like embossed label-maker tape.
export function setLabelText(label: HTMLElement, text: string) {
  label.setAttribute("aria-label", text);
  label.replaceChildren(
    ...Array.from(text).map((character, index) => {
      const letter = document.createElement("span");
      letter.setAttribute("aria-hidden", "true");
      if (character === " ") {
        letter.className = "ph-label__space";
        return letter;
      }
      const wobble = ((index * 37) % 7) - 3;
      letter.style.transform = `translateY(${wobble * 0.25}px) rotate(${wobble * 0.6}deg)`;
      letter.textContent = character;
      return letter;
    }),
  );
}

export function setupLabels() {
  document.querySelectorAll<HTMLElement>(".ph-label").forEach((label) => {
    setLabelText(label, label.textContent?.trim() ?? "");
  });
}

// A toy people can drag (data-peek-anchor) gets its peek under wherever the
// dragged element sits now, not where the toy started.
function placeNearAnchor(toy: HTMLElement, peek: HTMLElement) {
  const selector = toy.dataset.peekAnchor;
  const anchor = selector ? toy.querySelector<HTMLElement>(selector) : null;
  if (!anchor) return;
  const toyBox = toy.getBoundingClientRect();
  const anchorBox = anchor.getBoundingClientRect();
  peek.style.left = `${anchorBox.left - toyBox.left}px`;
  peek.style.top = `${anchorBox.bottom - toyBox.top + 10}px`;
}

// Shows the code behind a toy on hover, or briefly after a tap on touch screens.
export function setupCodePeeks() {
  document.querySelectorAll<HTMLElement>("[data-peek]").forEach((toy) => {
    const template = document.getElementById(
      `peek-${toy.dataset.peek}`,
    ) as HTMLTemplateElement | null;
    if (!template) return;

    let peek: HTMLElement | null = null;
    let hideTimer: number | undefined;

    const show = () => {
      window.clearTimeout(hideTimer);
      if (peek) return;
      peek = document.createElement("div");
      peek.className = "ph-peek";
      peek.setAttribute("role", "tooltip");
      const head = document.createElement("div");
      head.className = "ph-code__head";
      head.textContent = template.dataset.file ?? "";
      const code = template.content.querySelector("pre");
      peek.append(head);
      if (code) peek.append(code.cloneNode(true));
      toy.append(peek);
      placeNearAnchor(toy, peek);
    };
    const hide = () => {
      window.clearTimeout(hideTimer);
      peek?.remove();
      peek = null;
    };

    toy.addEventListener("pointerenter", (event) => {
      if (event.pointerType === "mouse") show();
    });
    toy.addEventListener("pointerleave", (event) => {
      if (event.pointerType === "mouse") hide();
    });
    toy.addEventListener("pointerdown", (event) => {
      if (event.pointerType === "mouse") return;
      show();
      hideTimer = window.setTimeout(hide, PeekHideDelayMs);
    });
  });
}

// "Real-time changes" card: dragging the note in the left window moves its
// twin in the right window a beat later. Local only, it's an illustration.
export function setupMirrorDemo() {
  const source = document.querySelector<HTMLElement>("[data-mirror-source]");
  const note = document.querySelector<HTMLElement>("[data-mirror-note]");
  const target = document.querySelector<HTMLElement>("[data-mirror-target]");
  if (!source || !note || !target) return;

  let start: { x: number; y: number; dx: number; dy: number } | null = null;
  let offset = { x: 0, y: 0 };

  const apply = () => {
    const value = `${offset.x}px ${offset.y}px`;
    note.style.translate = value;
    target.style.translate = value;
  };

  note.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    note.setPointerCapture(event.pointerId);
    start = { x: event.clientX, y: event.clientY, dx: offset.x, dy: offset.y };
    note.style.cursor = "grabbing";
  });
  note.addEventListener("pointermove", (event) => {
    if (!start) return;
    const bounds = source.getBoundingClientRect();
    const home = {
      left: note.offsetLeft,
      top: note.offsetTop,
      width: note.offsetWidth,
      height: note.offsetHeight,
    };
    const minX = -home.left;
    const maxX = bounds.width - home.left - home.width;
    const minY = 18 - home.top;
    const maxY = bounds.height - home.top - home.height;
    offset = {
      x: Math.min(maxX, Math.max(minX, start.dx + event.clientX - start.x)),
      y: Math.min(maxY, Math.max(minY, start.dy + event.clientY - start.y)),
    };
    apply();
  });
  const end = () => {
    start = null;
    note.style.cursor = "";
  };
  note.addEventListener("pointerup", end);
  note.addEventListener("pointercancel", end);
}

async function fetchJson(url: string): Promise<unknown> {
  const response = await fetch(url, {
    headers: { Accept: "application/json" },
  });
  if (!response.ok) throw new Error(`${url} ${response.status}`);
  return response.json();
}

function readNumber(record: unknown, key: string): number | undefined {
  if (!record || typeof record !== "object") return undefined;
  const value = (record as Record<string, unknown>)[key];
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

export function loadLiveCounts() {
  fetchJson("https://api.github.com/repos/spencerc99/playhtml")
    .then((repo) => {
      const stars = readNumber(repo, "stargazers_count");
      const label = document.querySelector<HTMLElement>("[data-github-stars]");
      if (stars === undefined || !label) return;
      label.textContent = formatSimpleNumber(stars);
      label.closest("a")?.setAttribute("aria-label", `GitHub, ${stars} stars`);
      label.hidden = false;
    })
    .catch(() => {});

  fetchJson(
    "https://api.github.com/search/issues?q=" +
      encodeURIComponent(
        'repo:spencerc99/playhtml is:issue is:open label:"good first issue"',
      ),
  )
    .then((result) => {
      const total = readNumber(result, "total_count");
      const label = document.querySelector<HTMLElement>(
        "[data-good-first-issues]",
      );
      if (!total || !label) return;
      label.textContent = `${total} good first ${total === 1 ? "issue" : "issues"}`;
    })
    .catch(() => {});

  fetchJson("https://discord.com/api/v9/invites/SKbsSf4ptU?with_counts=true")
    .then((invite) => {
      const online = readNumber(invite, "approximate_presence_count");
      const members = readNumber(invite, "approximate_member_count");
      const counts = document.querySelector<HTMLElement>(
        "[data-discord-counts]",
      );
      if (online === undefined || members === undefined || !counts) return;
      counts.querySelector("[data-discord-online]")!.textContent =
        online.toLocaleString();
      counts.querySelector("[data-discord-members]")!.textContent =
        members.toLocaleString();
      counts.hidden = false;
    })
    .catch(() => {});
}

// Support card: monthly sponsorship against the goal. The amounts live in
// the markup's data attributes so they're easy to update by hand.
export function setupSponsorGoal() {
  const goal = document.querySelector<HTMLElement>("[data-sponsor-goal]");
  if (!goal) return;
  const label = goal.querySelector<HTMLElement>(".ph-goal__label");
  const bar = goal.querySelector<HTMLElement>(".ph-goal__bar");
  const target = Number(goal.dataset.goal);
  const current = goal.dataset.current ? Number(goal.dataset.current) : NaN;
  if (!label || !Number.isFinite(target) || target <= 0) return;

  const dollars = (amount: number) => "$" + Math.round(amount).toLocaleString();
  if (!Number.isFinite(current)) {
    label.textContent = `goal: ${dollars(target)} a month`;
    return;
  }

  const percent = Math.min(100, Math.max(0, (current / target) * 100));
  label.textContent = `${dollars(current)} of ${dollars(target)} a month`;
  if (bar) {
    bar.hidden = false;
    bar.setAttribute("role", "img");
    bar.setAttribute(
      "aria-label",
      `${Math.round(percent)}% of the monthly goal`,
    );
    bar.querySelector<HTMLElement>("span")!.style.width = `${percent}%`;
  }
}
