import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import cesium from 'vite-plugin-cesium'
import path from 'path'

// npm hoists workspace deps to apps/mapoguesser/node_modules, but vite-plugin-cesium
// looks for cesium under client/node_modules by default. Point it at the hoisted path.
const cesiumBuildRoot = path.resolve(__dirname, '../node_modules/cesium/Build')

export default defineConfig({
  plugins: [
    react(),
    cesium({
      cesiumBuildRootPath: cesiumBuildRoot,
      cesiumBuildPath: path.join(cesiumBuildRoot, 'Cesium/'),
    }),
  ],
  base: process.env.GITHUB_PAGES_BASE ?? '/',
  resolve: {
    alias: {
      shared: path.resolve(__dirname, '../shared/src'),
    },
  },
  server: {
    port: 5173,
  },
})
