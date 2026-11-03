import { hamming } from '../analysis/dhash'
import type { FaceInfo } from '../types'
import { cosine, groupMoments } from './group'
import type { Assessment, CullResult, CullSettings, EnginePhoto, IssueCode, Moment, Reason, Strictness } from './types'

/**
 * Turns per-photo measurements into keep/reject decisions.
 *
 * Focus numbers only mean something next to a similar frame (a plain wall
 * always scores lower than a lace dress), so ranking happens inside each
 * moment. Shoot-wide baselines are used only to flag frames that are soft
 * compared with the rest of the shoot.
 */

// Softness against the whole shoot is only a hint (a foggy landscape is soft
// next to a lace dress), so it flags a frame for a look. Rejecting a frame
// that is alone in its moment needs it to be far below the shoot everywhere:
// its subject tiles and its single sharpest tile.
const STRICT: Record<Strictness, { soft: number; severeSoft: number; clip: number; severeClip: number; dark: number }> = {
  relaxed: { soft: 0.12, severeSoft: 0.02, clip: 0.12, severeClip: 0.35, dark: 38 },
  balanced: { soft: 0.2, severeSoft: 0.04, clip: 0.08, severeClip: 0.25, dark: 45 },
  strict: { soft: 0.3, severeSoft: 0.08, clip: 0.05, severeClip: 0.18, dark: 52 },
}

/** Blendshape eyeBlink at or above this on both eyes reads as closed. Smiles push it to about 0.3. */
const CLOSED = 0.55
const HALF = 0.42

function median(values: number[]): number {
  if (!values.length) return 0
  const s = [...values].sort((a, b) => a - b)
  const m = s.length >> 1
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

/** Faces that matter: the subject and people of similar size, not strangers in the back. */
export function subjectFaces(faces: FaceInfo[]): FaceInfo[] {
  if (!faces.length) return []
  const largest = Math.max(...faces.map((f) => f.area))
  return faces.filter((f) => f.area >= Math.max(0.0012, largest * 0.15))
}

function eyeClosedness(f: FaceInfo): number {
  return Math.min(f.blink[0], f.blink[1])
}

function eyeFocusOf(f: FaceInfo): number {
  return f.eyeSharp > 0 ? f.eyeSharp : f.faceSharp
}

interface Derived {
  p: EnginePhoto
  faces: FaceInfo[]
  eyeFocus: number | null
  frameFocus: number
  eyesScore: number | null
  closed: number
  half: number
  smile: number | null
  exposure: { score: number; over: boolean; under: boolean; severe: boolean; clipPct: number }
}

function derive(p: EnginePhoto, s: Strictness): Derived {
  const faces = subjectFaces(p.f.faces)
  const closed = faces.filter((f) => eyeClosedness(f) >= CLOSED).length
  const half = faces.filter((f) => eyeClosedness(f) >= HALF && eyeClosedness(f) < CLOSED).length
  const eyesScore = faces.length ? (faces.length - closed - half * 0.5) / faces.length : null
  const e = p.f.exposure
  const k = STRICT[s]
  let penalty = 0
  if (e.clipHigh > 0.02) penalty += Math.min(0.5, (e.clipHigh - 0.02) * 4)
  const under = e.mean < k.dark && e.p98 < 170
  if (under) penalty += 0.15 + (k.dark - e.mean) / 120
  if (e.clipLow > 0.3) penalty += 0.15
  return {
    p,
    faces,
    eyeFocus: faces.length ? Math.max(...faces.map(eyeFocusOf)) : null,
    frameFocus: p.f.sharp.p90,
    eyesScore,
    closed,
    half,
    smile: faces.length ? faces.reduce((a, f) => a + f.smile, 0) / faces.length : null,
    exposure: {
      score: 1 - Math.min(0.8, penalty),
      over: e.clipHigh > k.clip,
      under,
      severe: e.clipHigh > k.severeClip || e.mean < k.dark * 0.55,
      clipPct: Math.round(e.clipHigh * 100),
    },
  }
}

const pct = (v: number) => `${Math.max(1, Math.round(v * 100))}%`

/**
 * Screenshots and graphics are not camera photos: white app backgrounds would
 * read as blown highlights and crisp text would skew the shoot's focus
 * baseline. They are recognised by name, by the "Screenshot" tag phones and
 * Macs write, or by drawn pixels (exact flat areas, a small palette) in a
 * file with no camera information.
 */
export function graphicKind(p: EnginePhoto): 'named' | 'tagged' | 'pixels' | null {
  const g = p.f.graphic
  if (!g) return null
  if (g.named) return 'named'
  if (g.tagged) return 'tagged'
  if (!p.f.camera && g.flat >= 0.6 && g.top16 >= 0.7) return 'pixels'
  return null
}

const GRAPHIC_REASON = {
  named: 'The file name marks it as a screenshot',
  tagged: 'The device marked it as a screenshot',
  pixels: 'Looks like a screenshot or graphic, not a camera photo',
} as const

function setAside(graphics: EnginePhoto[], byId: Map<string, Assessment>): Moment {
  const sorted = [...graphics].sort((a, b) => (a.f.captureTime ?? 0) - (b.f.captureTime ?? 0) || a.order - b.order)
  const moment: Moment = { id: 'screens', kind: 'graphics', photoIds: sorted.map((p) => p.id) }
  sorted.forEach((p, rank) => {
    byId.set(p.id, {
      id: p.id,
      momentId: moment.id,
      rank,
      score: 0,
      verdict: 'keep',
      needsLook: false,
      reasons: [
        { text: GRAPHIC_REASON[graphicKind(p)!], tone: 'info' },
        { text: 'Keeper leaves screenshots out of culling, so keep or reject them yourself', tone: 'info' },
      ],
      issues: ['screenshot'],
      focusRel: 1,
      eyes: 'none',
      faces: 0,
      closed: 0,
    })
  })
  return moment
}

export function cull(all: EnginePhoto[], settings: CullSettings): CullResult {
  const graphics = all.filter((p) => graphicKind(p) !== null)
  const photos = graphics.length ? all.filter((p) => graphicKind(p) === null) : all
  const moments = groupMoments(photos, settings.grouping)
  const k = STRICT[settings.strictness]
  const byPhoto = new Map(photos.map((p) => [p.id, p]))
  const derived = new Map(photos.map((p) => [p.id, derive(p, settings.strictness)]))

  // Shoot-wide baselines for the "soft" flag.
  const medFrame = median(photos.map((p) => p.f.sharp.p90))
  const medMax = median(photos.map((p) => p.f.sharp.max))
  const medEye = median([...derived.values()].map((d) => d.eyeFocus).filter((v): v is number => v !== null))

  const byId = new Map<string, Assessment>()

  for (const m of moments) {
    const ds = m.photoIds.map((id) => derived.get(id)!)
    const hasFaces = ds.some((d) => d.faces.length > 0)
    const maxFrame = Math.max(1e-6, ...ds.map((d) => d.frameFocus))
    const maxEye = Math.max(1e-6, ...ds.map((d) => d.eyeFocus ?? 0))
    const maxFaces = Math.max(0, ...ds.map((d) => d.faces.length))

    const scored = ds.map((d) => {
      const relFrame = Math.sqrt(Math.min(1, d.frameFocus / maxFrame))
      const relEye = d.eyeFocus !== null ? Math.sqrt(Math.min(1, d.eyeFocus / maxEye)) : null
      const focus = relEye !== null ? 0.7 * relEye + 0.3 * relFrame : relFrame * (hasFaces ? 0.8 : 1)
      const eyes = d.eyesScore ?? (hasFaces ? 0.5 : 1)
      const coverage = hasFaces && maxFaces ? d.faces.length / maxFaces : 1
      const smile = d.smile ?? 0.5
      const score = 0.5 * focus + 0.25 * eyes + 0.1 * d.exposure.score + 0.08 * coverage + 0.07 * smile
      // Raw focus ratio (not square-rooted) is what we report to people.
      const focusRatio = relEye !== null ? relEye * relEye : relFrame * relFrame
      return { d, score, focus, focusRatio }
    })
    scored.sort((a, b) => b.score - a.score || a.d.p.order - b.d.p.order)
    m.photoIds = scored.map((x) => x.d.p.id)

    const top = scored[0]
    const size = scored.length
    const second = scored[1]
    const twins =
      second !== undefined &&
      hamming(top.d.p.f.dhash, second.d.p.f.dhash) <= 6 &&
      (cosine(top.d.p.f.embedding, second.d.p.f.embedding) ?? 1) >= 0.96
    const closeCall = second !== undefined && top.score - second.score < 0.03 && !twins
    scored.forEach((x, rank) => {
      const { d } = x
      const issues: IssueCode[] = []
      const softVsShoot =
        d.frameFocus < k.soft * medFrame && (d.eyeFocus === null || medEye === 0 || d.eyeFocus < k.soft * medEye)
      const severeSoft =
        d.frameFocus < k.severeSoft * medFrame &&
        d.p.f.sharp.max < k.severeSoft * 2.5 * medMax &&
        (d.eyeFocus === null || medEye === 0 || d.eyeFocus < k.severeSoft * medEye)
      if (softVsShoot || (size > 1 && x.focusRatio < 0.35)) issues.push('soft')
      if (d.faces.length && d.closed === d.faces.length) issues.push('eyes-closed')
      else if (d.closed > 0) issues.push('blink')
      if (d.exposure.over) issues.push('overexposed')
      if (d.exposure.under) issues.push('underexposed')

      const best = byPhoto.get(top.d.p.id)!
      if (rank > 0) {
        const ham = hamming(best.f.dhash, d.p.f.dhash)
        const sim = cosine(best.f.embedding, d.p.f.embedding)
        if (ham <= 4 && (sim === null || sim >= 0.97)) issues.push('duplicate')
      }

      const severe = severeSoft || d.exposure.severe || (d.faces.length > 0 && d.closed === d.faces.length)
      let verdict: 'keep' | 'reject'
      let needsLook = false
      const reasons: Reason[] = []

      if (rank === 0) {
        if (size === 1 && severe && settings.strictness !== 'relaxed') {
          verdict = 'reject'
        } else {
          verdict = 'keep'
          if (severe) needsLook = true
        }
      } else if (rank < settings.picksPerMoment) {
        verdict = !severe && x.score >= top.score * 0.8 ? 'keep' : 'reject'
      } else {
        verdict = 'reject'
      }
      // A close second deserves a human look, unless the two frames are near
      // identical (a fast burst): then either one is the same photo.
      if (rank === 0 && closeCall) needsLook = true
      if (rank === 1 && closeCall) needsLook = true
      if (size === 1 && softVsShoot && !severe) needsLook = true

      // Reasons, most important first.
      if (rank === 0) {
        if (size > 1) reasons.push({ text: `Best of ${size} similar shots`, tone: 'good' })
        else reasons.push({ text: 'Only frame of this moment', tone: 'info' })
        if (severe && size > 1) reasons.push({ text: 'Every frame in this set has a problem', tone: 'bad' })
        if (size > 1 && d.eyeFocus !== null && d.eyeFocus >= maxEye * 0.999) {
          reasons.push({ text: `Sharpest eyes of the ${size}`, tone: 'good' })
        } else if (size > 1 && d.frameFocus >= maxFrame * 0.999) {
          reasons.push({ text: `Sharpest of the ${size}`, tone: 'good' })
        }
      } else {
        const why = lossReason(x, top, d)
        reasons.push({ text: `${top.d.p.name} is better: ${why}`, tone: 'bad' })
      }
      if (d.faces.length) {
        if (d.closed === 0 && d.half === 0) {
          reasons.push({ text: d.faces.length === 1 ? 'Eyes open' : `All ${d.faces.length} people have eyes open`, tone: 'good' })
        } else if (d.closed === d.faces.length) {
          reasons.push({ text: d.faces.length === 1 ? 'Eyes closed' : 'Everyone has eyes closed', tone: 'bad' })
        } else if (d.closed > 0) {
          reasons.push({ text: `${d.closed} of ${d.faces.length} people have eyes closed`, tone: 'bad' })
        } else {
          reasons.push({ text: d.half === 1 && d.faces.length === 1 ? 'Eyes half closed' : `${d.half} of ${d.faces.length} people mid-blink`, tone: 'bad' })
        }
      }
      if (issues.includes('soft')) {
        reasons.push({
          text: size > 1 && rank > 0 ? `Softer focus (${pct(x.focusRatio)} as sharp as the best)` : 'Soft focus compared with the rest of the shoot',
          tone: 'bad',
        })
      }
      if (d.exposure.over) reasons.push({ text: `Blown highlights (${d.exposure.clipPct}% of the frame)`, tone: 'bad' })
      if (d.exposure.under) reasons.push({ text: 'Underexposed', tone: 'bad' })
      if (issues.includes('duplicate')) reasons.push({ text: `Near duplicate of ${top.d.p.name}`, tone: 'info' })
      if (needsLook && rank <= 1 && closeCall) {
        reasons.push({ text: rank === 0 ? `Close call with ${scored[1].d.p.name}` : `Close call with ${top.d.p.name}`, tone: 'info' })
      }

      byId.set(d.p.id, {
        id: d.p.id,
        momentId: m.id,
        rank,
        score: Math.round(x.score * 1000) / 1000,
        verdict,
        needsLook,
        reasons: dedupe(reasons),
        issues,
        focusRel: Math.round(x.focusRatio * 100) / 100,
        eyes: d.faces.length === 0 ? 'none' : d.closed === d.faces.length ? 'closed' : d.closed + d.half > 0 ? 'some-closed' : 'open',
        faces: d.faces.length,
        closed: d.closed,
      })
    })
  }
  if (graphics.length) moments.push(setAside(graphics, byId))
  return { moments, byId }
}

function lossReason(
  x: { d: Derived; focusRatio: number; focus: number },
  top: { d: Derived; focus: number },
  d: Derived,
): string {
  const eyeGap = (top.d.eyesScore ?? 1) - (d.eyesScore ?? 1)
  if (eyeGap >= 0.3) return d.closed ? 'eyes closed here' : 'someone is mid-blink here'
  if (top.focus - x.focus >= 0.08) return `sharper (this one is ${pct(x.focusRatio)} as sharp)`
  if (top.d.faces.length > d.faces.length) return 'more faces visible'
  if (top.d.exposure.score - d.exposure.score >= 0.1) return 'better exposed'
  if ((top.d.smile ?? 0) - (d.smile ?? 0) >= 0.15) return 'better expressions'
  return 'slightly better overall'
}

function dedupe(reasons: Reason[]): Reason[] {
  const seen = new Set<string>()
  return reasons.filter((r) => (seen.has(r.text) ? false : (seen.add(r.text), true)))
}
