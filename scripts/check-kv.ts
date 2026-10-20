// Vérifie que le décodage avec cache KV produit EXACTEMENT les mêmes logits que
// la passe avant complète de référence (model.forward). C'est la garantie que
// l'accélération du chat ne change rien au modèle entraîné.
import { DEFAULT_CONFIG, initParams, forward, buildVocab, encodeText } from '@/lib/llm/model'
import { noGrad } from '@/lib/llm/tensor'
import { createKv, prefill, stepToken } from '@/lib/llm/kv'

const vocab = buildVocab('bonjour nexus, comment vas-tu ? je vais très bien merci. '.repeat(60))
let worst = 0
for (const over of [{ dim: 32, layers: 2, heads: 4 }, { dim: 64, layers: 3, heads: 4 }]) {
  const cfg = { vocab: vocab.itos.length, ctx: 64, ...over }
  const p = initParams(cfg, 11)
  const ids = encodeText(vocab, 'C: bonjour nexus\nQ: comment vas-tu\nR: je vais ')
  const T = ids.length

  // Référence : une passe complète sur toute la séquence.
  const ref = noGrad(() => forward(cfg, p, ids, 1, T)).data

  // Cache KV : pré-remplissage sur T-1 tokens, puis un pas.
  const kv = createKv(cfg, p)
  prefill(kv, ids.subarray(0, T - 1))
  const logits = stepToken(kv, ids[T - 1])

  let maxDiff = 0
  for (let j = 0; j < cfg.vocab; j++) {
    const d = Math.abs(logits[j] - ref[(T - 1) * cfg.vocab + j])
    if (d > maxDiff) maxDiff = d
  }
  worst = Math.max(worst, maxDiff)
  console.log(`dim=${cfg.dim} L=${cfg.layers} T=${T} → écart max ${maxDiff.toExponential(2)}`)

  // Vitesse : décodage token par token vs passe complète recomputée.
  const t0 = Date.now()
  let n = 0
  while (Date.now() - t0 < 800) { const k2 = createKv(cfg, p); prefill(k2, ids.subarray(0, 24)); for (let i = 0; i < 40; i++) stepToken(k2, ids[i % T]); n++ }
  const perRun = 800 / n
  const t1 = Date.now()
  let m = 0
  while (Date.now() - t1 < 800) { noGrad(() => forward(cfg, p, ids, 1, T)); m++ }
  console.log(`   40 tokens : cache KV ${perRun.toFixed(1)} ms · passe complète ×40 ${(40 * (800 / m)).toFixed(0)} ms`)
}
console.log(worst < 1e-3 ? `✔ IDENTIQUE (écart max ${worst.toExponential(2)})` : `✘ ÉCART ${worst.toExponential(2)}`)
