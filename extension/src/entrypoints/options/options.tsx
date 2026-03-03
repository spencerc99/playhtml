// ABOUTME: Entry point for the extension options page.
// ABOUTME: Mounts the SetupPage component into the options HTML page.

import React from 'react';
import { createRoot } from 'react-dom/client';
import '../../styles/options.scss';
import SetupPage from '../../components/SetupPage';

const container = document.getElementById('root');
if (container) {
  const root = createRoot(container);
  root.render(<SetupPage />);
}
