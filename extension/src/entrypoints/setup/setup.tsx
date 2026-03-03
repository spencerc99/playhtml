// ABOUTME: Entrypoint for the setup wizard page
// ABOUTME: Renders SetupPage into the root element
import React from 'react';
import { createRoot } from 'react-dom/client';
import '../../styles/options.scss';
import SetupPage from '../../components/SetupPage';

const container = document.getElementById('root');
if (container) {
  const root = createRoot(container);
  root.render(<SetupPage />);
}

