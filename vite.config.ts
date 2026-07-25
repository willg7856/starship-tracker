import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

import { cloudflare } from "@cloudflare/vite-plugin";

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), cloudflare()],
  server: {
    proxy: {
      '/api/tracker': {
        target: 'https://sxcontent9668.azureedge.us',
        changeOrigin: true,
        rewrite: () =>
          `/cms-assets/starship_tracker_public.json?t=${Date.now()}`,
      },
      '/api/mission': {
        target: 'https://content.spacex.com',
        changeOrigin: true,
        rewrite: () =>
          '/api/spacex-website/missions/starship-flight-13',
      },
      '/api/space-notices-ship40': {
        target: 'https://data.space-notices.com',
        changeOrigin: true,
        rewrite: () => '/space-notices-data/ship-40',
      },
    },
  },
})