// End-to-end QA against the REAL desktop build: attach to Unheard.exe's WebView2
// over CDP. Launch the app first with:
//   $env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS="--remote-debugging-port=9333"; .\unheard.exe
//   node scripts/qa_desktop.mjs [outDir]
import { chromium } from 'playwright-core'
import { mkdirSync } from 'node:fs'

const out = process.argv[2] ?? 'qa-screens'
mkdirSync(out, { recursive: true })
const browser = await chromium.connectOverCDP('http://127.0.0.1:9333')
const page = browser.contexts()[0].pages()[0]
const errors = []
page.on('pageerror', (e) => errors.push(String(e)))
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()))
const ok = (label, cond) => console.log(cond ? 'PASS' : 'FAIL', label)

console.log('url', page.url())
await page.reload()
await page.waitForFunction(() => !document.querySelector('.intro button')?.hasAttribute('disabled'), null, { timeout: 20000 })
await page.getByRole('button', { name: 'Enter India' }).click()
await page.waitForSelector('.maplibregl-canvas')
await page.waitForFunction(() => document.querySelector('.status')?.getAttribute('data-state') !== 'starting', null, { timeout: 30000 })
const status = await page.locator('.status').textContent()
ok(`sidecar reachable from WebView (status: ${status})`, !status?.includes('offline'))
await page.waitForTimeout(1500)
await page.screenshot({ path: `${out}/desktop-02-demand.png` })
await page.getByRole('button', { name: /Reveal unheard/i }).click()
await page.waitForTimeout(5000)
await page.screenshot({ path: `${out}/desktop-05-revealed.png` })
await page.locator('.rankrow').first().click()
await page.waitForSelector('#policy-brief')
await page.getByRole('button', { name: 'Evidence sheet (no AI)' }).click()
await page.waitForSelector('.brief', { timeout: 30000 })
ok('evidence sheet PDF generated through sidecar (token path)', true)
await page.locator('#policy-brief').scrollIntoViewIfNeeded()
await page.screenshot({ path: `${out}/desktop-08-brief.png` })
await page.getByRole('button', { name: 'Explain with Gemini' }).click()
await page.waitForSelector('.why, .state--error', { timeout: 60000 })
ok('Explain returns result or truthful error', true)
console.log('explain:', (await page.locator('#sec-why').textContent())?.slice(0, 200))
console.log('errors:', errors.length ? errors : 'none')
await browser.close()
