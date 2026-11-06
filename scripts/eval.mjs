#!/usr/bin/env node
/**
 * Measures how closely Keepers' picks match a photographer's own picks.
 *
 *   npm run eval -- --shoot ~/Pictures/smith-wedding --picks ~/Pictures/smith-wedding/selects
 *   npm run eval -- --shoot ./shoot --picks picks.txt
 *   npm run eval -- --shoot ./shoot --xmp-min-rating 1
 *
 * --picks accepts a folder (every file in it is a pick, matched by name
 * without extension, so exported JPEGs match their RAW originals) or a text
 * file of names separated by commas or new lines. --xmp-min-rating reads
 * Lightroom star ratings from .xmp sidecars in the shoot folder instead.
 *
 * It runs the real app pipeline in headless Chromium (Playwright), then
 * writes eval-output/report.md and report.json. Nothing leaves your computer.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { basename, extname, join, relative, resolve } from 'node:path'
import { parseArgs } from 'node:util'

const { values: args } = parseArgs({
  options: {
    shoot: { type: 'string' },
    picks: { type: 'string' },
    'xmp-min-rating': { type: 'string' },
    'picks-per-moment': { type: 'string', default: '1' },
    strictness: { type: 'string', default: 'balanced' },
    grouping: { type: 'string', default: 'normal' },
    workers: { type: 'string', default: '3' },
    out: { type: 'string', default: 'eval-output' },
  },
})

function fail(message) {
  console.error(`\n${message}\n\nUsage: npm run eval -- --shoot <folder> (--picks <folder|file> | --xmp-min-rating <n>)\n`)
  process.exit(1)
}

if (!args.shoot) fail('Missing --shoot.')
if (!args.picks && !args['xmp-min-rating']) fail('Give the photographer picks with --picks or --xmp-min-rating.')

const PHOTO = /\.(jpe?g|png|webp|heic|heif|hif|cr2|cr3|crw|nef|nrw|arw|srf|sr2|dng|raf|orf|rw2|pef|srw)$/i
const stem = (name) => basename(name, extname(name)).toLowerCase()

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (name.startsWith('.')) continue
    const full = join(dir, name)
    const st = statSync(full)
    if (st.isDirectory()) walk(full, out)
    else out.push(full)
  }
  return out
}

const shootDir = resolve(args.shoot)
if (!existsSync(shootDir)) fail(`Shoot folder not found: ${shootDir}`)
const picksDir = args.picks && existsSync(args.picks) && statSync(args.picks).isDirectory() ? resolve(args.picks) : null
const shootFiles = walk(shootDir).filter((f) => PHOTO.test(f) && !(picksDir && f.startsWith(picksDir)))
if (!shootFiles.length) fail('No photos found in the shoot folder.')

// Photographer picks, as lowercase file stems.
const picks = new Set()
if (args['xmp-min-rating']) {
  const min = Number(args['xmp-min-rating'])
  for (const f of walk(shootDir).filter((f) => /\.xmp$/i.test(f))) {
    const xml = readFileSync(f, 'utf8')
    const m = /xmp:Rating(?:="|>)(-?\d+)/.exec(xml)
    if (m && Number(m[1]) >= min) picks.add(stem(f))
  }
} else if (picksDir) {
  for (const f of walk(picksDir)) if (PHOTO.test(f)) picks.add(stem(f))
} else {
  for (const name of readFileSync(args.picks, 'utf8').split(/[\n,]+/)) if (name.trim()) picks.add(stem(name.trim()))
}
if (!picks.size) fail('No picks found. Check the --picks path or the ratings in your sidecars.')

console.log(`Shoot: ${shootFiles.length} files in ${shootDir}`)
console.log(`Photographer picks: ${picks.size}`)

const { createServer } = await import('vite')
const { chromium } = await import('playwright')

const server = await createServer({ server: { port: 0, host: '127.0.0.1', forwardConsole: false }, logLevel: 'error', clearScreen: false })
await server.listen()
const port = server.httpServer.address().port
const browser = await chromium.launch()
try {
  const page = await browser.newPage()
  const query = new URLSearchParams({
    workers: args.workers,
    picks: args['picks-per-moment'],
    strictness: args.strictness,
    grouping: args.grouping,
  })
  await page.goto(`http://127.0.0.1:${port}/dev/harness.html?${query}`)
  const started = Date.now()
  await page.setInputFiles('#files', shootFiles)
  let last = ''
  for (;;) {
    const text = await page.textContent('#out')
    if (text === 'done') break
    if (text !== last) {
      process.stdout.write(`\r${text}          `)
      last = text
    }
    await new Promise((r) => setTimeout(r, 500))
  }
  process.stdout.write('\n')
  const r = await page.evaluate(() => window.keeperResults)
  const seconds = (Date.now() - started) / 1000

  // Score: a photo is a pick if any of its files (RAW or JPEG) matches.
  const isPick = (v) => [v.name, ...v.files].some((n) => picks.has(stem(n)))
  let tp = 0
  let fp = 0
  let fn = 0
  let tn = 0
  const moments = new Map()
  for (const v of r.verdicts) {
    const pick = isPick(v)
    const keep = v.verdict === 'keep'
    if (keep && pick) tp++
    else if (keep && !pick) fp++
    else if (!keep && pick) fn++
    else tn++
    const m = moments.get(v.momentId) ?? { picks: 0, hit: false }
    if (pick) m.picks++
    if (pick && keep) m.hit = true
    moments.set(v.momentId, m)
  }
  const pickedMoments = [...moments.values()].filter((m) => m.picks > 0)
  const hitRate = pickedMoments.length ? pickedMoments.filter((m) => m.hit).length / pickedMoments.length : 0
  const precision = tp + fp ? tp / (tp + fp) : 0
  const recall = tp + fn ? tp / (tp + fn) : 0
  const f1 = precision + recall ? (2 * precision * recall) / (precision + recall) : 0
  const rejectAgreement = tn + fp ? tn / (tn + fp) : 0
  const keepCount = tp + fp
  const pct = (v) => `${(v * 100).toFixed(1)}%`

  const report = {
    date: new Date().toISOString(),
    shoot: relative(process.cwd(), shootDir) || shootDir,
    settings: r.settings,
    photos: r.verdicts.length,
    unreadable: r.errors.length,
    moments: r.moments,
    photographerPicks: picks.size,
    keeperKeeps: keepCount,
    precision,
    recall,
    f1,
    momentHitRate: hitRate,
    rejectAgreement,
    secondsTotal: seconds,
    photosPerSecond: r.verdicts.length / (r.analysisMs / 1000),
    workers: r.workers,
    visionModels: r.status.vision,
  }
  const md = `# Keepers accuracy report

Shoot: \`${report.shoot}\` (${report.photos} photos, ${report.moments} moments)
Settings: keep ${r.settings.picksPerMoment} per moment, ${r.settings.strictness} strictness, ${r.settings.grouping} grouping

| Metric | Value |
| --- | --- |
| Photographer picks | ${picks.size} |
| Keepers keeps | ${keepCount} |
| Moment hit rate (Keepers kept one of your picks) | ${pct(hitRate)} of ${pickedMoments.length} moments |
| Precision (Keepers keeps you also picked) | ${pct(precision)} |
| Recall (your picks Keepers also kept) | ${pct(recall)} |
| F1 | ${pct(f1)} |
| Reject agreement (your rejects Keepers also rejected) | ${pct(rejectAgreement)} |
| Analysis speed | ${report.photosPerSecond.toFixed(1)} photos/s with ${r.workers} workers |
| Unreadable files | ${r.errors.length} |
`
  mkdirSync(args.out, { recursive: true })
  writeFileSync(join(args.out, 'report.json'), JSON.stringify({ ...report, verdicts: r.verdicts, errors: r.errors }, null, 2))
  writeFileSync(join(args.out, 'report.md'), md)
  console.log(`\n${md}`)
  console.log(`Saved ${join(args.out, 'report.md')} and report.json`)
} finally {
  await browser.close()
  await server.close()
}
