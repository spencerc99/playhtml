import PartySocket from "partysocket";
import YProvider from "y-partykit/provider";
import "./style.scss";
import { Message, MessageType, TagType } from "./types";
import * as Y from "yjs";
import { SpinElement } from "./elements";

// This is the code that is running when the library is imported.

// YJS approach
// declare const PARTYKIT_HOST: string | undefined;

// const partykitHost =
//   typeof PARTYKIT_HOST === "undefined" ? "localhost:1999" : PARTYKIT_HOST;

// const doc = new Y.Doc();
// const provider = new YProvider(partykitHost, "yjs-demo", doc, {
//   connect: false,
// });

// Vanilla approach
const socket = new PartySocket({
  host: "localhost:1999", // for local development
  // host: "openwebsites.spencerc99.partykit.dev", // for production
  room: window.location.href,
});

socket.onerror = (err) => console.error({ err });
socket.onclose = (evt) => console.log("closed", evt);
socket.onopen = () => socket.send("ping");
socket.onmessage = (evt) => {
  console.log("onMessage");
  console.log(evt);
  const message = JSON.parse(evt.data) as Message;
  // Handle each MessageType
  // Hydrate the element's position from the server
  switch (message.type) {
    case MessageType.Position: {
      console.log("position", message);
      const { id, x, y } = message;
      // TODO: handle smart ID
      const ele = document.getElementById(id);
      ele.style.transform = `translate(${x}px, ${y}px)`;
    }
  }
  return;
};

export const TagData: Record<TagType, (eles: HtmlElement[]) => void> = {
  [TagType.CanMove]: (canMoveEles) => {
    function setTranslate(xPos: number, yPos: number, el: HTMLElement) {
      el.style.transform = `translate(${xPos}px, ${yPos}px)`;
    }

    for (const canMoveEle of canMoveEles) {
      console.log("setup");
      // canMoveEle.style.position = "absolute";
      // canMoveEle.setAttribute("draggable", "true");

      // TODO: need to find a good way to robustly generate a uniqueID for an element
      // if ID is not provided, and it should degrade gracefully
      const elementId = canMoveEle.id || btoa(canMoveEle.innerHTML);
      const initialX = canMoveEle.getBoundingClientRect().left;
      const initialY = canMoveEle.getBoundingClientRect().top;
      let isDragging = false;
      const dragStart = () => {
        console.log("DRAGSTART");
        isDragging = true;
      };

      function dragEnd() {
        console.log("DRAGEND");
        isDragging = false;
      }

      function drag(event: MouseEvent) {
        console.log("DRAG");
        if (!isDragging) return;

        event.preventDefault();

        const currentX = event.clientX - initialX;
        const currentY = event.clientY - initialY;

        setTranslate(currentX, currentY, canMoveEle);
      }

      // if ID is not provided, set it for the ele
      // canMove.id = ...
      canMoveEle.addEventListener("mousedown", dragStart);
      canMoveEle.addEventListener("mouseup", dragEnd);
      canMoveEle.addEventListener("mousemove", drag);
    }
  },
  [TagType.CanSpin]: (spinEles) => {
    for (const spinEle of spinEles) {
      const spinElement = new SpinElement(spinEle);
    }
  },
};

for (const [tag, setup] of Object.entries(TagData)) {
  const tagElements = document.querySelectorAll(`[${tag}]`);
  tagElements.forEach((ele) => {
    ele.classList.add(`__open-websites-${tag}`);
  });
  setup(tagElements);
}
