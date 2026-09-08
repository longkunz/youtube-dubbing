import React from 'react';
import ReactDOM from 'react-dom/client';
import { OptionsDashboard } from './OptionsDashboard';

const rootElement = document.getElementById('root');
if (rootElement) {
  const root = ReactDOM.createRoot(rootElement);
  root.render(
    <React.StrictMode>
      <OptionsDashboard />
    </React.StrictMode>
  );
}