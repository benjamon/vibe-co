import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import serveStatic from 'serve-static'
import fs from 'fs'
import path from 'path'

// npm hoists workspace deps to apps/mapoguesser/node_modules.
const cesiumBuildPath = path.resolve(
  __dirname,
  '../node_modules/cesium/Build/Cesium',
)
const cesiumUnminifiedPath = path.resolve(
  __dirname,
  '../node_modules/cesium/Build/CesiumUnminified',
)

const base = process.env.GITHUB_PAGES_BASE ?? '/'
const cesiumBaseUrl = `${base.endsWith('/') ? base : base + '/'}cesium/`

// Custom Cesium integration. We don't use vite-plugin-cesium because its asset
// copy step joins the URL `base` into the filesystem destination, producing
// `dist/<base>/cesium/...` (a path Pages can't serve) instead of `dist/cesium/`.
function cesium(): Plugin {
  return {
    name: 'cesium',
    config() {
      return {
        build: {
          rollupOptions: {
            output: {
              // Set the base URL Cesium reads at runtime to locate its workers,
              // widget CSS, textures, and ThirdParty assets. Injected before
              // any other module code runs.
              intro: `window.CESIUM_BASE_URL = ${JSON.stringify(cesiumBaseUrl)};`,
            },
          },
        },
      }
    },
    configureServer(server) {
      server.middlewares.use('/cesium', serveStatic(cesiumUnminifiedPath))
    },
    transformIndexHtml() {
      // In dev, set CESIUM_BASE_URL inline so Cesium can find its workers
      // before our module bundle starts importing it.
      return [
        {
          tag: 'script',
          children: `window.CESIUM_BASE_URL = ${JSON.stringify(cesiumBaseUrl)};`,
          injectTo: 'head-prepend',
        },
      ]
    },
    closeBundle() {
      const distDir = path.resolve(__dirname, 'dist')
      const targetDir = path.join(distDir, 'cesium')
      for (const sub of ['Assets', 'ThirdParty', 'Widgets', 'Workers']) {
        fs.cpSync(
          path.join(cesiumBuildPath, sub),
          path.join(targetDir, sub),
          { recursive: true },
        )
      }
    },
  }
}

export default defineConfig({
  plugins: [react(), cesium()],
  base,
  publicDir: path.resolve(__dirname, '../public'),
  resolve: {
    alias: {
      shared: path.resolve(__dirname, '../shared/src'),
    },
  },
  server: {
    port: 5173,
  },
})
