// ─── NEXUS — test de bout en bout de la MÉMOIRE et de la PERSONNALITÉ ────────
// Ce que l'utilisateur ressent, pas ce que le retrieval score : le chat
// salue-t-il la personne, se souvient-il de ce qu'elle a dit, reprend-il le
// fil d'une conversation à l'autre ?
//
// Deux comptes NEUFS sont créés à chaque exécution (aucune pollution des
// comptes existants), puis :
//   A. conversation précédente semée → « Bonjour » doit reprendre le sujet,
//      « je m'appelle … » doit être retenu, « tu te souviens de moi ? » doit
//      restituer le CONTENU, et une NOUVELLE conversation doit saluer du nom.
//   B. compte vierge → premier contact, le chat demande le prénom.
//
// Prérequis : serveur qui tourne. Usage :
//   node scripts/check-chat-memory.mjs [--base http://127.0.0.1:3000]

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback
}
const BASE = arg('base', 'http://127.0.0.1:3000')
const STAMP = Date.now().toString(36)

let failures = 0
const check = (label, pass, detail = '') => {
  if (pass) console.log(`  ✓ ${label}`)
  else {
    failures++
    console.log(`  ✗ ${label}${detail ? `\n      reçu : ${detail}` : ''}`)
  }
}

async function register(email, name) {
  const res = await fetch(`${BASE}/api/auth/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, name, password: 'mem2026ok' }),
  })
  const raw = res.headers.get('set-cookie') ?? ''
  if (!res.ok) throw new Error(`inscription impossible (${res.status}) : ${(await res.text()).slice(0, 120)}`)
  if (!raw) throw new Error('inscription sans cookie de session')
  return raw.split(';')[0]
}

async function patchProfile(cookie, patch) {
  const res = await fetch(`${BASE}/api/auth/profile`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify(patch),
  })
  if (!res.ok) throw new Error(`profil non enregistré (${res.status}) : ${(await res.text()).slice(0, 120)}`)
}

async function seedConversation(cookie, id, title) {
  const res = await fetch(`${BASE}/api/conversations`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify({ id, title, messages: [{ role: 'user', content: title }, { role: 'assistant', content: '…' }] }),
  })
  if (!res.ok) throw new Error(`semis de conversation impossible (${res.status})`)
}

async function turn(cookie, history, message, conversationId) {
  const t0 = Date.now()
  const res = await fetch(`${BASE}/api/agent`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify({
      messages: [...history, { role: 'user', content: message }],
      ...(conversationId ? { conversationId } : {}),
    }),
  })
  if (!res.ok || !res.body) throw new Error(`statut ${res.status} sur /api/agent`)
  const reader = res.body.getReader()
  const dec = new TextDecoder()
  let buf = ''
  let text = ''
  let memoryAdded = 0
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
      try {
        ev = JSON.parse(line.slice(6))
      } catch {
        continue
      }
      if (ev.type === 'token') text += ev.content ?? ''
      else if (ev.type === 'meta' && ev.memoryAdded) memoryAdded += Number(ev.memoryAdded) || 0
    }
  }
  const ms = Date.now() - t0
  history.push({ role: 'user', content: message }, { role: 'assistant', content: text })
  console.log(`  · ${message.slice(0, 48)} → ${ms} ms${memoryAdded ? ` · +${memoryAdded} souvenir(s)` : ''}\n      « ${text.replace(/\s+/g, ' ').slice(0, 150)} »`)
  return { text, ms, memoryAdded }
}

// ── A. mémoire d'un compte qui revient ──────────────────────────────────────
console.log(`\nA. compte qui revient — ${BASE}`)
const cookieA = await register(`memo-${STAMP}@nexus.local`, 'Testeur')
await seedConversation(cookieA, `conv-${STAMP}`, 'Comment créer un jeu Roblox')
const historyA = []
const convA = `conv-a-${STAMP}`

const hello = await turn(cookieA, historyA, 'Bonjour !', convA)
check('la salutation reprend le sujet de la conversation précédente', /on reprend sur «\s*comment créer un jeu roblox/i.test(hello.text), hello.text)

const intro = await turn(cookieA, historyA, "Je m'appelle Camille, j'habite à Lyon et mon chat s'appelle Pixel.", convA)
check("une présentation est mémorisée (confirmation visible)", /retenu|enregistr|mémoire|mémoiris/i.test(intro.text) && intro.memoryAdded > 0, intro.text)

const recall = await turn(cookieA, historyA, 'Tu te souviens de moi ?', convA)
check('« tu te souviens de moi ? » restitue le CONTENU (prénom)', /camille/i.test(recall.text), recall.text)
check('… et les autres faits (ville / chat)', /lyon|pixel/i.test(recall.text), recall.text)

const pet = await turn(cookieA, historyA, "Comment s'appelle mon chat ?", convA)
check('un fait mémorisé revient sur une question ciblée', /pixel/i.test(pet.text), pet.text)

const lastTalk = await turn(cookieA, historyA, 'Tu te rappelles de notre dernière conversation ?', convA)
check('la dernière conversation est citée', /comment créer un jeu roblox/i.test(lastTalk.text), lastTalk.text)

const whoami = await turn(cookieA, historyA, 'Qui suis-je ?', convA)
check('« qui suis-je ? » reste une question de mémoire', /camille|lyon|pixel|souviens/i.test(whoami.text), whoami.text)

// NOUVELLE conversation : le prénom doit venir de la mémoire, pas du contexte.
const convA2 = `conv-a2-${STAMP}`
const fresh = []
const hello2 = await turn(cookieA, fresh, 'Bonjour', convA2)
check('une nouvelle conversation salue du nom retenu', /camille/i.test(hello2.text), hello2.text)

// ── B. compte vierge ────────────────────────────────────────────────────────
console.log(`\nB. compte vierge — ${BASE}`)
const cookieB = await register(`memob-${STAMP}@nexus.local`, 'Nouveau')
const helloB = await turn(cookieB, [], 'Bonjour', `conv-b-${STAMP}`)
check('nouveau compte : salué par le prénom connu', /Nouveau/.test(helloB.text), helloB.text)
check("aucune continuité inventée au premier contact", !/on reprend sur/i.test(helloB.text), helloB.text)

// ── C. personnalité du compte : nom de l'assistant et ton ───────────────────
console.log(`\nC. personnalité du compte — ${BASE}`)
const cookieC = await register(`memoc-${STAMP}@nexus.local`, 'Perso')
await patchProfile(cookieC, { assistantName: 'Nova' })
const identity = await turn(cookieC, [], 'Qui es-tu exactement ?', `conv-c-${STAMP}`)
check("le compte a renommé l'assistant", /\bNova\b/.test(identity.text) && !/\bNEXUS\b/.test(identity.text), identity.text)

await patchProfile(cookieC, { tone: 'direct' })
const direct = await turn(cookieC, [], "Ça va aujourd'hui ?", `conv-c2-${STAMP}`)
check('le ton « direct » retire la relance finale', !/\?\s*$/.test(direct.text), direct.text)

// ── Latence ─────────────────────────────────────────────────────────────────
const worst = Math.max(...[hello, intro, pet, recall, lastTalk, whoami, hello2, helloB, identity, direct].map((r) => r.ms))
console.log(`\n── Bilan ─────────────────────────────────────────────`)
console.log(`tour le plus lent : ${worst} ms`)
if (worst > 5000) {
  failures++
  console.log('✘ TROP LENT (> 5 s)')
}
console.log(failures === 0 ? '\n✔ mémoire et personnalité visibles dans les réponses' : `\n✘ ${failures} échec(s)`)
if (failures > 0) process.exitCode = 1
