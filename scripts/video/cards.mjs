// Renders the title and closing cards (1920x1080 PNG) with the product's fonts.
//   node scripts/video/cards.mjs submission/video-build
import { chromium } from 'playwright-core'
import { pathToFileURL } from 'node:url'
import { resolve, join } from 'node:path'
import { writeFileSync } from 'node:fs'

const build = resolve(process.argv[2] ?? 'submission/video-build')
const nm = resolve('node_modules/@fontsource')
const font = (pkg, file) => pathToFileURL(join(nm, pkg, 'files', file)).href
const intro = pathToFileURL(join(build, 'intro-frame.jpg')).href

const base = `
@font-face{font-family:'Instrument Serif';src:url(${font('instrument-serif', 'instrument-serif-latin-400-normal.woff2')})}
@font-face{font-family:'Geist Sans';src:url(${font('geist-sans', 'geist-sans-latin-400-normal.woff2')})}
@font-face{font-family:'Geist Sans';font-weight:600;src:url(${font('geist-sans', 'geist-sans-latin-600-normal.woff2')})}
@font-face{font-family:'Geist Mono';src:url(${font('geist-mono', 'geist-mono-latin-400-normal.woff2')})}
*{box-sizing:border-box;margin:0}
body{width:1920px;height:1080px;background:#000;color:#fff;font-family:'Geist Sans';overflow:hidden;position:relative}
.kicker{font-family:'Geist Mono';font-size:20px;letter-spacing:.14em;text-transform:uppercase;color:#858990}
.serif{font-family:'Instrument Serif';font-weight:400}
.accent{color:#ff7a17}
`

const title = `<style>${base}
.bg{position:absolute;top:0;bottom:0;right:0;width:46%;background:url(${intro}) right center/auto 100% no-repeat;opacity:.75;filter:saturate(1.15)}
.shade{position:absolute;inset:0;background:linear-gradient(90deg,#000 54%,rgba(0,0,0,.35) 64%,rgba(0,0,0,0) 80%),linear-gradient(0deg,#000 0%,rgba(0,0,0,.85) 16%,rgba(0,0,0,0) 34%)}
.wrap{position:absolute;left:120px;top:150px;width:1000px}
h1{font-size:230px;line-height:.85;margin:26px 0 18px;letter-spacing:-.02em}
.tag{font-size:58px;color:#dadbdf}
.notes{position:absolute;left:120px;bottom:90px;right:120px;display:grid;grid-template-columns:repeat(4,1fr);gap:28px;border-top:1px solid #7d8187;padding-top:26px}
.notes div{font-size:20px;line-height:1.45;color:#dadbdf}
.notes b{display:block;font-family:'Geist Mono';font-weight:400;font-size:15px;letter-spacing:.12em;text-transform:uppercase;color:#ffc285;margin-bottom:8px}
</style>
<div class="bg"></div><div class="shade"></div>
<div class="wrap">
  <p class="kicker">Build with AI: Code for Communities · Second Edition</p>
  <h1 class="serif">Unheard</h1>
  <p class="tag serif">Finding the needs no one reported.</p>
</div>
<div class="notes">
  <div><b>What you will see</b>A screen recording of the working Windows desktop prototype.</div>
  <div><b>Google AI</b>Every AI response shown is a live Google Gemini call, made during this recording.</div>
  <div><b>Data</b>NFHS-5 (2019–21) and Census 2011 for 705 districts. The citizen-demand baseline is a SYNTHETIC demonstration signal.</div>
  <div><b>Narration</b>Voiced with Gemini text-to-speech.</div>
</div>`

const close = `<style>${base}
.wrap{position:absolute;left:120px;top:130px;right:120px}
h1{font-size:170px;line-height:.9;margin:24px 0 10px}
.tag{font-size:48px;color:#dadbdf}
.cols{display:grid;grid-template-columns:repeat(3,1fr);gap:48px;margin-top:80px;border-top:1px solid #7d8187;padding-top:34px}
.cols h3{font-family:'Instrument Serif';font-weight:400;font-size:46px;line-height:1.05;margin-bottom:14px}
.cols p{font-size:22px;line-height:1.5;color:#dadbdf}
.honest{position:absolute;left:120px;right:120px;bottom:140px;font-size:19px;line-height:1.5;color:#858990}
.foot{position:absolute;left:120px;right:120px;bottom:80px;display:flex;justify-content:space-between;font-family:'Geist Mono';font-size:19px;letter-spacing:.06em;color:#858990}
.foot span:last-child{color:#ffc285}
</style>
<div class="wrap">
  <p class="kicker">Unheard · civic intelligence prototype</p>
  <h1 class="serif">Hear the quiet districts.</h1>
  <p class="tag serif">High need + low reported demand = <span class="accent">potential unheard need.</span></p>
  <div class="cols">
    <div><h3>Gemini for understanding</h3><p>Multilingual voice and text intake, place and urgency extraction, natural-language map queries, grounded explanations and policy briefs.</p></div>
    <div><h3>Deterministic scoring for trust</h3><p>The Unheard Index is computed by code from public indicators, never by the AI. Every number is shown with its source and year.</p></div>
    <div><h3>Built to scale</h3><p>State-agnostic schema; production path on Cloud Run, Vertex AI, BigQuery and Firebase; adaptable to any country with DHS-style survey data.</p></div>
  </div>
</div>
<p class="honest">Screen recording of the working Windows desktop prototype. AI responses shown are live Google Gemini calls made during the recording; the citizen-demand baseline is a synthetic demonstration signal; simulated values are projections. Voiceover: Gemini text-to-speech.</p>
<div class="foot"><span>705 districts · 14 indicators · Tauri · React · FastAPI · Google Gemini · MIT licence</span><span>github.com/Mahi-KK/Project-Unheard</span></div>`

const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--allow-file-access-from-files'] })
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } })
for (const [name, html] of [['title', title], ['close', close]]) {
  const file = join(build, `${name}.html`)
  writeFileSync(file, `<!doctype html><html><head><meta charset="utf-8"></head><body>${html}</body></html>`)
  await page.goto(pathToFileURL(file).href, { waitUntil: 'load' })
  await page.evaluate(() => document.fonts.ready)
  await page.waitForTimeout(300)
  await page.screenshot({ path: join(build, `${name}.png`) })
  console.log('card', name)
}
await browser.close()
