import { describe, expect, it } from 'vitest'
import type { Assessment, Moment } from '../engine/types'
import type { PhotoEntry } from './session'
import { buildView } from './selectors'

const assessment = (id: string, over: Partial<Assessment> = {}): Assessment => ({
  id,
  momentId: 'm1',
  rank: 0,
  score: 0.9,
  verdict: 'keep',
  needsLook: false,
  reasons: [],
  issues: [],
  focusRel: 1,
  eyes: 'open',
  faces: 1,
  closed: 0,
  ...over,
})

const entry = (id: string): PhotoEntry =>
  ({ source: { id, name: `${id}.jpg` }, order: 0, status: 'done' }) as unknown as PhotoEntry

describe('buildView', () => {
  const moments: Moment[] = [
    { id: 'm1', photoIds: ['a', 'b'] },
    { id: 'm2', photoIds: ['c'] },
  ]
  const byId = new Map([
    ['a', assessment('a')],
    ['b', assessment('b', { rank: 1, verdict: 'reject', issues: ['eyes-closed'], needsLook: true })],
    ['c', assessment('c', { momentId: 'm2', issues: ['overexposed'] })],
  ])
  const entries = new Map(['a', 'b', 'c'].map((id) => [id, entry(id)]))

  it('counts keepers, rejects and issues', () => {
    const v = buildView(moments, byId, {}, entries, 'all')
    expect(v.counts).toMatchObject({ keep: 2, reject: 1, eyes: 1, exposure: 1, look: 1, momentsAll: 2 })
    expect(v.mode).toBe('moments')
    expect(v.nav).toEqual(['a', 'b', 'c'])
  })

  it('applies a person’s overrides on top of Keepers’ picks', () => {
    const v = buildView(moments, byId, { b: 'keep', c: 'reject' }, entries, 'keep')
    expect(v.mode).toBe('grid')
    expect(v.photos).toEqual(['a', 'b'])
    expect(v.verdictOf('c')).toBe('reject')
  })

  it('drops a moment from Needs a look once the person decides', () => {
    expect(buildView(moments, byId, {}, entries, 'look').moments.map((m) => m.id)).toEqual(['m1'])
    expect(buildView(moments, byId, { b: 'reject' }, entries, 'look').moments).toHaveLength(0)
  })
})
