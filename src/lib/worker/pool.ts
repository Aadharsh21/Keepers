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
  index: number
  worker: Worker
  ready: Promise<void>
  busy: Job | null
  watchdog: ReturnType<typeof setTimeout> | null
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
 *
 * Every job has a watchdog. A worker that crashes, or is killed by the browser
 * without saying why (out of memory on a giant panorama, for example), fails
 * only the photo it was working on; it is replaced and the shoot carries on.
 */
export class AnalyzerPool {
  /** A photo that takes longer than this is skipped and its worker restarted. */
  static analyzeTimeoutMs = 120_000
  static previewTimeoutMs = 60_000
  /** Loading the models normally takes a few seconds; a worker silent this long is replaced. */
  static startTimeoutMs = 90_000

  private slots: Slot[] = []
  private queue: Job[] = []
  private nextId = 1
  private reported = false
  private statusResolve!: (s: PoolStatus) => void
  readonly status: Promise<PoolStatus> = new Promise((r) => (this.statusResolve = r))

  constructor(size = defaultPoolSize()) {
    for (let i = 0; i < size; i++) {
      const slot = { index: i, busy: null, watchdog: null } as unknown as Slot
      this.spawn(slot)
      this.slots.push(slot)
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
    for (const s of this.slots) {
      if (s.watchdog) clearTimeout(s.watchdog)
      s.worker.terminate()
    }
    this.slots = []
  }

  private spawn(slot: Slot): void {
    const worker = new Worker(new URL('./analyzer.worker.ts', import.meta.url), { type: 'module', name: `keeper-analyzer-${slot.index}` })
    slot.worker = worker
    slot.busy = null
    slot.ready = new Promise<void>((resolve) => {
      // A worker killed while loading its models never says ready; start a new one.
      const startWatchdog = setTimeout(() => {
        if (slot.worker !== worker) return
        worker.terminate()
        this.spawn(slot)
      }, AnalyzerPool.startTimeoutMs)
      const onReady = (e: MessageEvent<FromWorker>) => {
        if (e.data.type !== 'ready') return
        clearTimeout(startWatchdog)
        worker.removeEventListener('message', onReady)
        if (!this.reported) {
          this.reported = true
          this.statusResolve({ vision: e.data.vision, reason: e.data.reason })
        }
        resolve()
      }
      worker.addEventListener('message', onReady)
    })
    worker.addEventListener('message', (e: MessageEvent<FromWorker>) => {
      if (slot.worker === worker) this.onMessage(slot, e.data)
    })
    worker.addEventListener('error', (e) => {
      if (slot.worker === worker) this.restart(slot, new JobError('crashed', `The analyzer stopped unexpectedly (${e.message || 'unknown error'}).`))
    })
    worker.postMessage({ type: 'init', base: import.meta.env.BASE_URL } satisfies ToWorker)
    void slot.ready.then(() => this.pump())
  }

  /** Fails the slot's current job and replaces its worker with a fresh one. */
  private restart(slot: Slot, error: JobError): void {
    if (slot.watchdog) clearTimeout(slot.watchdog)
    slot.watchdog = null
    const job = slot.busy
    slot.busy = null
    slot.worker.terminate()
    job?.reject(error)
    this.spawn(slot)
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
      const worker = slot.worker
      void slot.ready.then(() => {
        if (slot.worker !== worker || slot.busy || !this.queue.length) return
        const job = this.queue.shift()!
        slot.busy = job
        const limit = job.message.type === 'preview' ? AnalyzerPool.previewTimeoutMs : AnalyzerPool.analyzeTimeoutMs
        slot.watchdog = setTimeout(
          () => this.restart(slot, new JobError('timeout', 'Keepers took too long reading this photo and skipped it.')),
          limit,
        )
        slot.worker.postMessage(job.message)
      })
    }
  }

  private onMessage(slot: Slot, msg: FromWorker): void {
    if (msg.type === 'ready') return
    const job = slot.busy
    if (!job || job.id !== msg.id) return
    if (slot.watchdog) clearTimeout(slot.watchdog)
    slot.watchdog = null
    slot.busy = null
    if (msg.type === 'error') job.reject(new JobError(msg.code, msg.message))
    else job.resolve(msg)
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
