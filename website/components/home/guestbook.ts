// ABOUTME: The homepage guestbook: a can-post form whose entries show as name chips.
// ABOUTME: Keeps the original {name, message, timestamp}[] data so every past signature shows.

import words from "profane-words";
import type { ElementInitializer } from "playhtml";
import {
  isGuestbookNameAllowed,
  sanitizeGuestbookName,
} from "../../utils/guestbookValidation";

export interface GuestbookEntry {
  name: string;
  message: string;
  timestamp: number;
}

const GuestbookSubmissionLimit = {
  maxEntries: 3,
  windowMs: 10 * 60 * 1000,
  storageKey: "playhtml:guestbook-submission-timestamps",
};
const GuestbookNameStorageKey = "name";
const ChipColors = ["#c0373c", "#274b9e", "#b0306a", "#5c7c54", "#a8701c"];

function getEntryId(entry: GuestbookEntry) {
  return `${entry.name}-${entry.timestamp}`;
}

function getChipColor(name: string) {
  let hash = 0;
  for (let index = 0; index < name.length; index += 1) {
    hash = (hash * 31 + name.charCodeAt(index)) % 9973;
  }
  return ChipColors[hash % ChipColors.length];
}

export function formatTimeAgo(timestamp: number, now = Date.now()) {
  const seconds = Math.max(0, Math.round((now - timestamp) / 1000));
  if (seconds < 60) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hr ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days} ${days === 1 ? "day" : "days"} ago`;
  const months = Math.round(days / 30);
  if (months < 12) return `${months} ${months === 1 ? "month" : "months"} ago`;
  const years = Math.round(days / 365);
  return `${years} ${years === 1 ? "year" : "years"} ago`;
}

function readStoredGuestbookName(): string {
  const storedName = window.localStorage.getItem(GuestbookNameStorageKey);
  if (!storedName) return "";

  try {
    const parsedName = JSON.parse(storedName);
    return typeof parsedName === "string" ? parsedName : "";
  } catch {
    return "";
  }
}

function writeStoredGuestbookName(name: string) {
  window.localStorage.setItem(GuestbookNameStorageKey, JSON.stringify(name));
}

export function setupGuestbookNameInput() {
  const nameInput = document.querySelector<HTMLInputElement>(
    '#guestbookForm input[name="name"]',
  );
  if (!nameInput) return;

  nameInput.value = sanitizeGuestbookName(readStoredGuestbookName());
  writeStoredGuestbookName(nameInput.value);

  const syncNameInput = () => {
    const sanitizedName = sanitizeGuestbookName(nameInput.value);
    if (nameInput.value !== sanitizedName) {
      nameInput.value = sanitizedName;
    }

    writeStoredGuestbookName(sanitizedName);
  };

  nameInput.addEventListener("input", syncNameInput);
  nameInput.addEventListener("change", syncNameInput);
}

function createChip(entry: GuestbookEntry) {
  const chip = document.createElement("div");
  chip.className = "ph-chip";
  chip.setAttribute("role", "listitem");
  chip.style.setProperty("--chip-color", getChipColor(entry.name));
  chip.title = new Date(entry.timestamp).toLocaleString();

  const name = document.createElement("b");
  name.textContent = entry.name;
  const message = document.createElement("span");
  message.textContent = entry.message;
  chip.append(name, message);
  return chip;
}

function renderGuestbookSummary(entries: GuestbookEntry[]) {
  const validEntries = entries.filter((entry) =>
    Number.isFinite(entry?.timestamp),
  );
  const count = document.querySelector<HTMLElement>("[data-guestbook-count]");
  if (count && validEntries.length > 0) {
    const firstYear = new Date(
      Math.min(...validEntries.map((entry) => entry.timestamp)),
    ).getFullYear();
    count.textContent = `${validEntries.length.toLocaleString()} signatures since ${firstYear} · newest first`;
  }

  const newest = validEntries.reduce<GuestbookEntry | undefined>(
    (latest, entry) =>
      !latest || entry.timestamp > latest.timestamp ? entry : latest,
    undefined,
  );
  const note = document.querySelector<HTMLElement>("[data-newest-note]");
  if (!note || !newest) return;

  const chip = note.querySelector<HTMLElement>("[data-newest-chip]");
  chip?.style.setProperty("--chip-color", getChipColor(newest.name));
  note.querySelector("[data-newest-name]")!.textContent = newest.name;
  note.querySelector("[data-newest-message]")!.textContent = newest.message;
  note.querySelector("[data-newest-caption]")!.textContent =
    `newest in the guestbook · ${formatTimeAgo(newest.timestamp)}`;
  note.hidden = false;
}

function isBlockedWord(text: string) {
  return words.some((word) => new RegExp(`\\b${word}\\b`, "gi").test(text));
}

function readSubmissionTimestamps(): number[] {
  try {
    const storedTimestamps = window.localStorage.getItem(
      GuestbookSubmissionLimit.storageKey,
    );
    if (!storedTimestamps) return [];
    const parsedTimestamps = JSON.parse(storedTimestamps);
    return Array.isArray(parsedTimestamps)
      ? parsedTimestamps.filter(
          (timestamp): timestamp is number =>
            typeof timestamp === "number" && Number.isFinite(timestamp),
        )
      : [];
  } catch {
    return [];
  }
}

export const guestbookCapability = {
  defaultData: [],
  defaultLocalData: { addedEntries: new Set<string>() },
  update: ({ data: entries, localData: { addedEntries }, setLocalData }) => {
    const list = document.getElementById("guestbookMessages");
    if (!list) return;

    // Entries are stored oldest first, so prepending keeps newest on top.
    for (const entry of entries) {
      const entryId = getEntryId(entry);
      if (addedEntries.has(entryId)) continue;
      list.prepend(createChip(entry));
      addedEntries.add(entryId);
    }

    setLocalData({ addedEntries });
    renderGuestbookSummary(entries);
  },
  onMount: ({ getElement, setData }) => {
    const element = getElement();
    let submissionTimestamps = readSubmissionTimestamps();

    element.addEventListener("submit", (event: SubmitEvent) => {
      event.preventDefault();
      event.stopImmediatePropagation();

      const form = event.target as HTMLFormElement;
      const messageInput = form.querySelector<HTMLInputElement>(
        'input[name="message"]',
      );
      const nameInput =
        form.querySelector<HTMLInputElement>('input[name="name"]');
      const clearMessage = () => {
        if (messageInput) messageInput.value = "";
      };
      const formData = Object.fromEntries(new FormData(form).entries());
      const name = String(formData.name ?? "");
      const message = String(formData.message ?? "");

      if (!name || !message) {
        clearMessage();
        return;
      }

      if (!isGuestbookNameAllowed(name)) {
        const sanitizedName = sanitizeGuestbookName(name);
        if (nameInput) nameInput.value = sanitizedName;
        writeStoredGuestbookName(sanitizedName);
        alert("please use letters and numbers only for your name");
        return;
      }

      if (isBlockedWord(message) || isBlockedWord(name)) {
        alert("now why would you try to do something like that?");
        clearMessage();
        return;
      }

      const timestamp = Date.now();
      const earliestAllowedSubmission =
        timestamp - GuestbookSubmissionLimit.windowMs;
      submissionTimestamps = submissionTimestamps.filter(
        (submittedAt) =>
          submittedAt > earliestAllowedSubmission && submittedAt <= timestamp,
      );

      if (submissionTimestamps.length >= GuestbookSubmissionLimit.maxEntries) {
        alert("please wait a bit before adding more guestbook notes");
        return;
      }

      const newEntry: GuestbookEntry = { name, message, timestamp };
      setData((draft: GuestbookEntry[]) => {
        draft.push(newEntry);
      });
      submissionTimestamps = [...submissionTimestamps, timestamp];
      try {
        window.localStorage.setItem(
          GuestbookSubmissionLimit.storageKey,
          JSON.stringify(submissionTimestamps),
        );
      } catch {
        // Ignore local storage failures so valid guestbook posts still work.
      }
      clearMessage();
    });
  },
} as ElementInitializer<GuestbookEntry[]>;
