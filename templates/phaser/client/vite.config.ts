import { defineConfig } from 'vite'
import path from 'path'
import fs from 'fs'

const APP_VERSION = String(Date.now())

export default defineConfig({
  base: process.env.GITHUB_PAGES_BASE ?? '/',
  define: {
    __APP_VERSION__: JSON.stringify(APP_VERSION),
  },
  resolve: {
    alias: {
      shared: path.resolve(__dirname, '../shared/src'),
    },
  },
  server: {
    port: 5173,
  },
  plugins: [
    {
      name: 'write-version-json',
      closeBundle() {
        const out = path.resolve(__dirname, 'dist')
        if (!fs.existsSync(out)) return
        fs.writeFileSync(
          path.join(out, 'version.json'),
          JSON.stringify({ version: APP_VERSION }) + '\n',
        )
      },
    },
  ],
})
