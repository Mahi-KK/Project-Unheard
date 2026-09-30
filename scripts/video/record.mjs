// Records the REAL desktop app (Unheard.exe) for the demo video.
// Launch the app first with:
//   $env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS="--remote-debugging-port=9333"; .\unheard.exe
// then:  node scripts/video/record.mjs submission/video-build
// Captures WebView2 screencast frames (1920x1080) + a segment timeline that
// matches scripts/video/narration.json. All AI calls are live.
import { chromium } from 'playwright-core'
import { mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'

const build = process.argv[2] ?? 'submission/video-build'
const TEMPO = 1.18
const durations = JSON.parse(readFileSync(join(build, 'durations.json'), 'utf8'))
const framesDir = join(build, 'frames')
rmSync(framesDir, { recursive: true, force: true })
mkdirSync(framesDir, { recursive: true })

const browser = await chromium.connectOverCDP('http://127.0.0.1:9333')
const page = browser.contexts()[0].pages()[0]
const cdp = await page.context().newCDPSession(page)
await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1600, height: 900, deviceScaleFactor: 1.2, mobile: false })
await page.reload()

// ------------------------------------------------------------------ screencast
const frames = []
let n = 0
cdp.on('Page.screencastFrame', async (f) => {
  const file = `${String(n++).padStart(6, '0')}.jpg`
  writeFileSync(join(framesDir, file), Buffer.from(f.data, 'base64'))
  frames.push({ file, t: f.metadata.timestamp })
  try {
    await cdp.send('Page.screencastFrameAck', { sessionId: f.sessionId })
  } catch {}
})

// ------------------------------------------------------------------ visible cursor
const CURSOR_CSS = `
#demo-cursor{position:fixed;z-index:2147483647;left:0;top:0;width:22px;height:22px;pointer-events:none;
  transform:translate(-3px,-2px);transition:left .55s cubic-bezier(.2,0,0,1),top .55s cubic-bezier(.2,0,0,1)}
#demo-cursor svg{filter:drop-shadow(0 1px 2px rgba(0,0,0,.5))}
.demo-click{position:fixed;z-index:2147483646;width:34px;height:34px;margin:-17px 0 0 -17px;border-radius:50%;
  border:2px solid #ff7a17;pointer-events:none;animation:demo-click .5s ease-out forwards}
@keyframes demo-click{from{transform:scale(.3);opacity:1}to{transform:scale(1.4);opacity:0}}`
async function ensureCursor() {
  await page.evaluate((css) => {
    if (document.getElementById('demo-cursor')) return
    const st = document.createElement('style')
    st.textContent = css
    document.head.appendChild(st)
    const c = document.createElement('div')
    c.id = 'demo-cursor'
    c.innerHTML = '<svg width="22" height="22" viewBox="0 0 22 22"><path d="M2 1l16 9-7 1.6L7.5 19z" fill="#fff" stroke="#000" stroke-width="1.4" stroke-linejoin="round"/></svg>'
    c.style.left = '800px'
    c.style.top = '450px'
    document.body.appendChild(c)
  }, CURSOR_CSS)
}
let cur = { x: 800, y: 450 }
async function moveTo(x, y) {
  await ensureCursor()
  await page.evaluate(({ x, y }) => {
    const c = document.getElementById('demo-cursor')
    c.style.left = x + 'px'
    c.style.top = y + 'px'
  }, { x, y })
  await page.mouse.move(x, y, { steps: 12 })
  cur = { x, y }
  await page.waitForTimeout(600)
}
async function pointAt(locator) {
  const b = await locator.boundingBox()
  if (!b) throw new Error('not visible: ' + locator)
  await moveTo(b.x + b.width / 2, b.y + b.height / 2)
  return b
}
async function click(locator) {
  await locator.scrollIntoViewIfNeeded()
  await pointAt(locator)
  await page.evaluate(({ x, y }) => {
    const r = document.createElement('div')
    r.className = 'demo-click'
    r.style.left = x + 'px'
    r.style.top = y + 'px'
    document.body.appendChild(r)
    setTimeout(() => r.remove(), 600)
  }, cur)
  await page.mouse.click(cur.x, cur.y)
  await page.waitForTimeout(250)
}
const sleep = (ms) => page.waitForTimeout(ms)

// ------------------------------------------------------------------ segments
const timeline = []
async function segment(id, actions) {
  const start = Date.now() / 1000
  const target = durations[id] / TEMPO + 0.7
  console.log(`▶ ${id} (${target.toFixed(1)}s)`)
  await actions()
  const spent = Date.now() / 1000 - start
  if (spent < target) await sleep((target - spent) * 1000)
  timeline.push({ id, start, end: Date.now() / 1000 })
  if (spent > target) console.log(`  (actions ran ${(spent - target).toFixed(1)}s past narration)`)
}

await page.waitForFunction(() => !document.querySelector('.intro button')?.hasAttribute('disabled'), null, { timeout: 30000 })
await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 88, maxWidth: 1920, maxHeight: 1080, everyNthFrame: 1 })
await ensureCursor()
await sleep(800)

await segment('s01_intro', async () => {
  await sleep(durations.s01_intro / TEMPO * 1000 - 3600)
  await click(page.getByRole('button', { name: 'Enter India' }))
})

await segment('s02_demand', async () => {
  await page.waitForSelector('.maplibregl-canvas')
  await sleep(1800)
  const night = page.getByRole('radio', { name: 'Night' })
  if ((await night.getAttribute('aria-checked')) !== 'true') await click(night)
  const map = await page.locator('.map').boundingBox()
  for (const [fx, fy] of [[0.46, 0.3], [0.52, 0.38], [0.6, 0.45], [0.5, 0.62]]) {
    await moveTo(map.x + map.width * fx, map.y + map.height * fy)
    await sleep(900)
  }
  await pointAt(page.locator('.legend'))
})

await segment('s03_capture', async () => {
  await click(page.getByRole('button', { name: 'Capture request' }))
  await sleep(700)
  await click(page.getByRole('button', { name: /Kannada/ }))
  await sleep(900)
  await click(page.getByRole('button', { name: 'Analyse with Gemini' }))
  await page.waitForSelector('.analysis, .state--error', { timeout: 60000 })
  if (await page.locator('.state--error').count()) {
    await sleep(3000)
    await click(page.getByRole('button', { name: 'Analyse with Gemini' }))
    await page.waitForSelector('.analysis', { timeout: 60000 })
  }
  await sleep(400)
  await page.locator('.analysis').scrollIntoViewIfNeeded()
  await pointAt(page.locator('.analysis .kv dd').nth(3))
})

await segment('s04_commit', async () => {
  await click(page.getByRole('button', { name: 'Add to signal layer' }))
  await page.waitForSelector('.delta', { timeout: 30000 })
  await page.locator('.delta').scrollIntoViewIfNeeded()
  await pointAt(page.locator('.delta'))
  await sleep(4000)
  await pointAt(page.locator('.triad'))
})

await segment('s05_reveal', async () => {
  await click(page.getByRole('button', { name: /Close dossier/ }))
  await click(page.locator('.panel').getByRole('button', { name: 'Close' }))
  await sleep(400)
  await click(page.getByRole('radio', { name: /^All categories/ }))
  await click(page.getByRole('button', { name: /Reveal unheard/i }))
  await sleep(5200)
  const m = page.locator('.rank-marker').first()
  if (await m.count()) await pointAt(m)
  await sleep(1200)
  await pointAt(page.locator('.figures'))
})

await segment('s06_dossier', async () => {
  await click(page.locator('.rankrow').first())
  await sleep(1500)
  await pointAt(page.locator('.formula'))
  await sleep(2500)
  const d = await page.locator('.dossier').boundingBox()
  await moveTo(d.x + d.width / 2, d.y + d.height * 0.6)
  for (let i = 0; i < 7; i++) {
    await page.mouse.wheel(0, 260)
    await sleep(650)
  }
})

await segment('s07_explain', async () => {
  const btn = page.getByRole('button', { name: 'Explain with Gemini' })
  await btn.scrollIntoViewIfNeeded()
  await click(btn)
  await page.waitForSelector('section[aria-labelledby="sec-why"] .why, section[aria-labelledby="sec-why"] .state--error', { timeout: 60000 })
  if (await page.locator('section[aria-labelledby="sec-why"] .state--error').count()) {
    await sleep(3000)
    await click(page.locator('section[aria-labelledby="sec-why"]').getByRole('button', { name: 'Retry' }))
    await page.waitForSelector('section[aria-labelledby="sec-why"] .why', { timeout: 60000 })
  }
  await page.locator('section[aria-labelledby="sec-why"]').scrollIntoViewIfNeeded()
  await pointAt(page.locator('.why__headline'))
  await sleep(1500)
  await pointAt(page.locator('.why__drivers li').first())
})

await segment('s08_whatif', async () => {
  await page.locator('#sec-whatif').scrollIntoViewIfNeeded()
  await sleep(600)
  await pointAt(page.locator('#wi-cat'))
  await page.locator('#wi-cat').selectOption('sanitation')
  await sleep(800)
  const slider = page.locator('#wi-fac')
  await pointAt(slider)
  for (let v = 5; v <= 40; v += 5) {
    await slider.fill(String(v))
    await sleep(260)
  }
  await sleep(600)
  await page.locator('.flow').scrollIntoViewIfNeeded()
  await pointAt(page.locator('.flow__col--out'))
})

await segment('s09_brief', async () => {
  const btn = page.getByRole('button', { name: 'Generate policy brief' })
  await btn.scrollIntoViewIfNeeded()
  await click(btn)
  await page.waitForSelector('.brief__doc, #policy-brief .state--error', { timeout: 90000 })
  if (await page.locator('#policy-brief .state--error').count()) {
    await sleep(3000)
    await click(page.getByRole('button', { name: 'Generate policy brief' }))
    await page.waitForSelector('.brief__doc', { timeout: 90000 })
  }
  await page.locator('.brief__doc').scrollIntoViewIfNeeded()
  const d = await page.locator('.dossier').boundingBox()
  await moveTo(d.x + d.width / 2, d.y + d.height * 0.55)
  for (let i = 0; i < 5; i++) {
    await page.mouse.wheel(0, 240)
    await sleep(700)
  }
})

await segment('s10_ask', async () => {
  await click(page.getByRole('button', { name: /Close dossier/ }))
  await click(page.getByRole('button', { name: /Ask the map/ }))
  await sleep(500)
  await page.locator('#ask-input').type('Where is sanitation need high but reporting low in Odisha and Jharkhand?', { delay: 28 })
  await click(page.getByRole('button', { name: 'Ask', exact: true }))
  await page.waitForSelector('.askresult, .panel .state--error', { timeout: 60000 })
  await sleep(600)
  await pointAt(page.locator('.filterchips'))
  await sleep(1800)
  await pointAt(page.locator('.askresult .rankrow').first())
})

await segment('s11_views', async () => {
  await click(page.locator('.panel').getByRole('button', { name: 'Close' }))
  await click(page.getByRole('radio', { name: /Need/ }))
  await sleep(1400)
  await click(page.getByRole('radio', { name: /^Water/ }))
  await sleep(1800)
  await click(page.getByRole('radio', { name: /^Health/ }))
  await sleep(1800)
  await click(page.getByRole('radio', { name: 'Day' }))
  await sleep(1800)
  await click(page.getByRole('radio', { name: 'Night' }))
  await click(page.getByRole('radio', { name: /^All categories/ }))
  await click(page.getByRole('radio', { name: /Unheard/ }))
})

await cdp.send('Page.stopScreencast')
writeFileSync(join(build, 'timeline.json'), JSON.stringify({ tempo: TEMPO, frames, segments: timeline }, null, 1))
console.log(`frames ${frames.length}, recorded ${(timeline.at(-1).end - timeline[0].start).toFixed(1)}s`)
await browser.close()
