import { openDB, type DBSchema, type IDBPDatabase } from 'idb'
import type { CullSettings } from '../engine/types'
import { ANALYSIS_VERSION, type PhotoFeatures, type Verdict } from '../types'

/**
 * Everything Keepers remembers lives in this browser's IndexedDB, on this
 * computer only. Analysis results are cached per file, so reopening a shoot
 * is instant, and review decisions survive reloads.
 */
interface CachedAnalysis {
  features: PhotoFeatures
  thumb: Blob
  savedAt: number
}

export interface SavedSession {
  key: string
  name: string
  photoCount: number
  keepCount: number
  updatedAt: number
  settings: CullSettings
  overrides: Record<string, Verdict>
  /** Chrome and Edge can keep a handle to the folder, so it reopens without picking it again. */
  dirHandle?: FileSystemDirectoryHandle
  isSample?: boolean
}

interface KeeperDB extends DBSchema {
  analysis: { key: string; value: CachedAnalysis }
  sessions: { key: string; value: SavedSession; indexes: { updatedAt: number } }
}

let dbPromise: Promise<IDBPDatabase<KeeperDB>> | null = null

function db(): Promise<IDBPDatabase<KeeperDB>> {
  dbPromise ??= openDB<KeeperDB>('keeper', 1, {
    upgrade(d) {
      d.createObjectStore('analysis')
      const sessions = d.createObjectStore('sessions', { keyPath: 'key' })
      sessions.createIndex('updatedAt', 'updatedAt')
    },
  })
  return dbPromise
}

/** IndexedDB can be missing (private windows in some browsers). Everything degrades to no cache. */
async function safe<T>(fn: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await fn()
  } catch (err) {
    console.warn('[keeper] storage unavailable', err)
    return fallback
  }
}

export function loadCached(ids: string[]): Promise<Map<string, CachedAnalysis>> {
  return safe(async () => {
    const d = await db()
    const tx = d.transaction('analysis')
    const values = await Promise.all(ids.map((id) => tx.store.get(id)))
    await tx.done
    const out = new Map<string, CachedAnalysis>()
    values.forEach((v, i) => {
      if (v && v.features.version === ANALYSIS_VERSION) out.set(ids[i], v)
    })
    return out
  }, new Map())
}

export function saveCached(entries: { id: string; features: PhotoFeatures; thumb: Blob }[]): Promise<void> {
  if (!entries.length) return Promise.resolve()
  return safe(async () => {
    const d = await db()
    const tx = d.transaction('analysis', 'readwrite')
    const now = Date.now()
    await Promise.all(entries.map((e) => tx.store.put({ features: e.features, thumb: e.thumb, savedAt: now }, e.id)))
    await tx.done
  }, undefined)
}

export function saveSession(s: SavedSession): Promise<void> {
  return safe(async () => {
    await (await db()).put('sessions', s)
  }, undefined)
}

export function recentSessions(limit = 3): Promise<SavedSession[]> {
  return safe(async () => {
    const all = await (await db()).getAllFromIndex('sessions', 'updatedAt')
    return all.reverse().slice(0, limit)
  }, [])
}

export function getSession(key: string): Promise<SavedSession | undefined> {
  return safe(async () => (await db()).get('sessions', key), undefined)
}

export function deleteSession(key: string): Promise<void> {
  return safe(async () => (await db()).delete('sessions', key), undefined)
}

/** Drops cached analysis older than 45 days so the cache does not grow forever. */
export function pruneCache(maxAgeDays = 45): Promise<void> {
  return safe(async () => {
    const d = await db()
    const cutoff = Date.now() - maxAgeDays * 86_400_000
    let cursor = await d.transaction('analysis', 'readwrite').store.openCursor()
    while (cursor) {
      if (cursor.value.savedAt < cutoff) await cursor.delete()
      cursor = await cursor.continue()
    }
  }, undefined)
}

export function clearEverything(): Promise<void> {
  return safe(async () => {
    const d = await db()
    await d.clear('analysis')
    await d.clear('sessions')
  }, undefined)
}
