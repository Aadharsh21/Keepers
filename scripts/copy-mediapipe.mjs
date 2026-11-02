// Copies the MediaPipe WebAssembly runtime out of node_modules so Vite serves it
// from our own origin. The folder is named after the package version, so the
// files can be cached forever and an upgrade never mixes old and new halves.
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const pkgDir = join(root, 'node_modules', '@mediapipe', 'tasks-vision')
const src = join(pkgDir, 'wasm')

if (!existsSync(src)) {
  console.error('MediaPipe wasm folder not found. Run npm install first.')
  process.exit(1)
}
const { version } = JSON.parse(readFileSync(join(pkgDir, 'package.json'), 'utf8'))
const base = join(root, 'public', 'mediapipe')
const dest = join(base, version)
// Remove other versions so the deploy only carries the one in use.
if (existsSync(base)) {
  for (const entry of readdirSync(base)) if (entry !== version) rmSync(join(base, entry), { recursive: true, force: true })
}
mkdirSync(dest, { recursive: true })
// Only the module build is used: the analysis runs inside module workers.
for (const file of readdirSync(src)) {
  if (file.startsWith('vision_wasm_module_internal')) cpSync(join(src, file), join(dest, file))
}
console.log(`Copied MediaPipe ${version} runtime to public/mediapipe/${version}`)
