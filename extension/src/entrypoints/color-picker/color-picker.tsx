// ABOUTME: Mounts the standalone cursor color editor extension page.
// ABOUTME: Used from Firefox popup flow to host native color input outside toolbar popups.

import React from "react";
import { createRoot } from "react-dom/client";
import { ColorPickerPage } from "../../components/ColorPickerPage";

const container = document.getElementById("root");
if (container) {
  createRoot(container).render(<ColorPickerPage />);
}
