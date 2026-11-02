import { baseNameOf, extensionOf, kindOf } from '../formats/detect'
import type { PhotoSource } from '../types'

export interface FileWithPath {
  file: File
  /** Path relative to the opened folder, using forward slashes. */
  path: string
}

export interface Skipped {
  name: string
  reason: string
}

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })
export const naturalCompare = (a: string, b: string) => collator.compare(a, b)

/** Folders Keeper writes into; never read them back as part of the shoot. */
const SKIP_DIRS = new Set(['keepers', '@eadir', '.thumbnails'])

function isHidden(name: string) {
  return name.startsWith('.') || name.startsWith('._')
}

export function fromFileList(list: FileList | File[]): FileWithPath[] {
  return Array.from(list, (file) => ({
    file,
    path: (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name,
  }))
}

export async function fromDirectoryHandle(dir: FileSystemDirectoryHandle, prefix = '', depth = 0): Promise<FileWithPath[]> {
  const out: FileWithPath[] = []
  if (depth > 6) return out
  for await (const entry of (dir as FileSystemDirectoryHandle & { values(): AsyncIterable<FileSystemHandle> }).values()) {
    if (isHidden(entry.name)) continue
    if (entry.kind === 'file') {
      const ext = extensionOf(entry.name)
      if (!kindOf(entry.name) && ext !== 'xmp') continue
      const file = await (entry as FileSystemFileHandle).getFile()
      out.push({ file, path: prefix + entry.name })
    } else if (!SKIP_DIRS.has(entry.name.toLowerCase())) {
      out.push(...(await fromDirectoryHandle(entry as FileSystemDirectoryHandle, `${prefix}${entry.name}/`, depth + 1)))
    }
  }
  return out
}

/** Reads dropped files and folders. Uses the File System Access handle when the browser offers one. */
export async function fromDataTransfer(
  dt: DataTransfer,
): Promise<{ files: FileWithPath[]; handle: FileSystemDirectoryHandle | null; name: string }> {
  const items = Array.from(dt.items).filter((i) => i.kind === 'file')
  type WithHandle = DataTransferItem & { getAsFileSystemHandle?: () => Promise<FileSystemHandle | null> }
  if (items.length && typeof (items[0] as WithHandle).getAsFileSystemHandle === 'function') {
    const handles = await Promise.all(items.map((i) => (i as WithHandle).getAsFileSystemHandle!()))
    const files: FileWithPath[] = []
    let dirHandle: FileSystemDirectoryHandle | null = null
    for (const h of handles) {
      if (!h) continue
      if (h.kind === 'directory') {
        dirHandle = handles.length === 1 ? (h as FileSystemDirectoryHandle) : null
        files.push(...(await fromDirectoryHandle(h as FileSystemDirectoryHandle)))
      } else {
        files.push({ file: await (h as FileSystemFileHandle).getFile(), path: h.name })
      }
    }
    const first = handles.find(Boolean)
    return { files, handle: dirHandle, name: dirHandle?.name ?? first?.name ?? 'Dropped photos' }
  }
  // Fallback: the older entries API, which every current browser supports.
  const entries = items.map((i) => i.webkitGetAsEntry()).filter((e): e is FileSystemEntry => !!e)
  const files: FileWithPath[] = []
  const walk = async (entry: FileSystemEntry, prefix: string, depth: number): Promise<void> => {
    if (isHidden(entry.name) || depth > 6) return
    if (entry.isFile) {
      const file = await new Promise<File>((res, rej) => (entry as FileSystemFileEntry).file(res, rej))
      files.push({ file, path: prefix + entry.name })
    } else if (entry.isDirectory && !SKIP_DIRS.has(entry.name.toLowerCase())) {
      const reader = (entry as FileSystemDirectoryEntry).createReader()
      let batch: FileSystemEntry[]
      do {
        batch = await new Promise<FileSystemEntry[]>((res, rej) => reader.readEntries(res, rej))
        for (const e of batch) await walk(e, `${prefix}${entry.name}/`, depth + 1)
      } while (batch.length)
    }
  }
  for (const e of entries) await walk(e, '', 0)
  const name = entries.length === 1 && entries[0].isDirectory ? entries[0].name : 'Dropped photos'
  return { files, handle: null, name }
}

export function fingerprint(path: string, file: File): string {
  return `${path}|${file.size}|${file.lastModified}`
}

/**
 * Turns loose files into photos: RAW and JPEG files with the same name in the
 * same folder become one photo (cameras set to RAW+JPEG write both), and any
 * existing .xmp sidecar is attached so exports can update it instead of
 * replacing it.
 */
export function buildSources(input: FileWithPath[]): { sources: PhotoSource[]; skipped: Skipped[] } {
  const skipped: Skipped[] = []
  const groups = new Map<string, FileWithPath[]>()
  const sidecars = new Map<string, File>()
  for (const item of input) {
    const slash = item.path.lastIndexOf('/')
    const dir = slash < 0 ? '' : item.path.slice(0, slash)
    const key = `${dir}/${baseNameOf(item.path).toLowerCase()}`
    if (extensionOf(item.path) === 'xmp') {
      sidecars.set(key, item.file)
      continue
    }
    if (!kindOf(item.path)) {
      if (!isHidden(item.file.name)) skipped.push({ name: item.path, reason: 'Not a photo format Keeper reads' })
      continue
    }
    if (item.file.size === 0) {
      skipped.push({ name: item.path, reason: 'The file is empty' })
      continue
    }
    const list = groups.get(key) ?? []
    list.push(item)
    groups.set(key, list)
  }

  const sources: PhotoSource[] = []
  for (const [key, items] of groups) {
    const raws = items.filter((i) => kindOf(i.path) === 'raw')
    const others = items.filter((i) => kindOf(i.path) !== 'raw')
    const dir = key.slice(0, key.lastIndexOf('/'))
    const xmp = sidecars.get(key)
    if (raws.length === 1 && others.length >= 1) {
      // RAW+JPEG pair: analyze the JPEG (full size and fast to decode), keep the RAW for export.
      const primary = others.find((o) => kindOf(o.path) === 'jpeg') ?? others[0]
      sources.push({
        id: fingerprint(primary.path, primary.file),
        name: raws[0].file.name,
        relPath: raws[0].path,
        kind: kindOf(primary.path)!,
        file: primary.file,
        raw: raws[0].file,
        files: [raws[0].file, ...others.map((o) => o.file)],
        xmp,
        dir,
      })
    } else {
      for (const i of items) {
        const kind = kindOf(i.path)!
        sources.push({
          id: fingerprint(i.path, i.file),
          name: i.file.name,
          relPath: i.path,
          kind,
          file: i.file,
          raw: kind === 'raw' ? i.file : undefined,
          files: [i.file],
          xmp: kind === 'raw' ? xmp : undefined,
          dir,
        })
      }
    }
  }
  sources.sort((a, b) => naturalCompare(a.relPath, b.relPath))
  return { sources, skipped }
}
