// ABOUTME: Export page entrypoint — admin tool for recording cursor trail animation to WebM video
// ABOUTME: Gated behind localStorage.wwo_admin === '1'; not linked from any normal extension UI

import React from "react";
import { createRoot } from "react-dom/client";
import "../../styles/options.scss";
import { ExportPage } from "../../components/ExportPage";

const container = document.getElementById("root");
if (container) {
  createRoot(container).render(<ExportPage />);
}
