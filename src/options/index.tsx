import React from 'react';
import ReactDOM from 'react-dom/client';
import OptionsApp from './OptionsApp';
import { ThemedProvider } from '@/components/ThemedProvider';

const root = ReactDOM.createRoot(document.getElementById('root') as HTMLElement);

root.render(
  <React.StrictMode>
    <ThemedProvider>
      <OptionsApp />
    </ThemedProvider>
  </React.StrictMode>
);
