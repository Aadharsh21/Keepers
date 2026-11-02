// Copies the MediaPipe WebAssembly runtime out of node_modules so Vite serves it
// from our own origin. Keeps the wasm version locked to the npm package version.
import { cpSync, existsSync, mkdirSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const src = join(root, 'node_modules', '@mediapipe', 'tasks-vision', 'wasm')
const dest = join(root, 'public', 'mediapipe')

if (!existsSync(src)) {
  console.error('MediaPipe wasm folder not found. Run npm install first.')
  process.exit(1)
}
mkdirSync(dest, { recursive: true })
// Only the module build is used: the analysis runs inside module workers.
for (const file of readdirSync(src)) {
  if (file.startsWith('vision_wasm_module_internal')) {
    cpSync(join(src, file), join(dest, file))
  }
}
console.log('Copied MediaPipe runtime to public/mediapipe')
