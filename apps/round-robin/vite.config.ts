import { defineConfig } from 'vite'

export default defineConfig({
  root: 'client',
  base: process.env.GITHUB_PAGES_BASE ?? '/',
  build: { outDir: 'dist', emptyOutDir: true },
  server: { port: 5173 },
})
