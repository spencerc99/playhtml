// ABOUTME: Entrypoint for the setup wizard page
// ABOUTME: Renders SetupPage into the root element
import React from 'react';
import { createRoot } from 'react-dom/client';
import '../../styles/options.scss';
import "@fontsource/martian-mono/latin-400.css";
import "@fontsource/martian-mono/latin-500.css";
import "@fontsource/martian-mono/latin-600.css";
import "@fontsource/martian-mono/latin-700.css";
import SetupPage from '../../components/SetupPage';

const container = document.getElementById('root');
if (container) {
  const root = createRoot(container);
  root.render(<SetupPage />);
}

