import { defineConfig, type Plugin } from 'vite'
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

// Pairs with the window.addEventListener('error'/'unhandledrejection', ...)
// forwarder in main.tsx: prints uncaught browser errors into this terminal
// (over the existing HMR WebSocket) instead of leaving them only in
// devtools, which is easy to miss while just watching `npm run dev`.
const browserErrorLogger = (): Plugin => ({
  name: 'browser-error-logger',
  apply: 'serve',
  configureServer(server) {
    server.ws.on('mapoguesser:browser-error', (data: { message: string; stack?: string }) => {
      server.config.logger.error(
        `\n[browser] ${data.message}${data.stack ? `\n${data.stack}` : ''}`,
        { timestamp: true },
      )
    })
  },
})

export default defineConfig({
  plugins: [react(), browserErrorLogger()],
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
    watch: {
      usePolling: true,
      interval: 300,
    },
  },
})
