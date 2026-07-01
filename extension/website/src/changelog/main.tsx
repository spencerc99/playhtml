// ABOUTME: Entry point for the public extension changelog page.
// ABOUTME: Imports the extension changelog Markdown and renders it as React.

import React from "react";
import ReactDOM from "react-dom/client";
import changelogMarkdown from "../../../CHANGELOG.md?raw";
import { ChangelogPage } from "./ChangelogPage";
import { parseChangelog } from "./changelog";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ChangelogPage releases={parseChangelog(changelogMarkdown)} />
  </React.StrictMode>,
);
