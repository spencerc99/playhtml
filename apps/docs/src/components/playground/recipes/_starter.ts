// ABOUTME: Single-file HTML starter loaded by bare /play. Showcase of the
// ABOUTME: most-used playhtml capabilities, designed for "see the range, keep what you want."

// Images are pulled from the live playhtml.fun deployment.
// Why: the iframe is sandboxed without allow-same-origin (spec §4.2,
// security). Astro's dev server blocks cross-origin subresource requests
// from sandboxed iframes for same-host paths. Pointing at playhtml.fun
// — a different origin — bypasses that block entirely. The same files
// live in website/public/playground-starter/ so they ship with the
// website deploy.
//
// Source files also live at apps/docs/public/playground-starter/ so the
// docs build still has them — but the recipe references the playhtml.fun
// copies because that's the URL that works inside the sandboxed iframe.
const IMG_BASE = "https://playhtml.fun/playground-starter";

export const starterRecipe: { id: string; html: string } = {
  id: "_starter",
  html: `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>playhtml starter</title>
  <style>
    :root {
      --color-bg: #69f7be;
      --color-primary: #ffff00;
      --font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif;
    }
    * { box-sizing: border-box; }
    body { font-family: var(--font-family); background-color: var(--color-bg); margin: 0; padding: 1rem; }
    .wrapper { min-height: 87vh; display: grid; place-items: center; margin: 0 1rem; }
    .content { display: flex; flex-direction: column; align-items: center; justify-content: center; }
    .title { color: #2800ff; font-weight: 700; font-size: 64px; line-height: 1.05; margin: 0 0 1rem; }
    .illustration { max-width: 100%; max-height: 240px; margin-top: 2rem; }
    .instructions { margin: 1rem auto 0; }
    button, input { font-family: inherit; font-size: 100%; background: #ffffff; border: 1px solid #000; padding: 0.5rem 1rem; transition: 500ms; }
    h2 { color: #2800ff; }
    .illustration:active { transform: translateY(5px); }
    .dipped { transform: translateY(5px); }
    #lamp.toggled { filter: brightness(1.2) saturate(1.6) drop-shadow(0px 0px 50px rgba(247, 220, 156, 0.85)); }
    .highlighted { box-shadow: 0px 0px 30px 10px rgb(245, 169, 15) !important; background: rgb(245 169 15 / 80%); }
    .capabilities li { width: fit-content; cursor: zoom-in; padding: 4px 0; }
    .capabilities li:hover { text-shadow: 0px 0px 4px rgb(245, 169, 15); }
    #colorBox { width: 200px; height: 60px; margin-bottom: 10px; background-color: white; display: block; }
    #shootingStar { top: -36px; left: -36px; font-size: 36px; position: fixed; text-shadow: 0 0 4px yellow; }
    #catOrDog { width: 200px; }
    #catOrDog.toggled { content: url("${IMG_BASE}/dog.png"); }
    #plant { width: 200px; }
    #hoverBox.hovered { background: blue !important; transform: scale(1.1); }
    .reaction { transition: all 0.2s ease; cursor: pointer; }
    .reaction.reacted { background: #ff6b6b; transform: scale(1.05); box-shadow: 0 5px 15px rgba(255, 107, 107, 0.3); }
  </style>
</head>
<body>
  <div class="wrapper">
    <div class="content" role="main">
      <h1 class="title" id="title">Hello World!</h1>
      <img src="${IMG_BASE}/illustration.svg" class="illustration" alt="Editor illustration" title="Click the image!" id="illustration" can-spin />

      <div class="instructions">
        <img src="${IMG_BASE}/open-sign.gif" can-move id="openSign" />
        <img src="${IMG_BASE}/lamp.png" style="width: 200px; position: absolute; top:0; right: -16px" id="lamp" can-toggle />

        <div style="margin-bottom: 2em; gap: 2em; display: flex; flex-wrap: wrap; align-items: center;">
          <img id="catOrDog" src="${IMG_BASE}/cat.jpg" can-toggle/>
          <img id="plant" can-grow src="${IMG_BASE}/plant.png"/>
          <div id="hoverBox" can-hover style="width: 100px; height: 100px; background: red;"></div>
          <button id="duplicateBtn" can-duplicate style="font-size: 24px; padding: 10px 20px;">Click to clone me!</button>
        </div>

        <input id="colorBox" can-mirror/>
        <button id="btn" can-mirror>CHANGE COLOR</button>

        <h2>playhtml starter</h2>
        <p>This is the playhtml starter. Edit the code on the left, watch the preview on the right. Hover the capabilities below to see which elements are collaborative.</p>

        <ol class="capabilities">
          <li onmouseenter="highlightElements('can-play')" onmouseleave="unhighlightElements('can-play')">can-play (custom capabilities)</li>
          <li onmouseenter="highlightElements('can-move')" onmouseleave="unhighlightElements('can-move')">can-move</li>
          <li onmouseenter="highlightElements('can-mirror')" onmouseleave="unhighlightElements('can-mirror')">can-mirror</li>
          <li onmouseenter="highlightElements('can-toggle')" onmouseleave="unhighlightElements('can-toggle')">can-toggle</li>
          <li onmouseenter="highlightElements('can-spin')" onmouseleave="unhighlightElements('can-spin')">can-spin</li>
          <li onmouseenter="highlightElements('can-grow')" onmouseleave="unhighlightElements('can-grow')">can-grow</li>
          <li onmouseenter="highlightElements('can-duplicate')" onmouseleave="unhighlightElements('can-duplicate')">can-duplicate</li>
          <li onmouseenter="highlightElements('can-hover')" onmouseleave="unhighlightElements('can-hover')">can-hover</li>
        </ol>
      </div>
    </div>

    <div id="shootingStar">★</div>

    <div>
      Here's a playhtml event. It triggers a shooting star for everyone.
      <button onclick="shootStar()">shooting star!</button>
    </div>

    <div>here's a custom guestbook made with can-mirror</div>
    <input id="guestbookValue" placeholder="say hi..."/>
    <button onclick="addGuestbook()">say hi</button>
    <ul id="guestbook"></ul>

    <div>here's a reaction button — everyone sees the count</div>
    <div id="reactionBtn" can-play></div>
  </div>

  <script type="module">
    import { playhtml, html } from "playhtml";

    // Register the reaction button with a view. register() can run before OR
    // after init() — there's no ordering rule. The view renders from the
    // shared \`data\`; the @click handler writes it and the view re-renders.
    playhtml.register("reactionBtn", {
      defaultData: { count: 0 },
      view: ({ data, setData }) => {
        const hasReacted = Boolean(localStorage.getItem("reacted-reaction"));
        const react = () => {
          if (localStorage.getItem("reacted-reaction")) {
            setData((d) => { d.count -= 1; });
            localStorage.removeItem("reacted-reaction");
          } else {
            setData((d) => { d.count += 1; });
            localStorage.setItem("reacted-reaction", "true");
          }
        };
        return html\`
          <button
            class="reaction \${hasReacted ? "reacted" : ""}"
            style="font-size: 24px; padding: 10px 20px; margin: 10px 0;"
            @click=\${react}
          >
            react \${data.count}
          </button>
        \`;
      },
    });

    await playhtml.init({
      developmentMode: true,
      cursors: { enabled: true, room: "page" },
    });

    window.playhtml = playhtml;

    function shootStar() {
      window.playhtml.dispatchPlayEvent({ type: "shootingStar" });
    }
    window.shootStar = shootStar;

    window.playhtml.registerPlayEventListener("shootingStar", {
      onEvent: () => {
        document.getElementById("shootingStar").animate(
          [
            { transform: "translate(100vw, 100vh) rotate(0deg)" },
            { transform: "translate(-10vw, -10vh) rotate(360deg)" },
          ],
          { duration: 2000, fill: "forwards" }
        );
      },
    });

    function addGuestbook() {
      const message = document.getElementById("guestbookValue").value;
      if (!message) return;
      const newMessage = document.createElement("li");
      newMessage.textContent = message;
      newMessage.setAttribute("can-move", "");
      newMessage.id = "gb-" + Date.now();
      document.getElementById("guestbook").appendChild(newMessage);
      window.playhtml.setupPlayElement(newMessage);
    }
    window.addGuestbook = addGuestbook;

    function changeColor() {
      const colorBox = document.getElementById("colorBox");
      colorBox.style.backgroundColor = colorBox.style.backgroundColor === "red" ? "green" : "red";
    }
    document.getElementById("btn").addEventListener("click", changeColor);

    window.highlightElements = (capability) => {
      document.querySelectorAll('[' + capability + ']').forEach(ele => ele.classList.add("highlighted"));
    };
    window.unhighlightElements = (capability) => {
      document.querySelectorAll('[' + capability + ']').forEach(ele => ele.classList.remove("highlighted"));
    };
  </script>
</body>
</html>`,
};
