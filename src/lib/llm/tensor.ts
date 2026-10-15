// ─── NEXUS — Moteur de différentiation automatique (autograd) pour le LLM maison ─
// Petit moteur de tenseurs 100 % TypeScript (Float32Array, CPU), suffisant pour
// entraîner et exécuter un transformeur décodeur à partir de zéro. Aucune
// dépendance externe : pas de TensorFlow, pas d'ONNX, pas d'API.
//
// Principe : chaque opération crée un nouveau Tensor qui mémorise ses parents et
// une fonction de rétropropagation (backFn). `backward(loss)` parcourt le graphe
// dans l'ordre topologique inverse et accumule les gradients dans `grad`.
// En mode `noGrad` (inférence), aucun graphe n'est construit : c'est rapide.

export class Tensor {
  readonly data: Float32Array
  readonly shape: number[]
  readonly size: number
  grad: Float32Array | null = null
  parents: Tensor[] = []
  backFn: (() => void) | null = null
  requiresGrad: boolean

  constructor(data: Float32Array, shape: number[], requiresGrad = false) {
    this.data = data
    this.shape = shape
    this.size = data.length
    this.requiresGrad = requiresGrad
  }
}

let gradEnabled = true

/** Exécute `fn` sans construire de graphe (inférence : ~2× plus rapide, moins de RAM). */
export function noGrad<T>(fn: () => T): T {
  const prev = gradEnabled
  gradEnabled = false
  try {
    return fn()
  } finally {
    gradEnabled = prev
  }
}

/** Paramètre entraînable (poids). */
export function param(data: Float32Array, shape: number[]): Tensor {
  return new Tensor(data, shape, true)
}

/** Crée le résultat d'une opération et rattache son graphe si nécessaire. */
function make(data: Float32Array, shape: number[], parents: Tensor[], backFn: () => void): Tensor {
  const out = new Tensor(data, shape)
  if (gradEnabled && parents.some((p) => p.requiresGrad)) {
    out.requiresGrad = true
    out.parents = parents
    out.backFn = backFn
  }
  return out
}

function ensureGrad(t: Tensor): Float32Array {
  if (!t.grad) t.grad = new Float32Array(t.size)
  return t.grad
}

function addInto(dst: Tensor, src: Float32Array): void {
  const g = ensureGrad(dst)
  for (let i = 0; i < g.length; i++) g[i] += src[i]
}

/** Rétropropagation depuis une sortie scalaire. */
export function backward(root: Tensor): void {
  const order: Tensor[] = []
  const seen = new Set<Tensor>()
  const visit = (t: Tensor) => {
    if (seen.has(t)) return
    seen.add(t)
    for (const p of t.parents) visit(p)
    order.push(t)
  }
  visit(root)
  ensureGrad(root).fill(1)
  for (let i = order.length - 1; i >= 0; i--) {
    const t = order[i]
    if (t.backFn) t.backFn()
  }
}

// ── Produit matriciel générique (avec transpositions) ───────────────────────

/**
 * out[g] = op(A_g) · op(B_g), op = transposition optionnelle.
 * A est stockée [G, ar, ac] ; B est stockée [G, br, bc].
 * Dimensions logiques : op(A) [M, Kc], op(B) [Kc, Nn].
 */
function gemmKernel(
  a: Float32Array,
  ar: number,
  ac: number,
  tA: boolean,
  b: Float32Array,
  br: number,
  bc: number,
  tB: boolean,
  G: number,
  out: Float32Array,
  M: number,
  Kc: number,
  Nn: number
): void {
  const aStride = ar * ac
  const bStride = br * bc
  const oStride = M * Nn
  for (let g = 0; g < G; g++) {
    const aOff = g * aStride
    const bOff = g * bStride
    const oOff = g * oStride
    for (let i = 0; i < M; i++) {
      const oRow = oOff + i * Nn
      for (let k = 0; k < Kc; k++) {
        const av = tA ? a[aOff + k * ac + i] : a[aOff + i * ac + k]
        if (av === 0) continue
        if (!tB) {
          const bRow = bOff + k * bc
          for (let j = 0; j < Nn; j++) out[oRow + j] += av * b[bRow + j]
        } else {
          for (let j = 0; j < Nn; j++) out[oRow + j] += av * b[bOff + j * bc + k]
        }
      }
    }
  }
}

/** Ajoute un tenseur [G, rows, cols] (forme logique) dans dst, éventuellement transposé. */
function accumulateGemm(dst: Float32Array, src: Float32Array, G: number, rows: number, cols: number, transposed: boolean): void {
  const stride = rows * cols
  for (let g = 0; g < G; g++) {
    const off = g * stride
    if (!transposed) {
      for (let i = 0; i < stride; i++) dst[off + i] += src[off + i]
    } else {
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) dst[off + c * rows + r] += src[off + r * cols + c]
      }
    }
  }
}

/**
 * Multiplication matricielle, éventuellement batchée (a et b de rang 3 avec le même G).
 * tA / tB : utiliser la transposée de A / B.
 */
export function gemm(a: Tensor, b: Tensor, tA = false, tB = false): Tensor {
  const batched = a.shape.length === 3
  const G = batched ? a.shape[0] : 1
  const ar = a.shape[batched ? 1 : 0]
  const ac = a.shape[batched ? 2 : 1]
  const br = b.shape[batched ? 1 : 0]
  const bc = b.shape[batched ? 2 : 1]
  const M = tA ? ac : ar
  const Kc = tA ? ar : ac
  const Kb = tB ? bc : br
  const Nn = tB ? br : bc
  if (Kc !== Kb) throw new Error(`gemm : dimensions incompatibles [${a.shape}] x [${b.shape}] (tA=${tA}, tB=${tB})`)
  const out = new Float32Array(G * M * Nn)
  gemmKernel(a.data, ar, ac, tA, b.data, br, bc, tB, G, out, M, Kc, Nn)
  const shape = batched ? [G, M, Nn] : [M, Nn]
  const res: Tensor = make(out, shape, [a, b], () => {
    const dC = res.grad as Float32Array
    if (a.requiresGrad) {
      // dA_op = dC · op(B)ᵀ  → [M, Kc]
      const tmp = new Float32Array(G * M * Kc)
      gemmKernel(dC, M, Nn, false, b.data, br, bc, !tB, G, tmp, M, Nn, Kc)
      accumulateGemm(ensureGrad(a), tmp, G, M, Kc, tA)
    }
    if (b.requiresGrad) {
      // dB_op = op(A)ᵀ · dC  → [Kc, Nn]
      const tmp = new Float32Array(G * Kc * Nn)
      gemmKernel(a.data, ar, ac, !tA, dC, M, Nn, false, G, tmp, Kc, M, Nn)
      accumulateGemm(ensureGrad(b), tmp, G, Kc, Nn, tB)
    }
  })
  return res
}

// ── Opérations élémentaires ────────────────────────────────────────────────

export function add(a: Tensor, b: Tensor): Tensor {
  if (a.size !== b.size) throw new Error('add : tailles différentes')
  const out = new Float32Array(a.size)
  for (let i = 0; i < out.length; i++) out[i] = a.data[i] + b.data[i]
  const res: Tensor = make(out, a.shape, [a, b], () => {
    const g = res.grad as Float32Array
    if (a.requiresGrad) addInto(a, g)
    if (b.requiresGrad) addInto(b, g)
  })
  return res
}

/** x [N, D] + bias [D] (diffusé sur les lignes). */
export function addBias(x: Tensor, bias: Tensor): Tensor {
  const D = bias.size
  const N = x.size / D
  const out = new Float32Array(x.size)
  for (let i = 0; i < N; i++) for (let j = 0; j < D; j++) out[i * D + j] = x.data[i * D + j] + bias.data[j]
  const res: Tensor = make(out, x.shape, [x, bias], () => {
    const g = res.grad as Float32Array
    if (x.requiresGrad) addInto(x, g)
    if (bias.requiresGrad) {
      const gb = ensureGrad(bias)
      for (let i = 0; i < N; i++) for (let j = 0; j < D; j++) gb[j] += g[i * D + j]
    }
  })
  return res
}

export function scale(x: Tensor, s: number): Tensor {
  const out = new Float32Array(x.size)
  for (let i = 0; i < out.length; i++) out[i] = x.data[i] * s
  const res: Tensor = make(out, x.shape, [x], () => {
    const g = res.grad as Float32Array
    if (x.requiresGrad) {
      const gx = ensureGrad(x)
      for (let i = 0; i < gx.length; i++) gx[i] += g[i] * s
    }
  })
  return res
}

const GELU_C = Math.sqrt(2 / Math.PI)

export function gelu(x: Tensor): Tensor {
  const out = new Float32Array(x.size)
  for (let i = 0; i < out.length; i++) {
    const v = x.data[i]
    out[i] = 0.5 * v * (1 + Math.tanh(GELU_C * (v + 0.044715 * v * v * v)))
  }
  const res: Tensor = make(out, x.shape, [x], () => {
    const g = res.grad as Float32Array
    if (!x.requiresGrad) return
    const gx = ensureGrad(x)
    for (let i = 0; i < gx.length; i++) {
      const v = x.data[i]
      const u = GELU_C * (v + 0.044715 * v * v * v)
      const t = Math.tanh(u)
      const d = 0.5 * (1 + t) + 0.5 * v * (1 - t * t) * GELU_C * (1 + 3 * 0.044715 * v * v)
      gx[i] += g[i] * d
    }
  })
  return res
}

/** LayerNorm sur le dernier axe. x [N, D], gamma [D], beta [D]. */
export function layerNorm(x: Tensor, gamma: Tensor, beta: Tensor, eps = 1e-5): Tensor {
  const D = gamma.size
  const N = x.size / D
  const out = new Float32Array(x.size)
  const xhat = new Float32Array(x.size)
  const rstd = new Float32Array(N)
  for (let i = 0; i < N; i++) {
    let mean = 0
    for (let j = 0; j < D; j++) mean += x.data[i * D + j]
    mean /= D
    let variance = 0
    for (let j = 0; j < D; j++) {
      const d = x.data[i * D + j] - mean
      variance += d * d
    }
    variance /= D
    const r = 1 / Math.sqrt(variance + eps)
    rstd[i] = r
    for (let j = 0; j < D; j++) {
      const h = (x.data[i * D + j] - mean) * r
      xhat[i * D + j] = h
      out[i * D + j] = h * gamma.data[j] + beta.data[j]
    }
  }
  const res: Tensor = make(out, x.shape, [x, gamma, beta], () => {
    const g = res.grad as Float32Array
    const gg = gamma.requiresGrad ? ensureGrad(gamma) : null
    const gbeta = beta.requiresGrad ? ensureGrad(beta) : null
    const gx = x.requiresGrad ? ensureGrad(x) : null
    for (let i = 0; i < N; i++) {
      let sumDh = 0
      let sumDhH = 0
      for (let j = 0; j < D; j++) {
        const dy = g[i * D + j]
        const h = xhat[i * D + j]
        if (gg) gg[j] += dy * h
        if (gbeta) gbeta[j] += dy
        const dh = dy * gamma.data[j]
        sumDh += dh
        sumDhH += dh * h
      }
      if (gx) {
        for (let j = 0; j < D; j++) {
          const dh = g[i * D + j] * gamma.data[j]
          gx[i * D + j] += rstd[i] * (dh - sumDh / D - xhat[i * D + j] * (sumDhH / D))
        }
      }
    }
  })
  return res
}

/**
 * Softmax causal : s [G, T, T] ; la ligne i ne voit que les colonnes j ≤ i.
 * (Les positions masquées ont une probabilité nulle.)
 */
export function softmaxCausal(s: Tensor): Tensor {
  const T = s.shape[s.shape.length - 1]
  const rows = s.size / T
  const out = new Float32Array(s.size)
  for (let r = 0; r < rows; r++) {
    const i = r % T // position de la requête dans la séquence
    const off = r * T
    let max = -Infinity
    for (let j = 0; j <= i; j++) if (s.data[off + j] > max) max = s.data[off + j]
    let sum = 0
    for (let j = 0; j <= i; j++) {
      const e = Math.exp(s.data[off + j] - max)
      out[off + j] = e
      sum += e
    }
    for (let j = 0; j <= i; j++) out[off + j] /= sum
  }
  const res: Tensor = make(out, s.shape, [s], () => {
    const g = res.grad as Float32Array
    if (!s.requiresGrad) return
    const gs = ensureGrad(s)
    for (let r = 0; r < rows; r++) {
      const i = r % T
      const off = r * T
      let dot = 0
      for (let j = 0; j <= i; j++) dot += g[off + j] * out[off + j]
      for (let j = 0; j <= i; j++) gs[off + j] += out[off + j] * (g[off + j] - dot)
    }
  })
  return res
}

/** Redimensionnement (même données, autre forme). */
export function reshape(x: Tensor, shape: number[]): Tensor {
  const size = shape.reduce((p, c) => p * c, 1)
  if (size !== x.size) throw new Error(`reshape : ${x.size} éléments ≠ [${shape}]`)
  const res: Tensor = make(x.data, shape, [x], () => {
    if (x.requiresGrad) addInto(x, res.grad as Float32Array)
  })
  return res
}

function permuteRaw(src: Float32Array, shape: number[], perm: number[]): Float32Array {
  const rank = shape.length
  const outShape = perm.map((p) => shape[p])
  const srcStride = new Array<number>(rank)
  let acc = 1
  for (let d = rank - 1; d >= 0; d--) {
    srcStride[d] = acc
    acc *= shape[d]
  }
  const out = new Float32Array(src.length)
  const idx = new Array<number>(rank).fill(0)
  for (let o = 0; o < out.length; o++) {
    let s = 0
    for (let d = 0; d < rank; d++) s += idx[d] * srcStride[perm[d]]
    out[o] = src[s]
    // incrémente l'indice de sortie (dernier axe le plus rapide)
    for (let d = rank - 1; d >= 0; d--) {
      idx[d]++
      if (idx[d] < outShape[d]) break
      idx[d] = 0
    }
  }
  return out
}

/** Permutation des axes (rang ≤ 4). */
export function permute(x: Tensor, perm: number[]): Tensor {
  const outShape = perm.map((p) => x.shape[p])
  const out = permuteRaw(x.data, x.shape, perm)
  const inv = new Array<number>(perm.length)
  perm.forEach((p, d) => (inv[p] = d))
  const res: Tensor = make(out, outShape, [x], () => {
    if (!x.requiresGrad) return
    const back = permuteRaw(res.grad as Float32Array, outShape, inv)
    addInto(x, back)
  })
  return res
}

/** Lookup d'embeddings : W [V, D], indices → [N, D]. */
export function embed(indices: Int32Array, W: Tensor): Tensor {
  const D = W.size / (W.shape[0] || 1)
  const N = indices.length
  const out = new Float32Array(N * D)
  for (let i = 0; i < N; i++) {
    const off = indices[i] * D
    for (let j = 0; j < D; j++) out[i * D + j] = W.data[off + j]
  }
  const res: Tensor = make(out, [N, D], [W], () => {
    if (!W.requiresGrad) return
    const gw = ensureGrad(W)
    const g = res.grad as Float32Array
    for (let i = 0; i < N; i++) {
      const off = indices[i] * D
      for (let j = 0; j < D; j++) gw[off + j] += g[i * D + j]
    }
  })
  return res
}

/**
 * Entropie croisée moyenne. logits [N, V], cibles [N]. Renvoie un scalaire [1].
 */
export function crossEntropy(logits: Tensor, targets: Int32Array): Tensor {
  const V = logits.shape[logits.shape.length - 1]
  const N = logits.size / V
  const probs = new Float32Array(logits.size)
  let loss = 0
  for (let i = 0; i < N; i++) {
    const off = i * V
    let max = -Infinity
    for (let j = 0; j < V; j++) if (logits.data[off + j] > max) max = logits.data[off + j]
    let sum = 0
    for (let j = 0; j < V; j++) {
      const e = Math.exp(logits.data[off + j] - max)
      probs[off + j] = e
      sum += e
    }
    for (let j = 0; j < V; j++) probs[off + j] /= sum
    loss += -Math.log(Math.max(probs[off + targets[i]], 1e-12))
  }
  loss /= N
  const res: Tensor = make(new Float32Array([loss]), [1], [logits], () => {
    const scalar = (res.grad as Float32Array)[0]
    if (!logits.requiresGrad) return
    const gl = ensureGrad(logits)
    for (let i = 0; i < N; i++) {
      const off = i * V
      for (let j = 0; j < V; j++) {
        const t = j === targets[i] ? 1 : 0
        gl[off + j] += ((probs[off + j] - t) / N) * scalar
      }
    }
  })
  return res
}
