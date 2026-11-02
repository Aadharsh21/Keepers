import type { PhotoKind } from '../formats/detect'
import type { AnalysisResult } from '../types'
import type { FromWorker, ToWorker } from './protocol'

interface Job {
  id: number
  priority: number
  message: ToWorker
  resolve: (value: FromWorker) => void
  reject: (error: Error) => void
}

interface Slot {
  worker: Worker
  ready: Promise<void>
  busy: Job | null
}

export class JobError extends Error {
  readonly code: string
  constructor(code: string, message: string) {
    super(message)
    this.code = code
  }
}

export interface PoolStatus {
  vision: boolean
  reason?: string
}

/**
 * Runs photo analysis on a small pool of module workers. Each worker holds its
 * own copy of the MediaPipe models, so the pool stays small (2 to 3) to keep
 * memory reasonable on laptops. Previews jump the queue so the loupe stays fast.
 */
export class AnalyzerPool {
  private slots: Slot[] = []
  private queue: Job[] = []
  private nextId = 1
  private statusResolve!: (s: PoolStatus) => void
  readonly status: Promise<PoolStatus> = new Promise((r) => (this.statusResolve = r))

  constructor(size = defaultPoolSize()) {
    const base = import.meta.env.BASE_URL
    let reported = false
    for (let i = 0; i < size; i++) {
      const worker = new Worker(new URL('./analyzer.worker.ts', import.meta.url), { type: 'module', name: `keeper-analyzer-${i}` })
      const slot: Slot = { worker, busy: null, ready: Promise.resolve() }
      slot.ready = new Promise<void>((resolve) => {
        const onReady = (e: MessageEvent<FromWorker>) => {
          if (e.data.type !== 'ready') return
          worker.removeEventListener('message', onReady)
          if (!reported) {
            reported = true
            this.statusResolve({ vision: e.data.vision, reason: e.data.reason })
          }
          resolve()
        }
        worker.addEventListener('message', onReady)
      })
      worker.addEventListener('message', (e: MessageEvent<FromWorker>) => this.onMessage(slot, e.data))
      worker.addEventListener('error', (e) => this.onCrash(slot, e.message || 'Worker crashed'))
      worker.postMessage({ type: 'init', base } satisfies ToWorker)
      this.slots.push(slot)
      void slot.ready.then(() => this.pump())
    }
  }

  get size(): number {
    return this.slots.length
  }

  analyze(file: File, kind: PhotoKind): Promise<AnalysisResult> {
    return this.enqueue({ type: 'analyze', id: 0, file, kind }, 0).then((msg) => {
      if (msg.type !== 'result') throw new JobError('failed', 'Unexpected worker reply')
      return msg.result
    })
  }

  preview(file: File, kind: PhotoKind, maxLong = 2560): Promise<{ blob: Blob; width: number; height: number }> {
    return this.enqueue({ type: 'preview', id: 0, file, kind, maxLong }, 10).then((msg) => {
      if (msg.type !== 'preview') throw new JobError('failed', 'Unexpected worker reply')
      return { blob: msg.blob, width: msg.width, height: msg.height }
    })
  }

  /** Drops queued analysis jobs. Jobs already running finish and are ignored by the caller. */
  clearQueue(): void {
    const dropped = this.queue.filter((j) => j.message.type === 'analyze')
    this.queue = this.queue.filter((j) => j.message.type !== 'analyze')
    for (const j of dropped) j.reject(new JobError('cancelled', 'Cancelled'))
  }

  dispose(): void {
    this.clearQueue()
    for (const s of this.slots) s.worker.terminate()
    this.slots = []
  }

  private enqueue(message: ToWorker, priority: number): Promise<FromWorker> {
    return new Promise((resolve, reject) => {
      const id = this.nextId++
      const job: Job = { id, priority, message: { ...message, id } as ToWorker, resolve, reject }
      // Higher priority first, FIFO within a priority.
      const at = this.queue.findIndex((j) => j.priority < priority)
      if (at < 0) this.queue.push(job)
      else this.queue.splice(at, 0, job)
      this.pump()
    })
  }

  private pump(): void {
    for (const slot of this.slots) {
      if (slot.busy || !this.queue.length) continue
      void slot.ready.then(() => {
        if (slot.busy || !this.queue.length) return
        const job = this.queue.shift()!
        slot.busy = job
        slot.worker.postMessage(job.message)
      })
    }
  }

  private onMessage(slot: Slot, msg: FromWorker): void {
    if (msg.type === 'ready') return
    const job = slot.busy
    if (!job || job.id !== msg.id) return
    slot.busy = null
    if (msg.type === 'error') job.reject(new JobError(msg.code, msg.message))
    else job.resolve(msg)
    this.pump()
  }

  private onCrash(slot: Slot, message: string): void {
    const job = slot.busy
    slot.busy = null
    job?.reject(new JobError('crashed', `The analyzer stopped unexpectedly (${message}).`))
    this.pump()
  }
}

export function defaultPoolSize(): number {
  const cores = typeof navigator !== 'undefined' ? navigator.hardwareConcurrency || 4 : 4
  const memory = typeof navigator !== 'undefined' ? ((navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? 8) : 8
  const byCores = Math.floor(cores / 2)
  const byMemory = memory <= 4 ? 1 : memory <= 6 ? 2 : 3
  return Math.max(1, Math.min(3, byCores, byMemory))
}
