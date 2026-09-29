/** Test live NEXUS v3 : identité (« décris toi »), recherche, mission autonome. */

const BASE = 'http://localhost:3000'

async function chat(label: string, message: string, timeoutMs = 60_000): Promise<void> {
  const t0 = Date.now()
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetch(`${BASE}/api/agent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: [{ role: 'user', content: message }] }),
      signal: controller.signal,
    })
    if (!res.ok || !res.body) {
      console.log(`[${label}] HTTP ${res.status}`)
      return
    }
    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    let text = ''
    let firstTokenAt = -1
    let thoughts = 0
    let steps = 0
    let sources = 0
    let code = false
    let done = false
    let error = ''
    while (true) {
      const { done: streamDone, value } = await reader.read()
      if (streamDone) break
      buffer += decoder.decode(value, { stream: true })
      const parts = buffer.split('\n\n')
      buffer = parts.pop() ?? ''
      for (const part of parts) {
        const line = part.trim()
        if (!line.startsWith('data:')) continue
        try {
          const ev = JSON.parse(line.slice(5).trim()) as Record<string, unknown>
          if (ev.type === 'token') {
            if (firstTokenAt < 0) firstTokenAt = Date.now() - t0
            text += String(ev.content ?? '')
          } else if (ev.type === 'thought') thoughts++
          else if (ev.type === 'step') steps++
          else if (ev.type === 'sources') sources += (ev.sources as unknown[]).length
          else if (ev.type === 'code') code = true
          else if (ev.type === 'done') done = true
          else if (ev.type === 'error') error = String(ev.message ?? '')
        } catch {
          /* partiel */
        }
      }
    }
    const total = Date.now() - t0
    console.log(`\n=== [${label}] total=${total}ms TTFB=${firstTokenAt}ms thoughts=${thoughts} steps=${steps} sources=${sources} code=${code} done=${done}`)
    if (error) console.log(`  ERREUR: ${error}`)
    console.log(`  Réponse: ${text.replace(/\n+/g, ' | ').slice(0, 400)}`)
  } catch (err) {
    console.log(`\n=== [${label}] ÉCHEC: ${err instanceof Error ? err.message : err}`)
  } finally {
    clearTimeout(timer)
  }
}

async function main() {
  // 1) Le bug signalé : « décris toi » ne doit PAS générer de code
  await chat('IDENTITÉ', 'décris toi')

  // 2) Recherche web (vitesse + synthèse)
  await chat('RECHERCHE', 'cherche les dernières news roblox', 90_000)
}

main().catch((e) => {
  console.error('ÉCHEC GLOBAL:', e)
  process.exit(1)
})
