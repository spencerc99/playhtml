// ABOUTME: Boots the /gallery page: the shared sites grid, the class strip and the add form.
// ABOUTME: Shares the homepage's styles and header; its playhtml room is this page.

import "../homepage.scss";
import "../pages.scss";
import { createRoot } from "react-dom/client";
import { PlayProvider } from "@playhtml/react";
import { GalleryIslands } from "../components/gallery/GalleryIslands";
import { getLocalPreviewInitOptions } from "../components/home/localPreview";
import { loadLiveCounts } from "../components/home/pageChrome";

const SubmissionRepo = "https://github.com/spencerc99/playhtml/issues/new";

// Submissions open a prefilled GitHub issue, so Spencer can look before a
// site goes up and nothing needs a server.
function setupAddForm() {
  const form = document.querySelector<HTMLFormElement>("[data-add-form]");
  if (!form) return;
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const data = new FormData(form);
    const link = String(data.get("link") ?? "").trim();
    const name = String(data.get("name") ?? "").trim();
    if (!link) return;
    const params = new URLSearchParams({
      title: `Gallery: ${link}`,
      labels: "gallery",
      body: `Link: ${link}\nMade by: ${name || "(not given)"}\n\nAdded from playhtml.fun/gallery.`,
    });
    window.open(`${SubmissionRepo}?${params}`, "_blank", "noopener");
  });
}

setupAddForm();
loadLiveCounts();

const reactContentElement = document.getElementById("reactContent");
if (reactContentElement) {
  const { cursorRoom, ...localPreview } = getLocalPreviewInitOptions();
  createRoot(reactContentElement).render(
    <PlayProvider
      initOptions={{
        ...localPreview,
        cursors: {
          enabled: true,
          enableChat: true,
          ...(cursorRoom ? { room: cursorRoom } : {}),
        },
      }}
    >
      <GalleryIslands />
    </PlayProvider>,
  );
}
