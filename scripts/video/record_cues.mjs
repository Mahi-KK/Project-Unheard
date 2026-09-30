// Records the REAL desktop app for the demo video, logging a cue at every
// on-screen event so the voiceover can be placed exactly on the action.
// Launch the app first with:
//   $env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS="--remote-debugging-port=9333"; .\unheard.exe
// then:  node scripts/video/record_cues.mjs submission/video-build
// Output: <build>/frames/*.jpg + <build>/cues.json  (all AI calls are live)
import { chromium } from 'playwright-core'
import { mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'

const build = process.argv[2] ?? 'submission/video-build'
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
  transform:translate(-3px,-2px);transition:left .6s cubic-bezier(.2,0,0,1),top .6s cubic-bezier(.2,0,0,1)}
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
    c.style.left = '1250px'
    c.style.top = '700px'
    document.body.appendChild(c)
  }, CURSOR_CSS)
}
let cur = { x: 1250, y: 700 }
async function moveTo(x, y) {
  await ensureCursor()
  await page.evaluate(({ x, y }) => {
    const c = document.getElementById('demo-cursor')
    c.style.left = x + 'px'
    c.style.top = y + 'px'
  }, { x, y })
  await page.mouse.move(x, y, { steps: 12 })
  cur = { x, y }
  await page.waitForTimeout(650)
}
async function pointAt(locator) {
  const b = await locator.boundingBox()
  if (!b) throw new Error('not visible')
  await moveTo(b.x + b.width / 2, b.y + b.height / 2)
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
async function center(locator) {
  await locator.evaluate((el) => el.scrollIntoView({ block: 'center', behavior: 'smooth' }))
  await sleep(900)
}

// ------------------------------------------------------------------ cues
// Each cue: when the event happened, when its actions settled (after that the
// screen is idle and may be trimmed), and whether it is an AI wait.
const cues = []
const now = () => Date.now() / 1000
async function cue(name, actions = async () => {}, { dwell = 6, wait = false } = {}) {
  const t = now()
  await actions()
  const settle = now()
  await sleep(dwell * 1000)
  cues.push({ name, t, settle, wait })
  console.log(`cue ${name.padEnd(12)} actions ${(settle - t).toFixed(1)}s`)
}
async function aiWait(selector, errSelector, retry) {
  await page.waitForSelector(`${selector}, ${errSelector}`, { timeout: 90000 })
  if (await page.locator(errSelector).count()) {
    await sleep(4000)
    await retry()
    await page.waitForSelector(selector, { timeout: 90000 })
  }
}

await page.waitForFunction(() => !document.querySelector('.intro button')?.hasAttribute('disabled'), null, { timeout: 30000 })
await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 90, maxWidth: 1920, maxHeight: 1080, everyNthFrame: 1 })
await ensureCursor()
await sleep(600)

const WHY = 'section[aria-labelledby="sec-why"]'

await cue('intro', async () => {}, { dwell: 9 })
await cue('intro_gap', async () => {}, { dwell: 9 })
await cue('enter', async () => {
  await click(page.getByRole('button', { name: 'Enter India' }))
  await page.waitForSelector('.maplibregl-canvas')
  await sleep(1800)
  const night = page.getByRole('radio', { name: 'Night' })
  if ((await night.getAttribute('aria-checked')) !== 'true') await click(night)
}, { dwell: 2 })
await cue('demand', async () => {
  const map = await page.locator('.map').boundingBox()
  for (const [fx, fy] of [[0.45, 0.32], [0.52, 0.4], [0.58, 0.5]]) {
    await moveTo(map.x + map.width * fx, map.y + map.height * fy)
    await sleep(700)
  }
  await pointAt(page.locator('.legend'))
}, { dwell: 8 })
await cue('request', async () => {
  await click(page.getByRole('button', { name: 'Capture request' }))
  await sleep(600)
  await click(page.getByRole('button', { name: /Kannada/ }))
  await pointAt(page.locator('#cap-text'))
}, { dwell: 5 })
await cue('analysing', async () => {
  await click(page.getByRole('button', { name: 'Analyse with Gemini' }))
  await aiWait('.analysis', '.panel .state--error', () => click(page.getByRole('button', { name: 'Analyse with Gemini' })))
}, { dwell: 0, wait: true })
await cue('analysed', async () => {
  await center(page.locator('.analysis .kv'))
  await pointAt(page.locator('.analysis .kv dd').nth(0))
  await sleep(900)
  await pointAt(page.locator('.analysis .kv dd').nth(4))
  await sleep(900)
  await pointAt(page.locator('.analysis .kv dd').nth(6))
}, { dwell: 5 })
await cue('commit', async () => {
  await click(page.getByRole('button', { name: 'Add to signal layer' }))
  await page.waitForSelector('.delta', { timeout: 30000 })
  await center(page.locator('.delta'))
  await pointAt(page.locator('.delta'))
}, { dwell: 8 })
await cue('reveal', async () => {
  await click(page.getByRole('button', { name: /Close dossier/ }))
  await click(page.locator('.panel').getByRole('button', { name: 'Close' }))
  await sleep(300)
  await click(page.getByRole('radio', { name: /^All categories/ }))
  await click(page.getByRole('button', { name: /Reveal unheard/i }))
}, { dwell: 1.2 })
await cue('reveal_need', async () => {}, { dwell: 1.4 })
await cue('reveal_done', async () => {
  await sleep(2600)
  const m = page.locator('.rank-marker').first()
  if (await m.count()) await pointAt(m)
}, { dwell: 7 })
await cue('dossier', async () => {
  await click(page.locator('.rankrow').first())
  await sleep(1400)
  await pointAt(page.locator('.formula'))
}, { dwell: 7 })
await cue('evidence', async () => {
  const d = await page.locator('.dossier').boundingBox()
  await moveTo(d.x + d.width / 2, d.y + d.height * 0.6)
  for (let i = 0; i < 5; i++) {
    await page.mouse.wheel(0, 260)
    await sleep(600)
  }
}, { dwell: 5 })
await cue('explaining', async () => {
  const btn = page.getByRole('button', { name: 'Explain with Gemini' })
  await btn.scrollIntoViewIfNeeded()
  await click(btn)
  await aiWait(`${WHY} .why`, `${WHY} .state--error`, () => click(page.locator(WHY).getByRole('button', { name: 'Retry' })))
}, { dwell: 0, wait: true })
await cue('explained', async () => {
  await center(page.locator('.why__headline'))
  await pointAt(page.locator('.why__headline'))
  await sleep(1200)
  await pointAt(page.locator('.why__drivers li').first())
}, { dwell: 9 })
await cue('whatif', async () => {
  await center(page.locator('#wi-cat'))
  await pointAt(page.locator('#wi-cat'))
  await page.locator('#wi-cat').selectOption('sanitation')
  await sleep(600)
  const slider = page.locator('#wi-fac')
  await pointAt(slider)
  for (let v = 5; v <= 40; v += 5) {
    await slider.fill(String(v))
    await sleep(240)
  }
}, { dwell: 1.5 })
await cue('projected', async () => {
  await center(page.locator('.flow'))
  await pointAt(page.locator('.flow__col--out'))
}, { dwell: 7 })
await cue('drafting', async () => {
  const btn = page.getByRole('button', { name: 'Generate policy brief' })
  await btn.scrollIntoViewIfNeeded()
  await click(btn)
  await aiWait('.brief__doc', '#policy-brief .state--error', () => click(page.getByRole('button', { name: 'Generate policy brief' })))
}, { dwell: 0, wait: true })
await cue('drafted', async () => {
  await center(page.locator('.brief__title'))
  const d = await page.locator('.dossier').boundingBox()
  await moveTo(d.x + d.width / 2, d.y + d.height * 0.55)
  for (let i = 0; i < 4; i++) {
    await page.mouse.wheel(0, 240)
    await sleep(700)
  }
}, { dwell: 5 })
await cue('asking', async () => {
  await click(page.getByRole('button', { name: /Close dossier/ }))
  await click(page.getByRole('button', { name: /Ask the map/ }))
  await sleep(400)
  await page.locator('#ask-input').type('Where is sanitation need high but reporting low in Odisha and Jharkhand?', { delay: 30 })
  await click(page.getByRole('button', { name: 'Ask', exact: true }))
  await aiWait('.askresult', '.panel .state--error', () => click(page.getByRole('button', { name: 'Ask', exact: true })))
}, { dwell: 0, wait: true })
await cue('answered', async () => {
  await sleep(500)
  await pointAt(page.locator('.filterchips'))
  await sleep(1500)
  await pointAt(page.locator('.askresult .rankrow').first())
}, { dwell: 8 })
cues.push({ name: 'end', t: now(), settle: now(), wait: false })

await cdp.send('Page.stopScreencast')
// record what the AI actually said, so the narration can describe it truthfully
const shown = await page.evaluate(() => ({ ask: document.querySelector('.askresult')?.innerText?.slice(0, 1500) }))
writeFileSync(join(build, 'cues.json'), JSON.stringify({ frames, cues, shown }, null, 1))
console.log(`frames ${frames.length}, recorded ${(cues.at(-1).t - cues[0].t).toFixed(1)}s`)
await browser.close()
