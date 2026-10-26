// ABOUTME: Single-file HTML starter loaded by bare /play. Showcase of the
// ABOUTME: most-used playhtml capabilities, designed for "see the range, keep what you want."
import type { RunnableRecipe } from "./types";

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

export const starterRecipe: RunnableRecipe = {
  id: "_starter",
  html: `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>playhtml starter</title>
  <style>
    body { font-family: system-ui, sans-serif; background: #69f7be; margin: 0; padding: 2rem 1rem; text-align: center; }
    h1, h2 { color: #2800ff; }
    h1 { font-size: 64px; margin: 0; }
    section { display: flex; flex-wrap: wrap; gap: 1.5rem; align-items: center; justify-content: center; margin: 2rem 0; }
    img { width: 200px; }
    button, input { font: inherit; background: white; border: 1px solid black; padding: 0.5rem 1rem; }
    ul { list-style: none; padding: 0; }

    /* Each capability adds a class or style you can hook into. */
    #lamp.toggled { filter: brightness(1.2) drop-shadow(0 0 50px rgb(247 220 156)); }
    #catOrDog.toggled { content: url("${IMG_BASE}/dog.png"); }
    #hoverBox { width: 100px; height: 100px; background: red; }
    #hoverBox.hovered { background: blue; }
    #shootingStar { position: fixed; top: -36px; left: -36px; font-size: 36px; color: gold; }
    .reacted { background: #ff6b6b; }
  </style>
</head>
<body>
  <h1>Hello World!</h1>
  <p>Edit the code on the left. Everything below is shared with everyone on this page.</p>

  <!-- Built-in capabilities: add one attribute and an id. -->
  <section>
    <img id="illustration" can-spin src="${IMG_BASE}/illustration.svg" alt="Spin me" />
    <img id="openSign" can-move src="${IMG_BASE}/open-sign.gif" alt="Drag me" style="width: auto" />
    <img id="lamp" can-toggle src="${IMG_BASE}/lamp.png" alt="Toggle me" />
    <img id="catOrDog" can-toggle src="${IMG_BASE}/cat.jpg" alt="Toggle me" />
    <img id="plant" can-grow src="${IMG_BASE}/plant.png" alt="Grow me" />
    <div id="hoverBox" can-hover></div>
    <button id="duplicateBtn" can-duplicate>Click to clone me!</button>
  </section>

  <!-- can-mirror: changes to the element are shared, here its color. -->
  <section>
    <input id="colorBox" can-mirror />
    <button id="colorBtn">change color</button>
  </section>
  <script type="module">
    document.getElementById("colorBtn").addEventListener("click", () => {
      const box = document.getElementById("colorBox");
      box.style.backgroundColor = box.style.backgroundColor === "red" ? "green" : "red";
    });
  </script>

  <!-- can-mirror on a list: appended items appear for everyone. -->
  <h2>guestbook</h2>
  <section>
    <input id="guestbookInput" placeholder="say hi..." />
    <button id="guestbookBtn">say hi</button>
  </section>
  <ul id="guestbook" can-mirror></ul>
  <script type="module">
    document.getElementById("guestbookBtn").addEventListener("click", () => {
      const input = document.getElementById("guestbookInput");
      if (!input.value) return;
      const entry = document.createElement("li");
      entry.textContent = input.value;
      document.getElementById("guestbook").appendChild(entry);
      input.value = "";
    });
  </script>

  <!-- Events: a one-off moment everyone sees, nothing saved. -->
  <h2>events</h2>
  <button id="starBtn">shooting star!</button>
  <div id="shootingStar">★</div>
  <script type="module">
    import { playhtml } from "https://unpkg.com/playhtml@latest";

    playhtml.registerPlayEventListener("shootingStar", {
      onEvent: () => {
        document.getElementById("shootingStar").animate(
          [
            { transform: "translate(100vw, 100vh) rotate(0deg)" },
            { transform: "translate(-10vw, -10vh) rotate(360deg)" },
          ],
          { duration: 2000 },
        );
      },
    });
    document.getElementById("starBtn").addEventListener("click", () => {
      playhtml.dispatchPlayEvent({ type: "shootingStar" });
    });
  </script>

  <!-- can-play: your own shared element with custom data. -->
  <h2>custom elements</h2>
  <div id="reactionBtn" can-play></div>
  <script type="module">
    import { playhtml, html } from "https://unpkg.com/playhtml@latest";

    // A reaction button with a shared count. The view renders from \`data\`
    // and re-renders whenever anyone changes it.
    playhtml.register("reactionBtn", {
      defaultData: { count: 0 },
      view: ({ data, setData }) => {
        const hasReacted = Boolean(localStorage.getItem("reacted"));
        const react = () => {
          setData((d) => { d.count += hasReacted ? -1 : 1; });
          hasReacted ? localStorage.removeItem("reacted") : localStorage.setItem("reacted", "1");
        };
        return html\`
          <button class=\${hasReacted ? "reacted" : ""} @click=\${react}>
            react \${data.count}
          </button>
        \`;
      },
    });
  </script>

  <!-- Start playhtml once, after every element above is set up. -->
  <script type="module">
    import { playhtml } from "https://unpkg.com/playhtml@latest";

    await playhtml.init({
      developmentMode: true,
      cursors: { enabled: true, room: "page" },
    });
  </script>
</body>
</html>`,
};
