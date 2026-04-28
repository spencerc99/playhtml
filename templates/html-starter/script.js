// Print a message in the dev panel's console panel
console.log("playhtml starter loaded");

/* 
Make the "Click me!" button move when the visitor clicks it:
- First add the button to the page by following the steps in the TODO 🚧
*/
const btn = document.querySelector("button"); // Get the button from the page
if (btn) {
  // Detect clicks on the button
  btn.onclick = function () {
    // The 'dipped' class in style.css changes the appearance on click
    btn.classList.toggle("dipped");
  };
}

/*
 * PLAYHTML SETUP
 */

function shootStar() {
  window.playhtml.dispatchPlayEvent({ type: "shootingStar" });
}

window.playhtml.registerPlayEventListener("shootingStar", {
  onEvent: (data) => {
    document
      .getElementById("shootingStar")
      .animate(
        [
          { transform: "translate(100vw, 100vh) rotate(0deg)" },
          { transform: "translate(-10vw, -10vh) rotate(360deg)" },
        ],
        {
          duration: 2000,
          fill: "forwards",
        }
      );
  },
});

function addGuestbook() {
  const message = document.getElementById("guestbookValue").value;
  if (!message) {
    alert("no message!");
    return;
  }
  const newMessage = document.createElement("li");

  newMessage.textContent = message;
  newMessage.setAttribute("can-move", "");
  playhtml.setupPlayElement(newMessage);
  document.getElementById("guestbook").appendChild(newMessage);
}

// Reaction button setup
window.playhtml.setupCustomElement({
  selector: "#reactionBtn",
  defaultData: { count: 0 },
  onClick: (element, data, setData) => {
    const hasReacted = Boolean(localStorage.getItem("reacted-reaction"));

    if (hasReacted) {
      setData({ count: data.count - 1 });
      localStorage.removeItem("reacted-reaction");
      element.classList.remove("reacted");
    } else {
      setData({ count: data.count + 1 });
      localStorage.setItem("reacted-reaction", "true");
      element.classList.add("reacted");
    }
  },
  onUpdate: (element, data) => {
    document.getElementById("reactionCount").textContent = data.count;
  },
  onMount: (element, data) => {
    // Set initial state based on localStorage
    const hasReacted = Boolean(localStorage.getItem("reacted-reaction"));
    if (hasReacted) {
      element.classList.add("reacted");
    }
    document.getElementById("reactionCount").textContent = data.count;
  }
});
