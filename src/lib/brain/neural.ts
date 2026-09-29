// ─── NEXUS Brain — Réseau de neurones codé from scratch ──────────────────────
// Perceptron multicouche (256 → 64 → 32 → N) avec rétropropagation manuelle,
// optimiseur Adam, vectoriseur par hachage (uni+bigrammes de radicaux).
// Aucune bibliothèque ML : tout est implémenté ici, entraînement inclus.

import { hashString, mulberry32, stems } from './text'

// ── Vectoriseur par hachage ───────────────────────────────────────────────────

export const INPUT_DIM = 256

/**
 * Transforme un texte en vecteur creux normalisé :
 * chaque radical (et bigramme de radicaux) est projeté via 2 fonctions de
 * hachage → réduit les collisions et gère le vocabulaire inconnu.
 */
export function vectorize(text: string): Float32Array {
  const vec = new Float32Array(INPUT_DIM)
  const st = stems(text)
  const grams: string[] = [...st]
  for (let i = 0; i < st.length - 1; i++) grams.push(`${st[i]}_${st[i + 1]}`)
  for (const g of grams) {
    const h1 = hashString(g) % INPUT_DIM
    const h2 = hashString(`#${g}`) % INPUT_DIM
    vec[h1] += 1
    vec[h2] += 1
  }
  let norm = 0
  for (let i = 0; i < INPUT_DIM; i++) norm += vec[i] * vec[i]
  norm = Math.sqrt(norm)
  if (norm > 0) for (let i = 0; i < INPUT_DIM; i++) vec[i] /= norm
  return vec
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

function matVecBackward(
  w: Float32Array, dw: Float32Array, x: Float32Array, dx: Float32Array,
  gradOut: Float32Array, nIn: number, nOut: number
): void {
  for (let i = 0; i < nIn; i++) dx[i] = 0
  for (let o = 0; o < nOut; o++) {
    const g = gradOut[o]
    if (g === 0) continue
    const base = o * nIn
    for (let i = 0; i < nIn; i++) {
      dw[base + i] += g * x[i]
      dx[i] += w[base + i] * g
    }
  }
}

function initWeights(rng: () => number, nIn: number, nOut: number): Float32Array {
  const w = new Float32Array(nIn * nOut)
  const scale = Math.sqrt(2 / nIn) // He init (ReLU)
  for (let i = 0; i < w.length; i++) w[i] = (rng() * 2 - 1) * scale
  return w
}

// ── Optimiseur Adam ───────────────────────────────────────────────────────────

interface AdamState {
  m: Float32Array
  v: Float32Array
  t: number
}

function adamUpdate(param: Float32Array, grad: Float32Array, state: AdamState, lr: number): void {
  const beta1 = 0.9
  const beta2 = 0.999
  const eps = 1e-8
  state.t++
  const bc1 = 1 - Math.pow(beta1, state.t)
  const bc2 = 1 - Math.pow(beta2, state.t)
  for (let i = 0; i < param.length; i++) {
    const g = grad[i]
    state.m[i] = beta1 * state.m[i] + (1 - beta1) * g
    state.v[i] = beta2 * state.v[i] + (1 - beta2) * g * g
    param[i] -= (lr * (state.m[i] / bc1)) / (Math.sqrt(state.v[i] / bc2) + eps)
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
      // ReLU
      for (let o = 0; o < layer.nOut; o++) if (z[o] < 0) z[o] = 0
    } else {
      // Softmax
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

/**
 * Entraîne le réseau sur le dataset d'intentions (échantillons {text, label}).
 * Retourne un réseau prêt à l'emploi + la précision mesurée sur l'ensemble.
 */
export function trainNetwork(samples: TrainSample[], labels: string[]): TrainedNet {
  const rng = mulberry32(20240613)
  const nOut = labels.length
  const net: TrainedNet = {
    layers: [makeLayer(rng, INPUT_DIM, 64), makeLayer(rng, 64, 32), makeLayer(rng, 32, nOut)],
    labels,
    accuracy: 0,
  }

  const vecs = samples.map((s) => ({ x: vectorize(s.text), y: s.label }))
  const EPOCHS = 90
  const BATCH = 16
  const LR = 0.008

  // Buffers de gradient réutilisés
  const dims: [number, number][] = [[INPUT_DIM, 64], [64, 32], [32, nOut]]
  const gradCaches = dims.map(([ni, no]) => new Float32Array(no))

  const order = vecs.map((_, i) => i)
  for (let epoch = 0; epoch < EPOCHS; epoch++) {
    // Mélange déterministe (Fisher-Yates avec le rng)
    for (let i = order.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1))
      ;[order[i], order[j]] = [order[j], order[i]]
    }
    for (let start = 0; start < order.length; start += BATCH) {
      const batch = order.slice(start, start + BATCH)
      // Zéro les gradients
      for (const layer of net.layers) {
        layer.dw.fill(0)
        layer.db.fill(0)
      }
      for (const idx of batch) {
        const { x, y } = vecs[idx]
        const { activations, probs } = forward(net, x)
        // Gradient softmax + entropie croisée : dL/dz = p - onehot(y)
        const grad = gradCaches[2]
        for (let o = 0; o < nOut; o++) grad[o] = probs[o] - (o === y ? 1 : 0)
        // Rétropropagation couche par couche
        let gradCur = grad
        for (let li = net.layers.length - 1; li >= 0; li--) {
          const layer = net.layers[li]
          const inputAct = activations[li]
          const dx = new Float32Array(layer.nIn)
          matVecBackward(layer.w, layer.dw, inputAct, dx, gradCur, layer.nIn, layer.nOut)
          for (let o = 0; o < layer.nOut; o++) layer.db[o] += gradCur[o]
          // ReLU dérivé (la couche précédente reçoit dx masqué)
          if (li > 0) {
            for (let i = 0; i < layer.nIn; i++) if (inputAct[i] <= 0) dx[i] = 0
            gradCur = dx
          }
        }
      }
      // Mise à jour Adam (gradients moyennés par la taille du batch)
      const k = 1 / batch.length
      for (const layer of net.layers) {
        for (let i = 0; i < layer.dw.length; i++) layer.dw[i] *= k
        for (let i = 0; i < layer.db.length; i++) layer.db[i] *= k
        adamUpdate(layer.w, layer.dw, layer.adamW, LR)
        adamUpdate(layer.b, layer.db, layer.adamB, LR)
      }
    }
  }

  // Précision d'entraînement (diagnostic)
  let correct = 0
  for (const s of vecs) {
    const { probs } = forward(net, s.x)
    let best = 0
    for (let o = 1; o < nOut; o++) if (probs[o] > probs[best]) best = o
    if (best === s.y) correct++
  }
  net.accuracy = correct / vecs.length
  return net
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
