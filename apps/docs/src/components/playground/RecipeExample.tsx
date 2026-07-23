// ABOUTME: Renders a canonical docs recipe in a shared-room iframe with testing controls.
// ABOUTME: Reuses the same recipe source that powers catalogue cards and the playground.
import { useEffect, useMemo, useRef, useState } from "react";
import { buildIframeSrcdoc } from "./iframe-template";
import { makePlayhtmlModuleUrl } from "./playhtml-module";
import type { ExampleRecipe } from "./recipes/types";
import "./recipe-example.css";

type RecipeExampleProps = {
  recipe: ExampleRecipe;
};

function makeRoomId(recipeId: string): string {
  return `example-${recipeId}-${crypto.randomUUID().replace(/-/g, "").slice(0, 8)}`;
}

export function RecipeExample({ recipe }: RecipeExampleProps) {
  const iframeHostRef = useRef<HTMLDivElement | null>(null);
  const [roomId, setRoomId] = useState("");
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const url = new URL(window.location.href);
    const existingRoom = url.searchParams.get("room");
    const nextRoom = existingRoom || makeRoomId(recipe.id);

    if (!existingRoom) {
      url.searchParams.set("room", nextRoom);
      history.replaceState(null, "", url);
    }

    setRoomId(nextRoom);
  }, [recipe.id]);

  useEffect(() => {
    if (!roomId || !iframeHostRef.current) return;

    const playhtmlUrl = makePlayhtmlModuleUrl();
    const iframe = document.createElement("iframe");
    iframe.setAttribute("sandbox", "allow-scripts allow-popups");
    iframe.title = `${recipe.title} live example`;
    iframe.srcdoc = buildIframeSrcdoc({
      recipeHtml: recipe.html,
      playhtmlUrl,
      roomId,
      showDevPanel: false,
    });

    iframeHostRef.current.replaceChildren(iframe);

    return () => {
      iframe.remove();
    };
  }, [recipe, roomId]);

  const playgroundHref = useMemo(() => {
    if (!roomId) return "/docs/play/";
    const hash = new URLSearchParams({ id: recipe.id, room: roomId });
    return `/docs/play/#${hash}`;
  }, [recipe.id, roomId]);

  async function copyTestLink() {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      window.prompt("Copy this URL, then paste it into a private window:", window.location.href);
    }
  }

  return (
    <section className="ph-recipe-example" aria-label={`${recipe.title} interactive example`}>
      <div className="ph-recipe-example__bar">
        <span>Live example</span>
        <span className="ph-recipe-example__room">Room {roomId || "connecting…"}</span>
      </div>
      <div className="ph-recipe-example__frame" ref={iframeHostRef} />
      <div className="ph-recipe-example__actions">
        <a className="ph-recipe-example__button" href={playgroundHref} target="_blank" rel="noreferrer">
          Open code in playground
        </a>
        <button className="ph-recipe-example__button ph-recipe-example__button--quiet" type="button" onClick={copyTestLink}>
          {copied ? "Copied test link" : "Copy private-window link"}
        </button>
      </div>
      <div className="ph-recipe-example__test">
        <strong>Test it with another person</strong>
        <ol>
          <li>Keep this page open in your normal window.</li>
          <li>Copy the private-window link, then paste it into a private or incognito window.</li>
          <li>Interact in either window and watch the other one update.</li>
        </ol>
      </div>
    </section>
  );
}
