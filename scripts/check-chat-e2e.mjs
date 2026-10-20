// ─── NEXUS — Test de bout en bout du chat (serveur réel) ──────────────────────
// Mesure ce que l'utilisateur ressent : le délai avant les en-têtes, le premier
// token, la fin du flux, le texte reçu et la PROVENANCE annoncée.
//
// C'est l'outil qui a permis de distinguer trois lenteurs différentes qui se
// ressemblaient dans un simple chronomètre :
//   · 37 s avant les en-têtes  → entraînement du classifieur au 1er appel,
//     désormais payé au démarrage (src/instrumentation.ts),
//   · 71 s ENTRE les morceaux  → entraînement du LLM lancé dans le process du
//     serveur par le daemon, qui ne cédait la main qu'aux microtâches,
//   · 0 s après « done »       → le flux se ferme bien dès la fin logique.
//
// Prérequis : un serveur qui tourne (npm run dev, ou npm run build && npm start)
// et le compte de développement. Usage :
//   node scripts/check-chat-e2e.mjs [--base http://127.0.0.1:3000] [--turns 6]

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback
}
const BASE = arg('base', 'http://127.0.0.1:3000')
const EMAIL = arg('email', 'dev')
const PASSWORD = arg('password', 'dev2026')

const TURNS = [
  'Bonjour !',
  'Qui es-tu exactement ?',
  "Qu'est-ce que tu sais faire ?",
  "Ça va aujourd'hui ?",
  'Et pourquoi tu dis ça ?',
  'Merci pour ton aide',
]

const login = async () => {
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  })
  const raw = res.headers.get('set-cookie') ?? ''
  if (!res.ok || !raw) throw new Error(`connexion impossible (statut ${res.status}) — serveur démarré sur ${BASE} ?`)
  return raw.split(';')[0]
}

/** Un tour de chat : horodate chaque événement SSE, pas seulement la fin. */
async function oneTurn(cookie, history, message, { timeline = false } = {}) {
  const t0 = Date.now()
  const at = () => Date.now() - t0
  const res = await fetch(`${BASE}/api/agent`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify({ messages: [...history, { role: 'user', content: message }] }),
  })
  const headersMs = at()
  if (!res.ok || !res.body) throw new Error(`statut ${res.status} sur /api/agent`)

  const reader = res.body.getReader()
  const dec = new TextDecoder()
  let buf = ''
  let text = ''
  let provenance = ''
  let tokens = 0
  let thoughts = 0
  let steps = 0
  let firstTokenMs = null
  let doneMs = null

  for (;;) {
    const { value, done } = await reader.read()
    if (done) break
    buf += dec.decode(value, { stream: true })
    let i
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).trim()
      buf = buf.slice(i + 1)
      if (!line.startsWith('data: ')) continue
      let ev
      try { ev = JSON.parse(line.slice(6)) } catch { continue }
      if (ev.type === 'token') {
        tokens++
        text += ev.content ?? ''
        if (firstTokenMs === null) firstTokenMs = at()
        if (timeline && tokens === 1) console.log(`   ${String(firstTokenMs).padStart(6)} ms · premier token`)
      } else if (ev.type === 'thought') {
        thoughts++
        if (/savoir local retrouvé|modèle de langue local|généré par le modèle/i.test(String(ev.text ?? ''))) provenance = String(ev.text)
        if (timeline) console.log(`   ${String(at()).padStart(6)} ms · [thought] ${String(ev.text ?? '').slice(0, 64)}`)
      } else if (ev.type === 'step') {
        steps++
        if (timeline) console.log(`   ${String(at()).padStart(6)} ms · [step] ${String(ev.label ?? ev.text ?? '').slice(0, 48)}`)
      } else if (ev.type === 'done') {
        doneMs = at()
      }
    }
  }
  return { headersMs, firstTokenMs, doneMs, closedMs: at(), text, provenance, tokens, thoughts, steps }
}

const maxTurns = Number(arg('turns', TURNS.length))
const messages = TURNS.slice(0, Number.isFinite(maxTurns) ? maxTurns : TURNS.length)

const cookie = await login()
console.log(`serveur ${BASE} · ${messages.length} tours · compte ${EMAIL}\n`)

const history = []
let worst = 0
let slowest = ''
for (const message of messages) {
  const timeline = message === messages[0]
  const r = await oneTurn(cookie, history, message, { timeline })
  history.push({ role: 'user', content: message }, { role: 'assistant', content: r.text })
  const total = r.closedMs
  if (total > worst) { worst = total; slowest = message }
  console.log(
    `── ${message}\n` +
    `   en-têtes ${r.headersMs} ms · premier token ${r.firstTokenMs ?? '—'} ms · flux fermé ${total} ms` +
    ` · ${r.tokens} morceaux · ${r.steps} étape(s)\n` +
    `   « ${r.text} »\n` +
    `   provenance : ${r.provenance || '(aucune pensée de provenance)'}`
  )
  const afterDone = r.doneMs === null ? null : total - r.doneMs
  if (afterDone !== null && afterDone > 500) {
    console.log(`   ⚠ ${afterDone} ms écoulés APRÈS l'événement « done » : le flux ne se ferme pas`)
  }
}

console.log(`\n── Bilan ─────────────────────────────────────────────`)
console.log(`tour le plus lent : « ${slowest} » en ${worst} ms`)
console.log(
  worst > 5000
    ? '✘ TROP LENT — quelque chose bloque la boucle d\'événements (entraînement en arrière-plan ? préchauffage non terminé ?)'
    : '✔ latence de conversation acceptable (< 5 s par tour)'
)
