import { defineConfig } from 'vite';
export default defineConfig({
  // relative asset paths so the build works under https://<user>.github.io/spy-vs-mercs/
  base: './',
  server: { port: 5173, open: false },
  build: { target: 'es2022', chunkSizeWarningLimit: 2000 },
});
