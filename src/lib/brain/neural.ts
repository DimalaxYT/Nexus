// ─── NEXUS Brain — Réseau de neurones profond & similarité sémantique ────────
// Perceptron multicouche (512 → 96 → 48 → N) avec rétropropagation manuelle,
// optimiseur Adam, régularisation L2 et vectoriseur hybride (uni/bi/trigrammes
// de radicaux + n-grammes de caractères 3-4 pour tolérer fautes et variantes).

import { hashString, mulberry32, normalize, stems } from './text'

// ── Vectoriseur par hachage multi-échelle (radicaux + sous-mots) ─────────────

export const INPUT_DIM = 512

/**
 * Transforme un texte en vecteur dense normalisé L2 :
 * - Radicaux (unigrammes, poids 1.4)
 * - Bigrammes et trigrammes de radicaux (ordre local, poids 1.1)
 * - N-grammes de caractères (3 et 4 chars, poids 0.45) pour capter la morphologie
 *   et résister aux fautes de frappe / conjugaisons / termes techniques.
 */
export function vectorize(text: string): Float32Array {
  const vec = new Float32Array(INPUT_DIM)
  const st = stems(text)

  for (const w of st) {
    const h1 = hashString(w) % INPUT_DIM
    const h2 = hashString(`#${w}`) % INPUT_DIM
    vec[h1] += 1.4
    vec[h2] += 1.4
  }

  for (let i = 0; i < st.length - 1; i++) {
    const bg = `${st[i]}_${st[i + 1]}`
    vec[hashString(bg) % INPUT_DIM] += 1.1
    vec[hashString(`#${bg}`) % INPUT_DIM] += 1.1
  }

  for (let i = 0; i < st.length - 2; i++) {
    const tg = `${st[i]}_${st[i + 1]}_${st[i + 2]}`
    vec[hashString(tg) % INPUT_DIM] += 0.9
  }

  const rawWords = normalize(text)
    .split(/\s+/)
    .filter((w) => w.length >= 4)
  for (const word of rawWords) {
    const padded = `<${word}>`
    for (let n = 3; n <= 4; n++) {
      for (let i = 0; i <= padded.length - n; i++) {
        const sub = padded.slice(i, i + n)
        vec[hashString(`~${sub}`) % INPUT_DIM] += 0.45
      }
    }
  }

  let norm = 0
  for (let i = 0; i < INPUT_DIM; i++) norm += vec[i] * vec[i]
  norm = Math.sqrt(norm)
  if (norm > 0) for (let i = 0; i < INPUT_DIM; i++) vec[i] /= norm
  return vec
}

/** Similarité cosinus sémantique entre deux textes (0 → 1). */
export function semanticSimilarity(a: string, b: string): number {
  const va = vectorize(a)
  const vb = vectorize(b)
  let dot = 0
  for (let i = 0; i < INPUT_DIM; i++) dot += va[i] * vb[i]
  return Math.max(0, Math.min(1, dot))
}

// ── Utilitaires matriciels (Float32Array plats pour la performance) ───────────

function matVec(w: Float32Array, x: Float32Array, out: Float32Array, nIn: number, nOut: number): void {
  for (let o = 0; o < nOut; o++) {
    let sum = 0
    const base = o * nIn
    for (let i = 0; i < nIn; i++) sum += w[base + i] * x[i]
    out[o] = sum
  }
}

function initWeights(rng: () => number, nIn: number, nOut: number): Float32Array {
  const w = new Float32Array(nIn * nOut)
  const scale = Math.sqrt(2 / nIn) // He init (ReLU)
  for (let i = 0; i < w.length; i++) w[i] = (rng() * 2 - 1) * scale
  return w
}

// ── Optimiseur Adam + Weight Decay (AdamW léger) ─────────────────────────────

interface AdamState {
  m: Float32Array
  v: Float32Array
  t: number
}

function adamUpdate(param: Float32Array, grad: Float32Array, state: AdamState, lr: number, weightDecay = 0): void {
  const beta1 = 0.9
  const beta2 = 0.999
  const eps = 1e-8
  state.t++
  const bc1 = 1 - Math.pow(beta1, state.t)
  const bc2 = 1 - Math.pow(beta2, state.t)
  const m = state.m
  const v = state.v
  const n = param.length
  // Mêmes expressions, dans le même ordre, que la version d'origine : les poids
  // obtenus sont identiques au bit près (seules les lectures sont hissées).
  if (weightDecay > 0) {
    for (let i = 0; i < n; i++) {
      const g = grad[i] + weightDecay * param[i]
      m[i] = beta1 * m[i] + (1 - beta1) * g
      v[i] = beta2 * v[i] + (1 - beta2) * g * g
      param[i] -= (lr * (m[i] / bc1)) / (Math.sqrt(v[i] / bc2) + eps)
    }
  } else {
    for (let i = 0; i < n; i++) {
      const g = grad[i] + 0
      m[i] = beta1 * m[i] + (1 - beta1) * g
      v[i] = beta2 * v[i] + (1 - beta2) * g * g
      param[i] -= (lr * (m[i] / bc1)) / (Math.sqrt(v[i] / bc2) + eps)
    }
  }
}

// ── Réseau ────────────────────────────────────────────────────────────────────

interface Layer {
  w: Float32Array
  b: Float32Array
  dw: Float32Array
  db: Float32Array
  adamW: AdamState
  adamB: AdamState
  nIn: number
  nOut: number
}

export interface TrainSample {
  text: string
  label: number
}

export interface TrainedNet {
  layers: Layer[]
  labels: string[]
  accuracy: number
}

/** Architecture et hyperparamètres : toute modification invalide les poids livrés. */
export const NET_SPEC = {
  inputDim: INPUT_DIM,
  hidden: [96, 48] as const,
  epochs: 85,
  batch: 16,
  lr: 0.007,
  weightDecay: 1e-4,
  seed: 20240613,
} as const

function makeLayer(rng: () => number, nIn: number, nOut: number): Layer {
  return {
    w: initWeights(rng, nIn, nOut),
    b: new Float32Array(nOut),
    dw: new Float32Array(nIn * nOut),
    db: new Float32Array(nOut),
    adamW: { m: new Float32Array(nIn * nOut), v: new Float32Array(nIn * nOut), t: 0 },
    adamB: { m: new Float32Array(nOut), v: new Float32Array(nOut), t: 0 },
    nIn,
    nOut,
  }
}

function forward(net: TrainedNet, x: Float32Array): { activations: Float32Array[]; probs: Float32Array } {
  const activations: Float32Array[] = [x]
  let cur = x
  for (let li = 0; li < net.layers.length; li++) {
    const layer = net.layers[li]
    const z = new Float32Array(layer.nOut)
    matVec(layer.w, cur, z, layer.nIn, layer.nOut)
    for (let o = 0; o < layer.nOut; o++) z[o] += layer.b[o]
    const isLast = li === net.layers.length - 1
    if (!isLast) {
      // Leaky ReLU (évite les neurones morts)
      for (let o = 0; o < layer.nOut; o++) if (z[o] < 0) z[o] *= 0.05
    } else {
      let max = -Infinity
      for (let o = 0; o < layer.nOut; o++) if (z[o] > max) max = z[o]
      let sum = 0
      for (let o = 0; o < layer.nOut; o++) {
        z[o] = Math.exp(z[o] - max)
        sum += z[o]
      }
      for (let o = 0; o < layer.nOut; o++) z[o] /= sum
    }
    activations.push(z)
    cur = z
  }
  return { activations, probs: cur }
}

// ── Entraînement ──────────────────────────────────────────────────────────────
// Le vecteur d'entrée est très creux (≈ 40 composantes non nulles sur 512) :
// la première couche ne parcourt que ces composantes, et le gradient d'entrée
// de cette couche (jamais utilisé) n'est plus calculé. Aucun tableau n'est
// alloué par échantillon. Les opérations restantes sont exactement celles de
// la version dense, dans le même ordre : les poids sont identiques au bit près
// (ajouter un terme nul à une somme ne la change pas).
//
// L'entraînement est REPRENABLE : `run(budgetMs)` avance par tranches, ce qui
// permet de l'exécuter au démarrage sans bloquer la boucle d'événements, et de
// le terminer d'un coup si une requête a besoin du réseau entre-temps.

interface SparseInput {
  idx: Int32Array
  val: Float32Array
}

function toSparse(x: Float32Array): SparseInput {
  let n = 0
  for (let i = 0; i < x.length; i++) if (x[i] !== 0) n++
  const idx = new Int32Array(n)
  const val = new Float32Array(n)
  let k = 0
  for (let i = 0; i < x.length; i++) {
    if (x[i] !== 0) {
      idx[k] = i
      val[k] = x[i]
      k++
    }
  }
  return { idx, val }
}

export interface NetTrainer {
  readonly net: TrainedNet
  /** Avance l'entraînement pendant `budgetMs` (par défaut : jusqu'au bout). Vrai une fois terminé. */
  run(budgetMs?: number): boolean
  readonly done: boolean
  /** Avancement 0 → 1. */
  progress(): number
}

/**
 * Prépare l'entraînement du réseau sur le dataset d'intentions. `vectors`
 * (facultatif) évite de revectoriser des textes déjà vectorisés par l'appelant.
 */
export function createTrainer(samples: TrainSample[], labels: string[], vectors?: Float32Array[]): NetTrainer {
  const rng = mulberry32(NET_SPEC.seed)
  const nOut = labels.length
  const [H1, H2] = NET_SPEC.hidden
  const net: TrainedNet = {
    layers: [makeLayer(rng, INPUT_DIM, H1), makeLayer(rng, H1, H2), makeLayer(rng, H2, nOut)],
    labels,
    accuracy: 0,
  }
  const dense = samples.map((s, i) => vectors?.[i] ?? vectorize(s.text))
  const inputs = dense.map(toSparse)
  const ys = samples.map((s) => s.label)
  const { epochs: EPOCHS, batch: BATCH, lr: LR, weightDecay: WD } = NET_SPEC

  const [L0, L1, L2] = net.layers
  const a1 = new Float32Array(H1)
  const a2 = new Float32Array(H2)
  const z2 = new Float32Array(nOut)
  const g2 = new Float32Array(nOut)
  const dx2 = new Float32Array(H2)
  const dx1 = new Float32Array(H1)

  /** Passe avant d'un échantillon (remplit a1, a2, z2 = probabilités). */
  const forwardSample = (inp: SparseInput): void => {
    const { idx, val } = inp
    const nnz = idx.length
    const w0 = L0.w
    for (let o = 0; o < H1; o++) {
      const base = o * INPUT_DIM
      let sum = 0
      for (let k = 0; k < nnz; k++) sum += w0[base + idx[k]] * val[k]
      a1[o] = sum
      a1[o] += L0.b[o]
      if (a1[o] < 0) a1[o] *= 0.05
    }
    const w1 = L1.w
    for (let o = 0; o < H2; o++) {
      const base = o * H1
      let sum = 0
      for (let i = 0; i < H1; i++) sum += w1[base + i] * a1[i]
      a2[o] = sum
      a2[o] += L1.b[o]
      if (a2[o] < 0) a2[o] *= 0.05
    }
    const w2 = L2.w
    for (let o = 0; o < nOut; o++) {
      const base = o * H2
      let sum = 0
      for (let i = 0; i < H2; i++) sum += w2[base + i] * a2[i]
      z2[o] = sum
      z2[o] += L2.b[o]
    }
    let max = -Infinity
    for (let o = 0; o < nOut; o++) if (z2[o] > max) max = z2[o]
    let sum = 0
    for (let o = 0; o < nOut; o++) {
      z2[o] = Math.exp(z2[o] - max)
      sum += z2[o]
    }
    for (let o = 0; o < nOut; o++) z2[o] /= sum
  }

  /** Rétropropagation d'un échantillon (accumule dw/db). */
  const backwardSample = (inp: SparseInput, y: number): void => {
    for (let o = 0; o < nOut; o++) g2[o] = z2[o] - (o === y ? 1 : 0)
    // Couche 3 (48 → N)
    {
      const { w, dw, db } = L2
      dx2.fill(0)
      for (let o = 0; o < nOut; o++) {
        const g = g2[o]
        if (g === 0) continue
        const base = o * H2
        for (let i = 0; i < H2; i++) {
          dw[base + i] += g * a2[i]
          dx2[i] += w[base + i] * g
        }
      }
      for (let o = 0; o < nOut; o++) db[o] += g2[o]
      for (let i = 0; i < H2; i++) if (a2[i] <= 0) dx2[i] *= 0.05
    }
    // Couche 2 (96 → 48)
    {
      const { w, dw, db } = L1
      dx1.fill(0)
      for (let o = 0; o < H2; o++) {
        const g = dx2[o]
        if (g === 0) continue
        const base = o * H1
        for (let i = 0; i < H1; i++) {
          dw[base + i] += g * a1[i]
          dx1[i] += w[base + i] * g
        }
      }
      for (let o = 0; o < H2; o++) db[o] += dx2[o]
      for (let i = 0; i < H1; i++) if (a1[i] <= 0) dx1[i] *= 0.05
    }
    // Couche 1 (512 → 96), entrée creuse : seul dw est utile
    {
      const { dw, db } = L0
      const { idx, val } = inp
      const nnz = idx.length
      for (let o = 0; o < H1; o++) {
        const g = dx1[o]
        if (g === 0) continue
        const base = o * INPUT_DIM
        for (let k = 0; k < nnz; k++) dw[base + idx[k]] += g * val[k]
      }
      for (let o = 0; o < H1; o++) db[o] += dx1[o]
    }
  }

  const order = inputs.map((_, i) => i)
  const batchesPerEpoch = Math.ceil(order.length / BATCH)
  const totalBatches = EPOCHS * batchesPerEpoch
  let epoch = 0
  let start = 0
  let batchesDone = 0
  let done = false

  const shuffle = () => {
    for (let i = order.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1))
      ;[order[i], order[j]] = [order[j], order[i]]
    }
  }

  const trainBatch = () => {
    const end = Math.min(start + BATCH, order.length)
    for (const layer of net.layers) {
      layer.dw.fill(0)
      layer.db.fill(0)
    }
    for (let p = start; p < end; p++) {
      const idx = order[p]
      forwardSample(inputs[idx])
      backwardSample(inputs[idx], ys[idx])
    }
    const k = 1 / (end - start)
    for (const layer of net.layers) {
      const { dw, db } = layer
      for (let i = 0; i < dw.length; i++) dw[i] *= k
      for (let i = 0; i < db.length; i++) db[i] *= k
      adamUpdate(layer.w, dw, layer.adamW, LR, WD)
      adamUpdate(layer.b, db, layer.adamB, LR, 0)
    }
    start = end
    batchesDone++
  }

  const finish = () => {
    let correct = 0
    for (let s = 0; s < inputs.length; s++) {
      forwardSample(inputs[s])
      let best = 0
      for (let o = 1; o < nOut; o++) if (z2[o] > z2[best]) best = o
      if (best === ys[s]) correct++
    }
    net.accuracy = inputs.length ? correct / inputs.length : 0
    done = true
  }

  return {
    net,
    get done() {
      return done
    },
    progress: () => (done ? 1 : batchesDone / Math.max(1, totalBatches)),
    run(budgetMs = Infinity) {
      if (done) return true
      const deadline = Date.now() + budgetMs
      while (epoch < EPOCHS) {
        if (start === 0) shuffle()
        while (start < order.length) {
          trainBatch()
          if (Date.now() >= deadline && (start < order.length || epoch + 1 < EPOCHS)) {
            if (start >= order.length) {
              epoch++
              start = 0
            }
            return false
          }
        }
        epoch++
        start = 0
      }
      finish()
      return true
    },
  }
}

/**
 * Entraîne le réseau sur le dataset d'intentions (échantillons {text, label}).
 * Retourne un réseau prêt à l'emploi + la précision mesurée sur l'ensemble.
 */
export function trainNetwork(samples: TrainSample[], labels: string[], vectors?: Float32Array[]): TrainedNet {
  const trainer = createTrainer(samples, labels, vectors)
  trainer.run()
  return trainer.net
}

// ── Poids livrés : sérialisation Float32 little-endian ───────────────────────

/** Nombre de flottants des poids (w puis b de chaque couche). */
export function netFloatCount(dims: number[]): number {
  let n = 0
  for (let i = 0; i + 1 < dims.length; i++) n += dims[i] * dims[i + 1] + dims[i + 1]
  return n
}

/** Dimensions des couches : [entrée, cachées…, sorties]. */
export function netDims(labelsCount: number): number[] {
  return [INPUT_DIM, ...NET_SPEC.hidden, labelsCount]
}

/** Poids du réseau → octets (w puis b de chaque couche, Float32 LE). */
export function serializeNet(net: TrainedNet): Uint8Array {
  const dims = [net.layers[0].nIn, ...net.layers.map((l) => l.nOut)]
  const out = new Uint8Array(netFloatCount(dims) * 4)
  const view = new DataView(out.buffer)
  let off = 0
  for (const layer of net.layers) {
    for (const arr of [layer.w, layer.b]) {
      for (let i = 0; i < arr.length; i++, off += 4) view.setFloat32(off, arr[i], true)
    }
  }
  return out
}

/** Octets → réseau prêt pour l'inférence (sans état d'optimiseur). */
export function deserializeNet(bytes: Uint8Array, labels: string[], accuracy: number): TrainedNet {
  const dims = netDims(labels.length)
  if (bytes.byteLength !== netFloatCount(dims) * 4) {
    throw new Error(`poids du classifieur : ${bytes.byteLength} octets, ${netFloatCount(dims) * 4} attendus`)
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const empty = new Float32Array(0)
  const layers: Layer[] = []
  let off = 0
  for (let li = 0; li + 1 < dims.length; li++) {
    const nIn = dims[li]
    const nOut = dims[li + 1]
    const w = new Float32Array(nIn * nOut)
    const b = new Float32Array(nOut)
    for (let i = 0; i < w.length; i++, off += 4) w[i] = view.getFloat32(off, true)
    for (let i = 0; i < b.length; i++, off += 4) b[i] = view.getFloat32(off, true)
    layers.push({
      w,
      b,
      dw: empty,
      db: empty,
      adamW: { m: empty, v: empty, t: 0 },
      adamB: { m: empty, v: empty, t: 0 },
      nIn,
      nOut,
    })
  }
  return { layers, labels, accuracy }
}

/** Prédit l'intention la plus probable + distribution complète. */
export function predict(net: TrainedNet, text: string): { label: string; confidence: number; dist: Map<string, number> } {
  const { probs } = forward(net, vectorize(text))
  const dist = new Map<string, number>()
  let best = 0
  for (let o = 0; o < net.labels.length; o++) {
    dist.set(net.labels[o], probs[o])
    if (probs[o] > probs[best]) best = o
  }
  return { label: net.labels[best], confidence: probs[best], dist }
}
