import { downloadZip } from 'client-zip'
import type { PhotoSource } from '../types'
import { canSaveFile, ensureWritable, existingSize, pickFolder, subdir, writeFile } from './fsaccess'
import { freshSidecar, mergeSidecar, sidecarName, type RatingTags } from './xmp'

export interface ExportProgress {
  done: number
  total: number
  label: string
}

export interface ExportOutcome {
  message: string
  warnings: string[]
}

type Report = (p: ExportProgress) => void

function dirOf(path: string): string {
  const i = path.lastIndexOf('/')
  return i < 0 ? '' : path.slice(0, i)
}

async function sidecarText(source: PhotoSource, tags: RatingTags): Promise<string | null> {
  if (source.xmp) return mergeSidecar(await source.xmp.text(), tags)
  return freshSidecar(tags)
}

export interface Rated {
  source: PhotoSource
  tags: RatingTags
}

/** Writes (or updates) sidecars next to each RAW file inside the opened folder. */
export async function writeSidecarsToFolder(root: FileSystemDirectoryHandle, items: Rated[], report: Report, signal: AbortSignal): Promise<ExportOutcome> {
  if (!(await ensureWritable(root))) throw new Error('Keepers needs permission to save into the folder. Choose "Allow" when the browser asks.')
  const warnings: string[] = []
  let written = 0
  for (const [i, { source, tags }] of items.entries()) {
    if (signal.aborted) break
    report({ done: i, total: items.length, label: source.name })
    const text = await sidecarText(source, tags)
    if (text === null) {
      warnings.push(`${sidecarName(source.raw!.name)} was left unchanged because Keepers could not read it.`)
      continue
    }
    const dir = await subdir(root, dirOf(source.relPath), false)
    await writeFile(dir, sidecarName(source.raw!.name), text)
    written++
  }
  report({ done: items.length, total: items.length, label: '' })
  return { message: `Saved ratings for ${written.toLocaleString()} RAW ${written === 1 ? 'file' : 'files'} into "${root.name}".`, warnings }
}

/** Copies keepers (and their sidecars) into a folder the person picks. */
export async function copyToFolder(items: PhotoSource[], sidecars: Map<string, string>, report: Report, signal: AbortSignal): Promise<ExportOutcome> {
  const dest = await pickFolder('keeper-export')
  const total = items.length
  let copied = 0
  let skipped = 0
  for (const [i, source] of items.entries()) {
    if (signal.aborted) break
    report({ done: i, total, label: source.name })
    const dir = await subdir(dest, dirOf(source.relPath), true)
    for (const file of source.files) {
      // Skip files already copied by an earlier run, so a stopped export can resume.
      if ((await existingSize(dir, file.name)) === file.size) {
        skipped++
        continue
      }
      await writeFile(dir, file.name, file, signal)
    }
    const sidecar = sidecars.get(source.id)
    if (sidecar && source.raw) await writeFile(dir, sidecarName(source.raw.name), sidecar)
    copied++
  }
  report({ done: total, total, label: '' })
  const note = skipped ? ` (${skipped} already there)` : ''
  return { message: `Copied ${copied.toLocaleString()} keepers into "${dest.name}"${note}.`, warnings: [] }
}

interface ZipEntry {
  name: string
  input: Blob | string
  lastModified?: Date
}

function saveBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  document.body.append(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 60_000)
}

/**
 * Streams a ZIP. In Chrome and Edge it streams straight to disk, so shoot
 * size does not matter. Elsewhere it builds in memory, so large exports are
 * split into parts.
 */
export async function downloadAsZip(name: string, entries: ZipEntry[], report: Report, signal: AbortSignal): Promise<ExportOutcome> {
  const totalBytes = entries.reduce((n, e) => n + (typeof e.input === 'string' ? e.input.length : e.input.size), 0)
  let done = 0
  const tracked = async function* (list: ZipEntry[]) {
    for (const e of list) {
      if (signal.aborted) return
      report({ done, total: entries.length, label: e.name })
      yield e
      done++
    }
  }

  if (canSaveFile) {
    const picker = (window as unknown as { showSaveFilePicker: (o: object) => Promise<FileSystemFileHandle> }).showSaveFilePicker
    const handle = await picker({ suggestedName: `${name}.zip`, types: [{ description: 'ZIP archive', accept: { 'application/zip': ['.zip'] } }] })
    const writable = await handle.createWritable()
    try {
      await downloadZip(tracked(entries)).body!.pipeTo(writable, { signal })
    } catch (err) {
      await writable.abort().catch(() => {})
      throw err
    }
    report({ done: entries.length, total: entries.length, label: '' })
    return { message: `Saved ${handle.name} (${formatBytes(totalBytes)}).`, warnings: [] }
  }

  const LIMIT = 1.5 * 1024 ** 3
  const parts: ZipEntry[][] = [[]]
  let size = 0
  for (const e of entries) {
    const s = typeof e.input === 'string' ? e.input.length : e.input.size
    if (size + s > LIMIT && parts[parts.length - 1].length) {
      parts.push([])
      size = 0
    }
    parts[parts.length - 1].push(e)
    size += s
  }
  for (const [i, part] of parts.entries()) {
    if (signal.aborted) break
    const blob = await downloadZip(tracked(part)).blob()
    saveBlob(blob, parts.length > 1 ? `${name} (part ${i + 1} of ${parts.length}).zip` : `${name}.zip`)
  }
  report({ done: entries.length, total: entries.length, label: '' })
  return {
    message: parts.length > 1 ? `Downloaded ${parts.length} ZIP files (${formatBytes(totalBytes)} total).` : `Downloaded ${name}.zip (${formatBytes(totalBytes)}).`,
    warnings: [],
  }
}

export function formatBytes(n: number): string {
  if (n < 1024 ** 2) return `${Math.max(1, Math.round(n / 1024))} KB`
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(n < 10 * 1024 ** 2 ? 1 : 0)} MB`
  return `${(n / 1024 ** 3).toFixed(1)} GB`
}

export async function sidecarEntries(items: Rated[]): Promise<{ entries: ZipEntry[]; warnings: string[] }> {
  const entries: ZipEntry[] = []
  const warnings: string[] = []
  for (const { source, tags } of items) {
    const text = await sidecarText(source, tags)
    if (text === null) {
      warnings.push(`${sidecarName(source.raw!.name)} was skipped because Keepers could not read the existing file.`)
      continue
    }
    const dir = dirOf(source.relPath)
    entries.push({ name: `${dir ? `${dir}/` : ''}${sidecarName(source.raw!.name)}`, input: text })
  }
  return { entries, warnings }
}

export function fileEntries(items: PhotoSource[], sidecars: Map<string, string>): ZipEntry[] {
  const out: ZipEntry[] = []
  for (const s of items) {
    const dir = dirOf(s.relPath)
    for (const f of s.files) out.push({ name: `${dir ? `${dir}/` : ''}${f.name}`, input: f, lastModified: new Date(f.lastModified || Date.now()) })
    const sidecar = sidecars.get(s.id)
    if (sidecar && s.raw) out.push({ name: `${dir ? `${dir}/` : ''}${sidecarName(s.raw.name)}`, input: sidecar })
  }
  return out
}
