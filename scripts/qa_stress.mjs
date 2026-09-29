// Robustness QA: hammer the UI (rapid mode/category/theme switches, repeated
// reveals, many dossiers, resizes, bad input) and assert no page errors.
//   node scripts/qa_stress.mjs [outDir]
import { chromium } from 'playwright-core'
import { mkdirSync } from 'node:fs'

const out = process.argv[2] ?? 'qa-screens'
mkdirSync(out, { recursive: true })
const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] })
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
const errors = []
page.on('pageerror', (e) => errors.push(String(e)))
page.on('console', (m) => m.type() === 'error' && !/status of 50[34]/.test(m.text()) && errors.push(m.text()))

await page.goto('http://127.0.0.1:1420/')
await page.waitForFunction(() => !document.querySelector('.intro button')?.hasAttribute('disabled'))
await page.getByRole('button', { name: 'Enter India' }).click()
await page.waitForSelector('.maplibregl-canvas')
await page.waitForTimeout(1500)

const modes = ['Demand', 'Need', 'Unheard']
const cats = ['Water', 'Sanitation', 'Health', 'Education', 'Energy', 'All categories']
for (let i = 0; i < 30; i++) {
  await page.getByRole('radio', { name: new RegExp(modes[i % 3]) }).click()
  await page.getByRole('radio', { name: new RegExp('^' + cats[i % 6]) }).click()
  if (i % 7 === 0) await page.getByRole('radio', { name: i % 2 ? 'Day' : 'Night' }).click()
}
for (let i = 0; i < 4; i++) {
  await page.getByRole('button', { name: /Reveal unheard/i }).click().catch(() => {})
  await page.waitForTimeout(300)
  await page.getByRole('button', { name: /Back to reported demand/i }).click().catch(() => {})
}
await page.getByRole('button', { name: /Reveal unheard/i }).click()
await page.waitForTimeout(4500)
const rows = page.locator('.rankrow')
for (let i = 0; i < 8; i++) {
  await rows.nth(i).click()
  await page.waitForTimeout(150)
}
await page.locator('#wi-fac').fill('60')
await page.locator('#wi-cap').fill('999999')
await page.locator('#wi-cap').fill('')
for (const size of [
  { width: 1180, height: 720 },
  { width: 1920, height: 1080 },
  { width: 1440, height: 900 },
])
  await page.setViewportSize(size)
await page.getByRole('radio', { name: 'Day' }).click()
await page.waitForTimeout(1200)
await page.screenshot({ path: `${out}/stress-day.png` })
// search garbage + insufficient district
await page.getByPlaceholder('Find a district or state').fill('%%%<script>')
await page.keyboard.press('Enter')
await page.getByPlaceholder('Find a district or state').fill('chandigarh')
await page.keyboard.press('Enter')
await page.waitForTimeout(500)
const insuff = (await page.locator('.dossier').textContent())?.includes('INSUFFICIENT DATA')
console.log(insuff ? 'PASS' : 'FAIL', 'insufficient-data district opens safely')
await page.getByRole('radio', { name: 'Night' }).click()
console.log(errors.length ? 'FAIL page errors: ' + JSON.stringify(errors) : 'PASS no page errors under stress')
await browser.close()
