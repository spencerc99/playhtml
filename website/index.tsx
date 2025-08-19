import { ElementInitializer } from "@playhtml/common";
import words from "profane-words";
import "./home.scss";
// NOTE: this pins it to the working code so we can test out new library changes through this home page.
import { playhtml } from "../packages/playhtml/src/main";
import confetti from "canvas-confetti";

interface FormData {
  name: string;
  message: string;
  timestamp: number;
}

function getFormDataId(formData: FormData) {
  return `${formData.name}-${formData.timestamp}`;
}

playhtml.init({
  events: {
    confetti: {
      type: "confetti",
      onEvent: (data) => {
        confetti({
          ...(data || {}),
          shapes:
            // NOTE: this serialization is needed because `slide` doesn't serialize to JSON properly.
            "shapes" in data
              ? data.shapes.map((shape) => (shape === "slide" ? slide : shape))
              : undefined,
        });
      },
    },
  },
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

        const guestbookDiv = document.getElementById("guestbookMessages")!;
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
            newEntry.querySelector(".guestbook-entry-name")!.innerText =
              entry.name;
          }
          if (newEntry.querySelector(".guestbook-entry-message")) {
            // @ts-ignore
            newEntry.querySelector(".guestbook-entry-message")!.innerText =
              entry.message;
          }
          addedEntries.add(getFormDataId(entry));
        });

        setLocalData({ addedEntries });
      },
      onMount: ({ getElement, getData, setData }) => {
        const element = getElement();
        element.addEventListener("submit", (e: SubmitEvent) => {
          e.preventDefault();
          e.stopImmediatePropagation();
          const entries = getData();

          const formData = new FormData(e.target as HTMLFormElement);
          // massage formData into new object

          function clearMessage() {
            const messageEle = element.querySelector('input[name="message"]');
            if (!messageEle) {
              return;
            }
            // @ts-ignore
            messageEle.value = "";
          }
          // @ts-ignore
          const inputData = Object.fromEntries(formData.entries());

          if (!inputData.name ?? !inputData.message) {
            clearMessage();
            return false;
          }

          if (
            words.some((word) => {
              const regex = new RegExp(`\\b${word}\\b`, "gi");
              return (
                regex.test(inputData.message) || regex.test(inputData.name)
              );
            })
          ) {
            alert("now why would you try to do something like that?");
            clearMessage();
            return false;
          }

          // TODO: add length validation here

          const timestamp = Date.now();
          const newEntry: FormData = {
            name: "someone",
            message: "something",
            ...inputData,
            timestamp,
          };
          setData([...entries, newEntry]);
          clearMessage();
          return false;
        });
      },
    } as ElementInitializer<FormData[]>,
  },
});

const slide = confetti.shapeFromText({ text: "🛝" });

document.querySelector("body").addEventListener("click", (e) => {
  // 1/4 clicks should trigger confetti
  if (Math.random() > 0.33) {
    return;
  }

  playhtml.dispatchPlayEvent({
    type: "confetti",
    eventPayload: {
      origin: {
        x: e.clientX / window.innerWidth,
        y: e.clientY / window.innerHeight,
      },
      particleCount: 7,
      startVelocity: 10,
      spread: 70,
      decay: 0.9,
      shapes: ["slide", "circle"],
    },
  });
});
