import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// BASE_PATH: "/" na Vercel (padrão) e "/cosmos-hub/" no GitHub Pages.
export default defineConfig({
  base: process.env.BASE_PATH || '/',
  plugins: [react()],
  build: { target: 'es2022', chunkSizeWarningLimit: 2000 },
});
