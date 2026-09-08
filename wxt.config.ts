import { defineConfig } from 'wxt';
import react from '@vitejs/plugin-react';

export default defineConfig({
  srcDir: 'src',
  manifest: {
    name: 'YouTube Dubbing — Hyper Sci-Fi Audio HUD',
    description: 'Real-time AI voice dubbing for YouTube with a Hyper Sci-Fi Audio HUD and gentle native captions.',
    version: '1.0.0',
    permissions: ['storage'],
    host_permissions: [
      '*://*.youtube.com/*',
      'https://speech.platform.bing.com/*',
      'wss://speech.platform.bing.com/*',
    ],
  },
  vite: () => ({
    plugins: [react()],
  }),
});
