// Functional QA of flows that work without Gemini: manual capture, demo mode
// (with honest fallback), ask-the-map local parse, keyboard navigation,
// evidence-sheet PDF. Requires `npm run dev` + backend on 8765.
//   node scripts/qa_flows.mjs [outDir]
import { chromium } from 'playwright-core'
import { mkdirSync } from 'node:fs'

const out = process.argv[2] ?? 'qa-screens'
mkdirSync(out, { recursive: true })
const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] })
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
const errors = []
page.on('pageerror', (e) => errors.push(String(e)))
page.on('console', (m) => m.type() === 'error' && !m.text().includes('status of 503') && errors.push(m.text()))
const ok = (label, cond) => console.log(cond ? 'PASS' : 'FAIL', label)

await page.goto('http://127.0.0.1:1420/')
await page.waitForFunction(() => !document.querySelector('.intro button')?.hasAttribute('disabled'))
await page.keyboard.press('Enter') // intro button is focused
await page.waitForSelector('.maplibregl-canvas')
await page.waitForTimeout(1500)
ok('Enter India via keyboard', await page.locator('.topbar').isVisible())

// keyboard: mode radios with arrows
await page.getByRole('radio', { name: /Demand/ }).focus()
await page.keyboard.press('ArrowRight')
ok('mode arrow key -> Need', (await page.getByRole('radio', { name: /Need/ }).getAttribute('aria-checked')) === 'true')

// keyboard: ranked list
await page.locator('.rankrow').first().focus()
await page.keyboard.press('ArrowDown')
await page.keyboard.press('Enter')
await page.waitForSelector('.dossier')
ok('ranked list keyboard opens dossier', await page.locator('#dossier-title').isVisible())
await page.keyboard.press('Escape')
await page.waitForTimeout(300)
ok('Escape closes dossier', (await page.locator('.dossier').count()) === 0)

// search combobox
await page.getByPlaceholder('Find a district or state').fill('raich')
await page.keyboard.press('Enter')
await page.waitForSelector('.dossier')
ok('search opens Raichur', (await page.locator('#dossier-title').textContent())?.includes('Raichur'))

// manual capture (no AI)
await page.getByRole('button', { name: 'Capture request' }).click()
await page.getByRole('button', { name: /Kannada/ }).click()
await page.getByRole('button', { name: 'Classify manually' }).click()
await page.locator('#cap-cat').selectOption('water')
await page.getByPlaceholder('Search district…').fill('Raichur')
await page.getByRole('radio', { name: /Raichur/ }).check()
await page.getByRole('button', { name: 'Add to signal layer' }).click()
await page.waitForSelector('.delta')
ok('manual signal added, delta shown', (await page.locator('.delta').textContent())?.includes('→'))
await page.screenshot({ path: `${out}/10-manual-capture.png` })

// analyse without key -> truthful error
await page.getByRole('button', { name: 'Analyse with Gemini' }).click()
await page.waitForSelector('.state--error')
ok('Gemini failure shows UNAVAILABLE', (await page.locator('.state--error').first().textContent())?.includes('UNAVAILABLE'))

// ask the map local fallback
await page.getByRole('button', { name: /Ask the map/ }).click()
await page.getByRole('button', { name: /Where is water need highest/ }).click()
await page.waitForSelector('.askresult')
ok('ask-the-map falls back to labelled local parse', (await page.locator('.askresult').textContent())?.includes('Parsed locally'))
await page.screenshot({ path: `${out}/11-ask-local.png` })

// evidence sheet PDF from dossier
await page.locator('.askresult .rankrow').first().click()
await page.waitForSelector('#policy-brief')
await page.getByRole('button', { name: 'Evidence sheet (no AI)' }).click()
await page.waitForSelector('.brief__pdf', { timeout: 20000 })
ok('evidence sheet PDF preview', await page.locator('.brief__pdf').isVisible())

// demo mode
await page.getByRole('button', { name: 'Demo mode' }).click()
await page.waitForSelector('.demobar')
for (let i = 0; i < 6; i++) {
  await page.getByRole('button', { name: 'Next →' }).click()
  await page.waitForTimeout(i === 2 ? 3500 : 1200)
}
await page.screenshot({ path: `${out}/12-demo-last.png` })
ok('demo reached step 7', (await page.locator('.demobar__steps li[aria-current="step"]').textContent())?.includes('Policy brief'))
ok('demo dossier open', await page.locator('.dossier').isVisible())
await page.getByRole('button', { name: /Exit & remove demo signals/ }).click()

// cleanup captured manual signal
await page.evaluate(async () => {
  const r = await fetch('http://127.0.0.1:8765/api/signals?source=manual', { method: 'DELETE' })
  return r.status
})
console.log('page errors:', errors.length ? errors : 'none')
await browser.close()
