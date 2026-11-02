import type { PhotoFeatures, Verdict } from '../types'

export type Grouping = 'tight' | 'normal' | 'loose'
export type Strictness = 'relaxed' | 'balanced' | 'strict'

export interface CullSettings {
  /** How many frames to keep from each moment. */
  picksPerMoment: 1 | 2 | 3
  strictness: Strictness
  grouping: Grouping
}

export const DEFAULT_SETTINGS: CullSettings = { picksPerMoment: 1, strictness: 'balanced', grouping: 'normal' }

export interface EnginePhoto {
  id: string
  name: string
  /** Position in natural filename order; tie-breaker when capture times match or are missing. */
  order: number
  f: PhotoFeatures
}

export interface Moment {
  id: string
  /** Photo ids, best first after scoring. */
  photoIds: string[]
  start?: number
  end?: number
}

export type IssueCode = 'soft' | 'eyes-closed' | 'blink' | 'overexposed' | 'underexposed' | 'duplicate'

export interface Reason {
  text: string
  tone: 'good' | 'bad' | 'info'
}

export type EyeState = 'open' | 'some-closed' | 'closed' | 'none'

export interface Assessment {
  id: string
  momentId: string
  /** 0 is the best frame of its moment. */
  rank: number
  score: number
  verdict: Verdict
  /** Keeper is unsure: a close call, the best of a weak set, or a borderline single. */
  needsLook: boolean
  reasons: Reason[]
  issues: IssueCode[]
  focusRel: number
  eyes: EyeState
  faces: number
  closed: number
}

export interface CullResult {
  moments: Moment[]
  byId: Map<string, Assessment>
}
