// Responsive + map-interaction QA across window sizes: India fully visible
// beside the panel, drag-pan works in all four directions, panel collapses,
// dossier and Ask-the-map fit. Requires `npm run dev` (+ backend on 8765).
//   node scripts/qa_responsive.mjs [outDir]
import { chromium } from 'playwright-core'
import { mkdirSync } from 'node:fs'

const out = process.argv[2] ?? 'qa-screens'
mkdirSync(out, { recursive: true })
const sizes = [
  [900, 600],
  [1024, 700],
  [1280, 720],
  [1366, 768],
  [1440, 900],
  [1920, 1080],
]
const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] })
let failures = 0
const ok = (label, cond) => {
  if (!cond) failures++
  console.log(cond ? 'PASS' : 'FAIL', label)
}

for (const [w, h] of sizes) {
  const page = await browser.newPage({ viewport: { width: w, height: h } })
  const errors = []
  page.on('pageerror', (e) => errors.push(String(e)))
  await page.goto('http://127.0.0.1:1420/')
  await page.waitForFunction(() => !document.querySelector('.intro button')?.hasAttribute('disabled'))
  await page.waitForTimeout(3500)
  if (w === 900 || w === 1440) await page.screenshot({ path: `${out}/r-${w}-intro.png` })
  const introFits = await page.evaluate(() => {
    const b = document.querySelector('.intro .btn--primary').getBoundingClientRect()
    return b.bottom <= window.innerHeight + 400 && b.right <= window.innerWidth
  })
  ok(`${w}x${h} intro button reachable`, introFits)
  await page.getByRole('button', { name: 'Enter India' }).click()
  await page.waitForSelector('.maplibregl-canvas')
  await page.waitForTimeout(1800)

  // India beside the panel (west tip + east tip on screen, west tip not under the panel)
  const geo = await page.evaluate(() => {
    const m = window.__unheardMap
    const rect = m.getContainer().getBoundingClientRect()
    const rail = document.getElementById('rail')
    const railOpen = rail.getAttribute('data-open') !== 'false'
    const railRight = railOpen ? rail.getBoundingClientRect().right - rect.left : 0
    const west = m.project([68.8, 23.5])
    const east = m.project([96.5, 28])
    const south = m.project([77.5, 8.2])
    return { railRight, west: west.x, east: east.x, south: south.y, w: rect.width, h: rect.height, railOpen }
  })
  ok(`${w}x${h} India west edge clear of panel (${Math.round(geo.west)} > ${Math.round(geo.railRight)})`, geo.west > geo.railRight - 5)
  ok(`${w}x${h} India east edge on screen`, geo.east < geo.w + 5)
  ok(`${w}x${h} India south tip on screen`, geo.south < geo.h + 5)

  // drag-pan in all four directions
  const box = await page.locator('.map').boundingBox()
  const cx = box.x + Math.max(geo.railRight + 40, box.width * 0.6)
  const cy = box.y + box.height / 2
  const center = () => page.evaluate(() => window.__unheardMap.getCenter())
  const drag = async (dx, dy) => {
    await page.mouse.move(cx, cy)
    await page.mouse.down()
    await page.mouse.move(cx + dx / 2, cy + dy / 2, { steps: 5 })
    await page.mouse.move(cx + dx, cy + dy, { steps: 5 })
    await page.mouse.up()
    await page.waitForTimeout(700)
  }
  for (const [dx, dy, label, check] of [
    [200, 0, 'right', (a, b) => b.lng < a.lng - 0.5],
    [-200, 0, 'left', (a, b) => b.lng > a.lng + 0.5],
    [0, 150, 'down', (a, b) => b.lat > a.lat + 0.5],
    [0, -150, 'up', (a, b) => b.lat < a.lat - 0.5],
  ]) {
    const a = await center()
    await drag(dx, dy)
    const b = await center()
    ok(`${w}x${h} drag ${label} pans map`, check(a, b))
  }

  // collapse / expand panel
  if (geo.railOpen) {
    await page.getByRole('button', { name: 'Hide side panel' }).click()
    await page.waitForTimeout(400)
    ok(`${w}x${h} panel hides`, (await page.locator('#rail').getAttribute('data-open')) === 'false')
    await page.getByRole('button', { name: 'Show side panel' }).click()
    await page.waitForTimeout(400)
    ok(`${w}x${h} panel shows again`, (await page.locator('#rail').getAttribute('data-open')) === 'true')
  } else {
    await page.getByRole('button', { name: 'Show side panel' }).click()
    await page.waitForTimeout(400)
  }

  // Ask the map panel + dossier fit
  await page.getByRole('button', { name: /Ask the map/ }).click()
  await page.waitForTimeout(400)
  if (w === 900 || w === 1280) await page.screenshot({ path: `${out}/r-${w}-ask.png` })
  await page.getByRole('button', { name: 'Close' }).click()
  await page.locator('.rankrow').first().click()
  await page.waitForSelector('.dossier')
  await page.waitForTimeout(900)
  const dos = await page.evaluate(() => {
    const r = document.querySelector('.dossier').getBoundingClientRect()
    return r.right <= window.innerWidth + 1 && r.width >= 280
  })
  ok(`${w}x${h} dossier fits window`, dos)
  if (w === 900 || w === 1280) await page.screenshot({ path: `${out}/r-${w}-dossier.png` })
  ok(`${w}x${h} no page errors`, errors.length === 0)
  if (errors.length) console.log(errors)
  await page.close()
}
console.log(failures ? `${failures} FAILURE(S)` : 'ALL PASS')
await browser.close()
