import { defineConfig } from 'vite'
import path from 'path'

export default defineConfig({
  resolve: {
    alias: {
      shared: path.resolve(__dirname, '../shared/src'),
    },
  },
  publicDir: path.resolve(__dirname, '../public'),
  server: {
    port: 5173,
  },
})
