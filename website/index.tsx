// ABOUTME: Boots the playhtml homepage and its React-backed shared examples.
// ABOUTME: Wires homepage-only collaboration state into non-React page chrome.

import { ElementInitializer } from "@playhtml/common";
import words from "profane-words";
import "./home.scss";
// NOTE: this pins it to the working code so we can test library changes through this home page.
import { createRoot } from "react-dom/client";
import { PlayProvider } from "@playhtml/react";
import FeaturesGrid from "./components/FeaturesGrid";
import ExperimentsArchive from "./components/ExperimentsArchive";
import {
  isGuestbookNameAllowed,
  sanitizeGuestbookName,
} from "./utils/guestbookValidation";

interface FormData {
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
type HomepageAwareness = { online: true };
type HomepageAwarenessElement = HTMLElement &
  Partial<
    ElementInitializer<Record<string, never>, undefined, HomepageAwareness>
  >;

function getFormDataId(formData: FormData) {
  return `${formData.name}-${formData.timestamp}`;
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

function setupGuestbookNameInput() {
  const nameInput = document.querySelector<HTMLInputElement>(
    'input[name="name"]',
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

setupGuestbookNameInput();

function setupHomepageAwarenessStatus() {
  const statusElement = document.getElementById(
    "site-console-count",
  ) as HomepageAwarenessElement | null;
  const countElement = document.getElementById("site-console-count-number");
  const countLabel = document.querySelector(".site-console__status-label");
  if (!statusElement || !countElement || !countLabel) return;

  statusElement.defaultData = {};
  statusElement.myDefaultAwareness = { online: true };
  statusElement.updateElement = () => {};
  statusElement.updateElementAwareness = ({ awareness }) => {
    const peopleCount = Math.max(awareness.length, 1);

    if (countElement.textContent === String(peopleCount)) return;

    countElement.textContent = String(peopleCount);
    countLabel.textContent = ` ${peopleCount === 1 ? "person" : "people"} here`;
  };
}

const isCursorRoom = (
  value: string | null,
): value is "page" | "domain" | "section" =>
  value === "page" || value === "domain" || value === "section";

function getLocalPreviewInitOptions() {
  const localHostnames = new Set(["localhost", "127.0.0.1"]);
  if (!localHostnames.has(window.location.hostname)) return {};

  const params = new URLSearchParams(window.location.search);
  const host = params.get("playhtmlHost");
  const room = params.get("playhtmlRoom");
  const cursorRoom = params.get("playhtmlCursorRoom");

  return {
    ...(host ? { host } : {}),
    ...(room ? { room } : {}),
    ...(isCursorRoom(cursorRoom) ? { cursorRoom } : {}),
  };
}

setupHomepageAwarenessStatus();

// Render React components
const reactContentElement = document.getElementById("reactContent");
if (reactContentElement) {
  const { cursorRoom, ...localPreviewOptions } = getLocalPreviewInitOptions();
  const root = createRoot(reactContentElement);
  root.render(
    <PlayProvider
      initOptions={{
        ...localPreviewOptions,
        cursors: {
          enableChat: true,
          enabled: true,
          ...(cursorRoom ? { room: cursorRoom } : {}),
        },
        // an event when someone opens the website?
        extraCapabilities: {
          "can-post": {
            defaultData: [],
            defaultLocalData: { addedEntries: new Set() },
            updateElement: ({
              data: entries,
              localData: { addedEntries },
              setLocalData,
            }) => {
              const entriesToAdd = entries.filter(
                (entry) => !addedEntries.has(getFormDataId(entry))
              );

              const guestbookDiv =
                document.getElementById("guestbookMessages")!;
              entriesToAdd.forEach((entry) => {
                const newEntry = document.createElement("div");
                newEntry.classList.add("guestbook-entry");
                const entryDate = new Date(entry.timestamp);
                const time = entryDate.toTimeString().split(" ")[0];
                const isToday =
                  entryDate.toDateString() === new Date().toDateString();

                const dateString = (() => {
                  // TODO: this is naive and incorrect but works most of the time lol
                  const now = new Date();
                  if (
                    now.getFullYear() !== entryDate.getFullYear() ||
                    now.getMonth() !== entryDate.getMonth()
                  ) {
                    return "Sometime before";
                  } else if (isToday) {
                    return "Today";
                  } else if (now.getDate() - entryDate.getDate() === 1) {
                    return "Yesterday";
                  } else if (now.getDate() - entryDate.getDate() < 7) {
                    return "This week";
                  } else {
                    return "Sometime before";
                  }
                })();

                newEntry.innerHTML = `
        <span class="guestbook-entry-timestamp">${dateString} at ${time}</span><span class="guestbook-entry-name"></span> <span class="guestbook-entry-message"></span>`;
                // TODO: add option to change order?
                guestbookDiv.prepend(newEntry);
                if (newEntry.querySelector(".guestbook-entry-name")) {
                  // @ts-ignore
                  newEntry.querySelector(".guestbook-entry-name")!.textContent =
                    entry.name;
                }
                if (newEntry.querySelector(".guestbook-entry-message")) {
                  // @ts-ignore
                  newEntry.querySelector(
                    ".guestbook-entry-message"
                  )!.textContent = entry.message;
                }
                addedEntries.add(getFormDataId(entry));
              });

              setLocalData({ addedEntries });
            },
            onMount: ({ getElement, setData }) => {
              const element = getElement();
              let guestbookSubmissionTimestamps: number[] = [];

              try {
                const storedTimestamps = window.localStorage.getItem(
                  GuestbookSubmissionLimit.storageKey
                );
                if (storedTimestamps) {
                  const parsedTimestamps = JSON.parse(storedTimestamps);
                  if (Array.isArray(parsedTimestamps)) {
                    guestbookSubmissionTimestamps = parsedTimestamps.filter(
                      (timestamp): timestamp is number =>
                        typeof timestamp === "number" &&
                        Number.isFinite(timestamp)
                    );
                  }
                }
              } catch {
                guestbookSubmissionTimestamps = [];
              }

              element.addEventListener("submit", (e: SubmitEvent) => {
                e.preventDefault();
                e.stopImmediatePropagation();

                const formData = new FormData(e.target as HTMLFormElement);
                // massage formData into new object

                function clearMessage() {
                  const messageEle = element.querySelector(
                    'input[name="message"]'
                  );
                  if (!messageEle) {
                    return;
                  }
                  // @ts-ignore
                  messageEle.value = "";
                }
                // @ts-ignore
                const inputData = Object.fromEntries(formData.entries());

                if (!inputData.name || !inputData.message) {
                  clearMessage();
                  return false;
                }

                const submittedName = String(inputData.name);
                if (!isGuestbookNameAllowed(submittedName)) {
                  const nameEle = element.querySelector<HTMLInputElement>(
                    'input[name="name"]'
                  );
                  const sanitizedName = sanitizeGuestbookName(submittedName);
                  if (nameEle) {
                    nameEle.value = sanitizedName;
                  }
                  writeStoredGuestbookName(sanitizedName);
                  alert("please use letters and numbers only for your name");
                  return false;
                }

                if (
                  words.some((word) => {
                    const regex = new RegExp(`\\b${word}\\b`, "gi");
                    return (
                      regex.test(String(inputData.message)) ||
                      regex.test(String(inputData.name))
                    );
                  })
                ) {
                  alert("now why would you try to do something like that?");
                  clearMessage();
                  return false;
                }

                // TODO: add length validation here

                const timestamp = Date.now();
                const earliestAllowedSubmission =
                  timestamp - GuestbookSubmissionLimit.windowMs;
                guestbookSubmissionTimestamps =
                  guestbookSubmissionTimestamps.filter(
                    (submittedAt) =>
                      submittedAt > earliestAllowedSubmission &&
                      submittedAt <= timestamp
                  );

                if (
                  guestbookSubmissionTimestamps.length >=
                  GuestbookSubmissionLimit.maxEntries
                ) {
                  alert("please wait a bit before adding more guestbook notes");
                  return false;
                }

                const newEntry: FormData = {
                  message: "something",
                  ...inputData,
                  name: submittedName,
                  timestamp,
                };

                setData((d: FormData[]) => {
                  d.push(newEntry);
                });
                guestbookSubmissionTimestamps = [
                  ...guestbookSubmissionTimestamps,
                  timestamp,
                ];
                try {
                  window.localStorage.setItem(
                    GuestbookSubmissionLimit.storageKey,
                    JSON.stringify(guestbookSubmissionTimestamps)
                  );
                } catch {
                  // Ignore local storage failures so valid guestbook posts still work.
                }
                clearMessage();
                return false;
              });
            },
          } as ElementInitializer<FormData[]>,
        },
      }}
    >
      <FeaturesGrid />
      <ExperimentsArchive />
    </PlayProvider>
  );
}
