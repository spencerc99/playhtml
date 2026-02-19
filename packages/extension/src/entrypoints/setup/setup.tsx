import React from 'react';
import { createRoot } from 'react-dom/client';
import SetupPage from '../../components/SetupPage';

const container = document.getElementById('root');
if (container) {
  const root = createRoot(container);
  root.render(<SetupPage />);
}

