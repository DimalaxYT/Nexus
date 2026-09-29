import type { Browser } from 'playwright'

/**
 * Screenshot serveur — le « regard » réel de NEXUS sur le web.
 * Playwright Chromium headless, instance réutilisée entre les appels (lancement ~1s),
 * captures sérialisées (une seule page à la fois) pour limiter la mémoire.
 */

let browserPromise: Promise<Browser> | null = null
let chain: Promise<unknown> = Promise.resolve()

async function getBrowser(): Promise<Browser> {
  if (!browserPromise) {
    browserPromise = (async () => {
      const { chromium } = await import('playwright')
      return chromium.launch({
        headless: true,
        args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
      })
    })()
    browserPromise.catch(() => {
      browserPromise = null // relancera au prochain appel
    })
  }
  return browserPromise
}

export interface PageShot {
  dataUrl: string // data:image/jpeg;base64,…
  title: string
}

const UA =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36 NEXUS/1.4'

/**
 * Capture une page web en JPEG (~1280×800). Retourne null en cas d'échec
 * (site inaccessible, timeout, blocage) — jamais d'exception.
 */
export function captureScreenshot(url: string, timeoutMs = 20_000): Promise<PageShot | null> {
  // Sérialisation : chaque capture attend la fin de la précédente
  const run = async (): Promise<PageShot | null> => {
    let context: Awaited<ReturnType<Browser['newContext']>> | null = null
    try {
      const browser = await getBrowser()
      context = await browser.newContext({
        viewport: { width: 1280, height: 800 },
        deviceScaleFactor: 1,
        userAgent: UA,
        locale: 'fr-FR',
      })
      const page = await context.newPage()
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: timeoutMs })
      // Laisse le rendu (images, polices, SPA) se terminer
      await page.waitForLoadState('networkidle', { timeout: 6000 }).catch(() => {})
      await page.waitForTimeout(700)
      const title = await page.title().catch(() => '')
      const buffer = await page.screenshot({ type: 'jpeg', quality: 62, fullPage: false })
      return { dataUrl: `data:image/jpeg;base64,${buffer.toString('base64')}`, title }
    } catch {
      return null
    } finally {
      if (context) await context.close().catch(() => {})
    }
  }
  const result = chain.then(run, run)
  chain = result.catch(() => {})
  return result
}

/**
 * Rastérise un SVG en PNG (art procédural local de NEXUS).
 * Réutilise l'instance Chromium — échec silencieux (null) pour repli SVG brut.
 */
export function rasterizeSvg(
  svg: string,
  width: number,
  height: number,
  timeoutMs = 15_000
): Promise<string | null> {
  const run = async (): Promise<string | null> => {
    let context: Awaited<ReturnType<Browser['newContext']>> | null = null
    try {
      const browser = await getBrowser()
      context = await browser.newContext({
        viewport: { width, height },
        deviceScaleFactor: 1,
      })
      const page = await context.newPage()
      const dataUrl = `data:image/svg+xml;base64,${Buffer.from(svg, 'utf8').toString('base64')}`
      await page.setContent(
        `<!doctype html><html><head><style>*{margin:0;padding:0}body{overflow:hidden}img{display:block;width:${width}px;height:${height}px}</style></head><body><img src="${dataUrl}"></body></html>`,
        { timeout: timeoutMs }
      )
      await page.waitForLoadState('networkidle', { timeout: 4000 }).catch(() => {})
      const buffer = await page.locator('img').screenshot({ type: 'png', timeout: timeoutMs })
      return `data:image/png;base64,${buffer.toString('base64')}`
    } catch {
      return null
    } finally {
      if (context) await context.close().catch(() => {})
    }
  }
  const result = chain.then(run, run)
  chain = result.catch(() => {})
  return result
}
