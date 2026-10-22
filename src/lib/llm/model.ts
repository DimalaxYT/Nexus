// ─── NEXUS — LLM maison : architecture transformeur décodeur ─────────────────
// Un vrai modèle de langage autorégressif (GPT-like), entraîné depuis zéro sur les
// connaissances et conversations de NEXUS. Tokenizer caractère (accents compris),
// attention multi-têtes causale, MLP GELU, LayerNorm, tête de sortie liée aux
// embeddings. Tout tourne en local : aucune API, aucun service externe.
//
// Taille par défaut : ~110 k paramètres (dim 64, 2 couches, 4 têtes, contexte 96).
// Petit par choix : il doit s'entraîner en quelques minutes sur un CPU de serveur
// et tenir en mémoire sur un plan gratuit. Ses réponses restent courtes et
// proches du corpus — c'est un modèle appris, pas un moteur de règles.

import { add, addBias, crossEntropy, embed, gelu, gemm, layerNorm, noGrad, param, permute, reshape, scale, softmaxCausal, Tensor } from './tensor'

export interface LmConfig {
  vocab: number
  ctx: number
  dim: number
  heads: number
  layers: number
  /** Lexique appris (mots fréquents du corpus) : sert au garde-fou anti-charabia. */
  lexicon?: string[]
  /** Format d'apprentissage : `grounded-v1` = le modèle répond à partir d'un passage fourni. */
  format?: string
  /**
   * Tokenizer : `char` (défaut historique, vocabulaire ~320 caractères) ou `bpe`
   * (sous-mots entraînés du dépôt, vocabulaire 2049). En BPE, `Vocab.itos` est
   * inutilisé : les ids sont les octets/fusions du tokenizer (`./bpe`).
   */
  tokenizer?: 'char' | 'bpe'
}

/** Format « ancré » : chaque exemple donne le passage source (C:), la question (Q:) et la réponse (R:). */
export const GROUNDED_FORMAT = 'grounded-v1'
/** Contexte nécessaire pour un exemple complet (passage + question + réponse). */
export const GROUNDED_CTX = 256

/**
 * Format de conversation : le format du chat. Chaque exemple est un bloc
 *   `H: <dernier échange>`   (facultatif, mémoire courte de la conversation)
 *   `Q: <message utilisateur>`
 *   `C: <passage de savoir>` (facultatif, contenu fourni par la recherche)
 *   `R: <réponse de NEXUS>`
 *
 * Le modèle apprend à RÉDIGER une réponse à partir du contenu qui lui est donné :
 * la recherche apporte les faits, le transformeur apporte la formulation — c'est
 * ce qui rend un petit modèle utile en conversation au lieu de le laisser inventer.
 *
 * POURQUOI `C:` EST PLACÉ JUSTE AVANT `R:` (mesuré, pas esthétique) :
 * la tâche est une copie — `C:` et `R:` contiennent le même texte. Avec l'ordre
 * historique `C:` puis `Q:` puis `R:`, ~100 caractères séparaient le contenu de la
 * réponse : il faut alors une tête d'induction (coucher précédente + correspondance
 * de contexte) pour aller le rechercher. Avec le modèle v1 (178 496 paramètres,
 * dim 64, 3 couches), après 400 pas et ~9 époques, la NLL forcée restait à
 * 2,6 nats/caractère, 52-59 % des caractères dans le top-3, et le décodage
 * glouton produisait « de de le e de » : le rythme du français, pas son contenu.
 * Placer le contenu en dernière position avant la réponse en fait une tâche à
 * courte portée. Le modèle v2 (900 k paramètres, contexte 704, corpus densifié,
 * pré-entraînement sur de la prose) franchit le seuil : voir README et
 * llm/checkpoints/nexus-chat-v2-metrics.json.
 */
export const CHAT_FORMAT = 'chat-v1'
/**
 * Contexte du chat, en CARACTÈRES : H: (3+90) + Q: (3+110) + C: (3+260)
 * + R: (3+220) + 3 sauts de ligne = 695, donc 704 laisse la marge.
 *
 * v2 (2026-10) : le contexte passe de 352 à 704 caractères et la capacité de
 * 178 k à ~900 k paramètres. L'ancien format tronquait la question à 60
 * caractères et le contenu à 90 : le modèle ne voyait jamais la fin d'une
 * demande réelle, et ne pouvait produire que des réponses d'une ligne. Les
 * budgets restent alignés sur `chatPrompt` (inférence) et `chat-corpus.ts`
 * (entraînement) — c'est cette égalité qui fait tenir un exemple entier dans
 * chaque fenêtre.
 *
 * Pourquoi le tokenizer caractère et pas les sous-mots BPE — mesuré, pas deviné :
 * le BPE du dépôt (`tokenizer-merges.json`, vocabulaire 2049) a été entraîné sur
 * 5 Mo de romans ; sur un corpus de conversation de 200 ko il reste ~62 tokens
 * d'apprentissage par entrée de vocabulaire. Après 550 pas d'entraînement la
 * distribution après « R: » était encore PLATE (meilleur candidat à 2,4 %) et
 * les tokens de contenu pointaient aux rangs 96 à 308 sur 2049 : le modèle
 * apprenait les espaces et la ponctuation, pas la tâche. En caractère, le
 * vocabulaire tombe à ~85 symboles, soit ~2 400 caractères d'apprentissage par
 * embedding — 40 fois plus de données par paramètre. Le BPE redevient pertinent
 * si le corpus dépasse quelques Mo (`cfg.tokenizer = 'bpe'` reste pris en charge
 * de bout en bout : entraînement, inférence, garde-fous).
 */
export const CHAT_CTX = 704
/** Configuration du modèle de conversation. */
export const CHAT_CONFIG: Omit<LmConfig, 'vocab' | 'lexicon'> = {
  ctx: CHAT_CTX,
  dim: 128,
  heads: 8,
  layers: 4,
  format: CHAT_FORMAT,
  tokenizer: 'char',
}

export const DEFAULT_CONFIG: Omit<LmConfig, 'vocab'> = { ctx: GROUNDED_CTX, dim: 64, heads: 4, layers: 2 }

interface LayerParams {
  ln1g: Tensor
  ln1b: Tensor
  wq: Tensor
  wk: Tensor
  wv: Tensor
  wo: Tensor
  ln2g: Tensor
  ln2b: Tensor
  w1: Tensor
  b1: Tensor
  w2: Tensor
  b2: Tensor
}

export interface LmParams {
  tokEmb: Tensor
  posEmb: Tensor
  layers: LayerParams[]
  lnfg: Tensor
  lnfb: Tensor
}

// ── Générateur aléatoire déterministe (reproductible) ────────────────────────

export function makeRng(seed: number): () => number {
  let s = seed >>> 0 || 1
  return () => {
    s = (s + 0x6d2b79f5) >>> 0
    let t = s
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function gaussian(rng: () => number): number {
  const u = Math.max(rng(), 1e-9)
  const v = rng()
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v)
}

function randMatrix(rows: number, cols: number, rng: () => number, std: number): Tensor {
  const data = new Float32Array(rows * cols)
  for (let i = 0; i < data.length; i++) data[i] = gaussian(rng) * std
  return param(data, [rows, cols])
}

function filled(shape: number[], value: number): Tensor {
  return param(new Float32Array(shape.reduce((p, c) => p * c, 1)).fill(value), shape)
}

/** Initialisation des poids (GPT-2 : écart-type 0,02, LayerNorm à 1/0). */
export function initParams(cfg: LmConfig, seed = 1337): LmParams {
  const rng = makeRng(seed)
  const { vocab, ctx, dim } = cfg
  const hidden = 4 * dim
  const layers: LayerParams[] = []
  for (let l = 0; l < cfg.layers; l++) {
    layers.push({
      ln1g: filled([dim], 1),
      ln1b: filled([dim], 0),
      wq: randMatrix(dim, dim, rng, 0.02),
      wk: randMatrix(dim, dim, rng, 0.02),
      wv: randMatrix(dim, dim, rng, 0.02),
      wo: randMatrix(dim, dim, rng, 0.02 / Math.sqrt(2 * cfg.layers)),
      ln2g: filled([dim], 1),
      ln2b: filled([dim], 0),
      w1: randMatrix(dim, hidden, rng, 0.02),
      b1: filled([hidden], 0),
      w2: randMatrix(hidden, dim, rng, 0.02 / Math.sqrt(2 * cfg.layers)),
      b2: filled([dim], 0),
    })
  }
  return {
    tokEmb: randMatrix(vocab, dim, rng, 0.02),
    posEmb: randMatrix(ctx, dim, rng, 0.02),
    layers,
    lnfg: filled([dim], 1),
    lnfb: filled([dim], 0),
  }
}

/** Liste plate des paramètres (ordre stable : sérialisation et optimiseur). */
export function paramList(p: LmParams): Tensor[] {
  const out: Tensor[] = [p.tokEmb, p.posEmb]
  for (const l of p.layers) {
    out.push(l.ln1g, l.ln1b, l.wq, l.wk, l.wv, l.wo, l.ln2g, l.ln2b, l.w1, l.b1, l.w2, l.b2)
  }
  out.push(p.lnfg, p.lnfb)
  return out
}

export function countParams(p: LmParams): number {
  return paramList(p).reduce((s, t) => s + t.size, 0)
}

/** Sérialise les poids en une chaîne base64 (Float32 little-endian). */
export function serializeWeights(p: LmParams): string {
  const list = paramList(p)
  const total = list.reduce((s, t) => s + t.size, 0)
  const flat = new Float32Array(total)
  let off = 0
  for (const t of list) {
    flat.set(t.data, off)
    off += t.size
  }
  return Buffer.from(flat.buffer).toString('base64')
}

/** Recharge des poids sérialisés dans une structure de paramètres de même config. */
export function deserializeWeights(cfg: LmConfig, base64: string): LmParams {
  const params = initParams(cfg, 1)
  const buf = Buffer.from(base64, 'base64')
  const flat = new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4)
  const list = paramList(params)
  const total = list.reduce((s, t) => s + t.size, 0)
  if (flat.length !== total) throw new Error(`poids incompatibles : ${flat.length} valeurs, ${total} attendues`)
  let off = 0
  for (const t of list) {
    t.data.set(flat.subarray(off, off + t.size))
    off += t.size
  }
  return params
}

// ── Passe avant ───────────────────────────────────────────────────────────────

/** Découpe [B*T, D] en têtes : → [B*H, T, dh]. */
function splitHeads(x: Tensor, B: number, T: number, H: number, dh: number): Tensor {
  const r = reshape(x, [B, T, H, dh])
  const p = permute(r, [0, 2, 1, 3]) // [B, H, T, dh]
  return reshape(p, [B * H, T, dh])
}

/** Inverse de splitHeads : [B*H, T, dh] → [B*T, D]. */
function mergeHeads(x: Tensor, B: number, T: number, H: number, dh: number): Tensor {
  const r = reshape(x, [B, H, T, dh])
  const p = permute(r, [0, 2, 1, 3]) // [B, T, H, dh]
  return reshape(p, [B * T, H * dh])
}

/**
 * Logits [B*T, V] pour une séquence d'indices [B*T] (B séquences de longueur T).
 */
export function forward(cfg: LmConfig, p: LmParams, idx: Int32Array, B: number, T: number): Tensor {
  const { heads: H, dim: D } = cfg
  const dh = D / H
  const posIdx = new Int32Array(B * T)
  for (let b = 0; b < B; b++) for (let t = 0; t < T; t++) posIdx[b * T + t] = t

  let x = add(embed(idx, p.tokEmb), embed(posIdx, p.posEmb)) // [BT, D]
  for (const l of p.layers) {
    // Attention multi-têtes causale
    const h = layerNorm(x, l.ln1g, l.ln1b)
    const q = splitHeads(gemm(h, l.wq), B, T, H, dh)
    const k = splitHeads(gemm(h, l.wk), B, T, H, dh)
    const v = splitHeads(gemm(h, l.wv), B, T, H, dh)
    const scores = scale(gemm(q, k, false, true), 1 / Math.sqrt(dh)) // [BH, T, T]
    const att = gemm(softmaxCausal(scores), v) // [BH, T, dh]
    x = add(x, gemm(mergeHeads(att, B, T, H, dh), l.wo))
    // MLP
    const h2 = layerNorm(x, l.ln2g, l.ln2b)
    const f = gelu(addBias(gemm(h2, l.w1), l.b1))
    x = add(x, addBias(gemm(f, l.w2), l.b2))
  }
  const hf = layerNorm(x, p.lnfg, p.lnfb)
  return gemm(hf, p.tokEmb, false, true) // tête liée : [BT, V]
}

/** Perte moyenne sur un lot (entrées x, cibles y, toutes de longueur B*T). */
export function batchLoss(cfg: LmConfig, p: LmParams, x: Int32Array, y: Int32Array, B: number, T: number): Tensor {
  return crossEntropy(forward(cfg, p, x, B, T), y)
}

// ── Tokenizer caractère ──────────────────────────────────────────────────────

export interface Vocab {
  /** itos[0] = caractère inconnu, itos[1] = saut de ligne. */
  itos: string[]
}

export const UNK_ID = 0
export const NL_ID = 1

/** Lexique : mots fréquents du corpus (minuscules, accents conservés). */
export function buildLexicon(text: string, minCount = 2, max = 6000): string[] {
  const counts = new Map<string, number>()
  for (const w of text.toLowerCase().split(/[^\p{L}']+/u)) {
    const word = w.replace(/^'+|'+$/g, '')
    if (word.length < 2) continue
    counts.set(word, (counts.get(word) ?? 0) + 1)
  }
  return [...counts.entries()]
    .filter(([, n]) => n >= minCount)
    .sort((a, b) => b[1] - a[1])
    .slice(0, max)
    .map(([w]) => w)
}

/** Part des mots d'un texte présents dans le lexique appris (1 = tout est connu). */
export function lexiconCoverage(text: string, lexicon: Set<string>): number {
  const words = text.toLowerCase().split(/[^\p{L}']+/u).map((w) => w.replace(/^'+|'+$/g, '')).filter((w) => w.length >= 3)
  if (words.length === 0) return 0
  return words.filter((w) => lexicon.has(w)).length / words.length
}

/** Construit le vocabulaire : caractères vus au moins `minCount` fois (plafond 320). */
export function buildVocab(text: string, minCount = 2): Vocab {
  const counts = new Map<string, number>()
  for (const ch of text) counts.set(ch, (counts.get(ch) ?? 0) + 1)
  const chars = [...counts.entries()]
    .filter(([ch, n]) => n >= minCount && ch !== '\n')
    .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
    .slice(0, 318)
    .map(([ch]) => ch)
  return { itos: ['\u0000', '\n', ...chars] }
}

/** Plafond du vocabulaire (poids d'embedding figés en taille : on ne grandit pas sans fin). */
export const MAX_VOCAB = 320

/**
 * Reprise d'apprentissage : ajoute au vocabulaire les caractères NOUVEAUX du corpus
 * (sinon le savoir ajouté après l'entraînement initial serait lu comme « inconnu »).
 */
export function extendVocab(vocab: Vocab, text: string, minCount = 2, cap = MAX_VOCAB): { vocab: Vocab; added: string[] } {
  const known = new Set(vocab.itos)
  const counts = new Map<string, number>()
  for (const ch of text) if (!known.has(ch)) counts.set(ch, (counts.get(ch) ?? 0) + 1)
  const room = cap - vocab.itos.length
  if (room <= 0) return { vocab, added: [] }
  const added = [...counts.entries()]
    .filter(([ch, n]) => n >= minCount && ch !== '\n')
    .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
    .slice(0, room)
    .map(([ch]) => ch)
  return { vocab: { itos: [...vocab.itos, ...added] }, added }
}

/**
 * Agrandit la table d'embeddings (lignes ajoutées initialisées comme à la création).
 * Les anciens poids sont conservés à l'identique : le modèle ne « perd » rien.
 */
export function growEmbedding(params: LmParams, oldRows: number, newRows: number, dim: number, seed = 7): LmParams {
  if (newRows <= oldRows) return params
  const rng = makeRng(seed + oldRows)
  const data = new Float32Array(newRows * dim)
  data.set(params.tokEmb.data.subarray(0, oldRows * dim))
  for (let i = oldRows * dim; i < data.length; i++) data[i] = gaussian(rng) * 0.02
  return { ...params, tokEmb: param(data, [newRows, dim]) }
}

export function encodeText(vocab: Vocab, text: string): Int32Array {
  const index = new Map<string, number>()
  vocab.itos.forEach((ch, i) => index.set(ch, i))
  const out = new Int32Array(text.length)
  let n = 0
  for (const ch of text) {
    const id = index.get(ch)
    out[n++] = id === undefined ? UNK_ID : id
  }
  return out.subarray(0, n)
}

export function decodeIds(vocab: Vocab, ids: number[]): string {
  return ids.map((i) => (i === UNK_ID ? '' : vocab.itos[i] ?? '')).join('')
}

export { noGrad }
