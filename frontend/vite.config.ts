import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    proxy: {
      // Backend API during development — the frontend bundle never holds secrets.
      '/api': 'http://localhost:3000',
    },
  },
});
