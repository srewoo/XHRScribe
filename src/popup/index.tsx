import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { ThemedProvider } from '@/components/ThemedProvider';

const root = ReactDOM.createRoot(document.getElementById('root') as HTMLElement);

root.render(
  <ThemedProvider>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </ThemedProvider>
);
