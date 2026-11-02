import { createHash } from 'node:crypto'
import { readdirSync, readFileSync } from 'node:fs'
import react from '@vitejs/plugin-react'
import type { Plugin } from 'vite'
import { defineConfig } from 'vitest/config'

const mediapipe = JSON.parse(readFileSync('node_modules/@mediapipe/tasks-vision/package.json', 'utf8')) as { version: string }

/** Public files that belong to the app shell and should work offline. */
const SHELL_FILES = ['/', '/theme.js', '/favicon.svg', '/manifest.webmanifest', '/icons/icon-192.png']

/**
 * Emits sw.js with this build's file list baked in. Large, rarely needed
 * chunks (the HEIC decoder) and source maps are left to runtime caching.
 */
function serviceWorker(): Plugin {
  return {
    name: 'keeper-service-worker',
    apply: 'build',
    generateBundle(_options, bundle) {
      const built = Object.keys(bundle)
        .filter((f) => !f.endsWith('.map') && !f.endsWith('.html') && !/libheif/.test(f))
        .map((f) => `/${f}`)
      const precache = [...SHELL_FILES, ...built]
      const id = createHash('sha256').update(precache.join('\n')).digest('hex').slice(0, 12)
      const models = [
        `/mediapipe/${mediapipe.version}/vision_wasm_module_internal.js`,
        `/mediapipe/${mediapipe.version}/vision_wasm_module_internal.wasm`,
        ...readdirSync('public/models').map((f) => `/models/${f}`),
      ]
      const source = readFileSync('src/sw/sw.template.js', 'utf8')
        .replace("'__BUILD_ID__'", JSON.stringify(id))
        .replace('__PRECACHE__', JSON.stringify(precache, null, 2))
        .replace('__MODELS__', JSON.stringify(models, null, 2))
      this.emitFile({ type: 'asset', fileName: 'sw.js', source })
    },
  }
}

export default defineConfig({
  plugins: [react(), serviceWorker()],
  define: {
    __MEDIAPIPE_VERSION__: JSON.stringify(mediapipe.version),
  },
  worker: {
    format: 'es',
  },
  build: {
    target: 'es2022',
    sourcemap: true,
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
})
