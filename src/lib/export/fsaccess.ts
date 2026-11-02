/**
 * Thin helpers over the File System Access API (Chrome and Edge on desktop).
 * Other browsers fall back to downloads.
 */
type PermissionHandle = FileSystemHandle & {
  queryPermission?: (o: { mode: 'read' | 'readwrite' }) => Promise<PermissionState>
  requestPermission?: (o: { mode: 'read' | 'readwrite' }) => Promise<PermissionState>
}

export const canWriteFolders = typeof window !== 'undefined' && 'showDirectoryPicker' in window
export const canSaveFile = typeof window !== 'undefined' && 'showSaveFilePicker' in window

export async function ensureWritable(handle: FileSystemDirectoryHandle): Promise<boolean> {
  const h = handle as PermissionHandle
  if (!h.queryPermission || !h.requestPermission) return false
  if ((await h.queryPermission({ mode: 'readwrite' })) === 'granted') return true
  return (await h.requestPermission({ mode: 'readwrite' })) === 'granted'
}

export async function pickFolder(id: string): Promise<FileSystemDirectoryHandle> {
  const picker = (window as unknown as { showDirectoryPicker: (o: object) => Promise<FileSystemDirectoryHandle> }).showDirectoryPicker
  return picker({ id, mode: 'readwrite' })
}

export async function subdir(root: FileSystemDirectoryHandle, path: string, create: boolean): Promise<FileSystemDirectoryHandle> {
  let dir = root
  for (const part of path.split('/').filter(Boolean)) dir = await dir.getDirectoryHandle(part, { create })
  return dir
}

export async function existingSize(dir: FileSystemDirectoryHandle, name: string): Promise<number | null> {
  try {
    const f = await (await dir.getFileHandle(name)).getFile()
    return f.size
  } catch {
    return null
  }
}

export async function writeFile(dir: FileSystemDirectoryHandle, name: string, data: Blob | string, signal?: AbortSignal): Promise<void> {
  const handle = await dir.getFileHandle(name, { create: true })
  const writable = await handle.createWritable()
  try {
    if (typeof data === 'string') await writable.write(data)
    else await data.stream().pipeTo(writable, { signal })
    if (typeof data === 'string') await writable.close()
  } catch (err) {
    await writable.abort().catch(() => {})
    throw err
  }
}
