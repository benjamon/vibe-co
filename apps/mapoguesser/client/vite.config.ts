import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'
import { execSync } from 'child_process'

// Short commit SHA, baked in at build time and shown in the Settings menu so
// a bug report can be tied to an exact build. 'dev' when git isn't available
// (e.g. a source tarball) rather than failing the build over it.
const commitSha = (() => {
  try {
    return execSync('git rev-parse --short HEAD', { cwd: __dirname })
      .toString()
      .trim()
  } catch {
    return 'dev'
  }
})()

const base = process.env.GITHUB_PAGES_BASE ?? '/'

export default defineConfig({
  plugins: [react()],
  base,
  define: {
    __COMMIT_SHA__: JSON.stringify(commitSha),
  },
  resolve: {
    alias: {
      shared: path.resolve(__dirname, '../shared/src'),
    },
  },
  server: {
    port: 5173,
  },
})
