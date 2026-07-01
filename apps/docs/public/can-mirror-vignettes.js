// ABOUTME: Wires the capabilities page can-mirror vignette controls.
// ABOUTME: Keeps the live demos behavior-matched to the adjacent snippets.
const emojiOnly = /\p{Extended_Pictographic}/gu;
const emojiPad = document.getElementById("emoji-pad");
const guestbook = document.getElementById("guestbook");
const guestbookAdd = document.getElementById("guestbook-add");

if (!(emojiPad instanceof HTMLTextAreaElement)) {
  throw new Error("Missing emoji-pad textarea for the can-mirror vignette.");
}
if (!(guestbook instanceof HTMLUListElement)) {
  throw new Error("Missing guestbook list for the can-mirror vignette.");
}
if (!(guestbookAdd instanceof HTMLButtonElement)) {
  throw new Error("Missing guestbook-add button for the can-mirror vignette.");
}

emojiPad.addEventListener("input", () => {
  const match = emojiPad.value.match(emojiOnly);
  emojiPad.value = match ? match.join("") : "";
});

guestbookAdd.addEventListener("click", () => {
  guestbook.appendChild(
    Object.assign(document.createElement("li"), {
      textContent: new Date().toLocaleTimeString(),
    }),
  );
});
