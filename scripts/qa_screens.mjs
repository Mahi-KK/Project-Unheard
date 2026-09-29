// Visual QA: drives the dev build in the locally installed Microsoft Edge and
// saves screenshots of each product state. Usage:
//   node scripts/qa_screens.mjs [outDir] [baseUrl]
import { chromium } from 'playwright-core'
import { mkdirSync } from 'node:fs'

const out = process.argv[2] ?? 'qa-screens'
const base = process.argv[3] ?? 'http://127.0.0.1:1420/'
mkdirSync(out, { recursive: true })

const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] })
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
const errors = []
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()))
page.on('pageerror', (e) => errors.push(String(e)))
const shot = async (name) => {
  await page.screenshot({ path: `${out}/${name}.png` })
  console.log('saved', name)
}

await page.goto(base)
await page.getByRole('button', { name: 'Enter India' }).waitFor()
await page.waitForFunction(() => !document.querySelector('.intro button')?.hasAttribute('disabled'))
await shot('01-intro')
await page.getByRole('button', { name: 'Enter India' }).click()
await page.waitForSelector('.maplibregl-canvas')
await page.waitForTimeout(2500)
await shot('02-demand')
await page.getByRole('radio', { name: /Need/ }).click()
await page.waitForTimeout(800)
await shot('03-need')
await page.getByRole('radio', { name: /Demand/ }).click()
await page.waitForTimeout(600)
await page.getByRole('button', { name: /Reveal unheard/i }).click()
await page.waitForTimeout(1000)
await shot('04-reveal-midway')
await page.waitForTimeout(3500)
await shot('05-revealed')
await page.locator('.rankrow').first().click()
await page.waitForTimeout(1500)
await shot('06-dossier')
await page.locator('#sec-whatif').scrollIntoViewIfNeeded()
await page.waitForTimeout(400)
await shot('07-whatif')
await page.getByRole('button', { name: 'Capture request' }).click()
await page.waitForTimeout(500)
await shot('08-capture')
await page.getByRole('button', { name: /Ask the map/ }).click()
await page.waitForTimeout(500)
await shot('09-ask')

console.log('console errors:', errors.length ? errors : 'none')
await browser.close()
