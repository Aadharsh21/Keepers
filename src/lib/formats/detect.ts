export type PhotoKind = 'jpeg' | 'png' | 'webp' | 'heic' | 'raw'

/** Camera RAW extensions Keeper reads through their embedded previews. */
export const RAW_EXTENSIONS = new Set([
  'cr2', // Canon
  'cr3', // Canon
  'crw',
  'nef', // Nikon
  'nrw',
  'arw', // Sony
  'srf',
  'sr2',
  'dng', // Adobe, Leica, Pentax, phones
  'raf', // Fujifilm
  'orf', // Olympus / OM System
  'rw2', // Panasonic
  'pef', // Pentax
  'srw', // Samsung
])

const KIND_BY_EXT: Record<string, PhotoKind> = {
  jpg: 'jpeg',
  jpeg: 'jpeg',
  jpe: 'jpeg',
  png: 'png',
  webp: 'webp',
  heic: 'heic',
  heif: 'heic',
  hif: 'heic',
}

export function extensionOf(name: string): string {
  const dot = name.lastIndexOf('.')
  return dot < 0 ? '' : name.slice(dot + 1).toLowerCase()
}

export function baseNameOf(name: string): string {
  const slash = Math.max(name.lastIndexOf('/'), name.lastIndexOf('\\'))
  const file = name.slice(slash + 1)
  const dot = file.lastIndexOf('.')
  return dot <= 0 ? file : file.slice(0, dot)
}

export function kindOf(name: string): PhotoKind | null {
  const ext = extensionOf(name)
  if (RAW_EXTENSIONS.has(ext)) return 'raw'
  return KIND_BY_EXT[ext] ?? null
}

/** Accept string for file inputs. Phones need image/* to show the photo picker. */
export const ACCEPT_ATTR = [
  'image/*',
  ...Object.keys(KIND_BY_EXT).map((e) => `.${e}`),
  ...Array.from(RAW_EXTENSIONS, (e) => `.${e}`),
].join(',')

export const FORMAT_LABELS = ['JPEG', 'HEIC', 'PNG', 'WebP', 'Canon CR2 and CR3', 'Sony ARW', 'Nikon NEF', 'DNG', 'Fujifilm RAF', 'Panasonic RW2', 'Olympus ORF']
