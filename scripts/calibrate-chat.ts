// ─── NEXUS — Étalonnage des garde-fous du modèle de conversation ──────────────
// Les seuils de qualité (confiance NLL, couverture lexicale, ancrage dans le
// contexte) ne se devinent pas : ils se mesurent. Ce script fait tourner le
// modèle chargé sur des messages de test et imprime, pour chacun, la réponse
// générée et TOUTES les mesures qui décident de l'accepter ou de la refuser.
//
// Usage :
//   node --import tsx scripts/calibrate-chat.ts            (modèle actif)
//   node --import tsx scripts/calibrate-chat.ts --seed     (point de contrôle du dépôt)
//
// Lecture du bilan :
//   · les NLL des réponses acceptables doivent être nettement sous le seuil,
//   · le charabia (s'il en reste) doit être au-dessus,
//   · la colonne « ancrage » mesure la fidélité au contenu retrouvé.

import { retrieveChatContext, chatPrompt, cleanAnswer } from '@/lib/llm/dialogue'
import { groundingOf } from '@/lib/llm/grounding'
import { sample, averageNll } from '@/lib/llm/generate'
import { loadActiveModel } from '@/lib/llm/engine'
import { loadSeedModel } from '@/lib/llm/seed'
import { lexiconCoverage } from '@/lib/llm/model'

const CASES: { message: string; history?: { role: 'user' | 'assistant'; content: string }[] }[] = [
  { message: 'Bonjour !' },
  { message: 'Salut, ça va ?' },
  { message: 'Qui es-tu ?' },
  { message: 'Tu es une vraie IA ou un script ?' },
  { message: "Qu'est-ce que tu sais faire ?" },
  { message: 'Comment tu fonctionnes ?' },
  { message: 'Tu as des émotions ?' },
  { message: 'Tu penses quoi des humains ?' },
  { message: "J'ai passé une mauvaise journée" },
  { message: 'Merci pour ton aide' },
  { message: 'Au revoir' },
  { message: 'Raconte-moi quelque chose' },
  {
    message: 'Et pourquoi ?',
    history: [
      { role: 'user', content: 'Qui es-tu ?' },
      { role: 'assistant', content: 'Je suis NEXUS, un agent IA qui tourne entièrement sur ta machine.' },
    ],
  },
  {
    message: "Je ne comprends pas",
    history: [
      { role: 'user', content: 'Comment tu fonctionnes ?' },
      { role: 'assistant', content: 'Je retrouve un passage de mon savoir, puis un petit transformeur rédige la réponse.' },
    ],
  },
  // Hors domaine : doit être refusé (le modèle ne sait pas, il ne doit pas bluffer).
  { message: 'Donne-moi la capitale du Kazakhstan en 1723' },
  { message: 'asdf qwer zxcv 1234' },
]

async function main() {
  const useSeed = process.argv.includes('--seed')
  const model = useSeed ? loadSeedModel() : await loadActiveModel()
  if (!model) {
    console.log('Aucun modèle chargé.')
    process.exit(1)
  }
  const cfg = model.cfg
  console.log(
    `modèle : ${model.id} · ${cfg.format} · tokenizer ${cfg.tokenizer ?? 'char'} · dim ${cfg.dim} · ${cfg.layers} couches · ctx ${cfg.ctx} · ${model.steps} étapes · perte ${Number(model.loss).toFixed(3)} · lexique ${model.lexicon.size} mots\n`
  )

  const rows: { nll: number; cov: number; grounding: number; len: number; ok: boolean }[] = []
  for (const c of CASES) {
    const ctx = await retrieveChatContext(c.message, null, c.history ?? [])
    const prompt = chatPrompt({ history: c.history ?? [], context: ctx.passage, message: c.message })
    const res = sample(model, prompt, { maxTokens: 120, temperature: 0.55, topK: 6, seed: 11, repeatPenalty: 1.3, stopAtLine: true })
    const text = cleanAnswer(res.text)
    const cov = model.lexicon.size ? lexiconCoverage(text, model.lexicon) : 1
    const grounding = ctx.passage ? groundingOf(text, ctx.passage) : 1
    const words = text.toLowerCase().split(/[^\p{L}']+/u).filter((w) => w.length >= 3)
    const uniq = words.length ? new Set(words).size / words.length : 0
    const ok = res.avgNll <= 4.2 && cov >= 0.3 && grounding >= 0.45 && uniq >= 0.5 && text.length >= 8
    rows.push({ nll: res.avgNll, cov, grounding, len: text.length, ok })
    console.log(`Q: ${c.message}`)
    console.log(`   contexte  : ${ctx.passage ? `« ${ctx.passage.slice(0, 60)} » (${ctx.source})` : 'aucun'} · score ${ctx.score.toFixed(2)}`)
    console.log(`   généré    : « ${text.slice(0, 150)} »`)
    console.log(`   mesures   : NLL ${res.avgNll.toFixed(2)} · lexique ${cov.toFixed(2)} · ancrage ${grounding.toFixed(2)} · unique ${uniq.toFixed(2)} · ${res.tokens} tokens · ${res.ms} ms → ${ok ? 'ACCEPTÉ' : 'REFUSÉ'}`)
    if (!ok) console.log(`   repli     : « ${(ctx.fallback ?? '—').slice(0, 110)} »`)
    console.log()
  }

  const accepted = rows.filter((r) => r.ok)
  const refused = rows.filter((r) => !r.ok)
  const stat = (xs: number[]) => (xs.length ? `min ${Math.min(...xs).toFixed(2)} · médiane ${xs.sort((a, b) => a - b)[Math.floor(xs.length / 2)].toFixed(2)} · max ${Math.max(...xs).toFixed(2)}` : '—')
  console.log('── Bilan ─────────────────────────────────────────────')
  console.log(`acceptées : ${accepted.length}/${rows.length}`)
  console.log(`NLL       : acceptées [${stat(accepted.map((r) => r.nll))}] · refusées [${stat(refused.map((r) => r.nll))}]`)
  console.log(`lexique   : acceptées [${stat(accepted.map((r) => r.cov))}] · refusées [${stat(refused.map((r) => r.cov))}]`)
  console.log(`ancrage   : acceptées [${stat(accepted.map((r) => r.grounding))}] · refusées [${stat(refused.map((r) => r.grounding))}]`)

  // Référence « à froid » : NLL du texte réellement appris (borne basse attendue).
  const refPrompt = chatPrompt({ context: 'Je suis NEXUS, un agent IA local.', message: 'Qui es-tu ?' })
  const refNll = averageNll(model, refPrompt, 'Je suis NEXUS, un agent IA qui tourne entièrement sur ta machine.')
  console.log(`\nNLL de référence (texte du corpus, à froid) : ${refNll.toFixed(2)} — une réponse générée correcte doit tourner autour.`)
}

main().catch((err) => {
  console.error('échec :', err instanceof Error ? err.stack : err)
  process.exit(1)
})
