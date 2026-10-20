// ─── NEXUS — Tokenizer BPE byte-level (port TypeScript fidèle de llm/nexus_llm/tokenizer.py) ─
// Un vrai LLM ne découpe pas le texte caractère par caractère : il utilise des
// sous-mots. Ce module réimplémente exactement le BPE entraîné du dépôt
// (`llm/data/tokenizer.json`, 1792 fusion → vocabulaire 2048 + EOS = 2049) :
//   1. pré-découpage en morceaux (lettres / chiffre UN PAR UN / espaces / ponctuation),
//   2. chaque morceau → octets UTF-8 (base 256),
//   3. fusion itérative de la paire de plus bas rang jusqu'à épuisement.
// Zéro dépendance, zéro token inconnu (tout texte est encodable), et
// aller-retour encode→decode vérifié contre l'implémentation Python
// (scripts/check-bpe.ts).
//
// Intérêt pour le chat : à contexte égal (256 positions), le modèle voit
// ~4× plus de texte qu'au niveau caractère, et chaque token porte du sens
// (« bonjour » = 1 token) au lieu d'une lettre.

import mergesJson from './tokenizer-merges.json'

/** Morceaux : lettres (unicode) | chiffre isolé | espaces | tout le reste.
 *  Identique au `_SPLIT_RE` Python (le « _ » n'y est capturé par aucune
 *  alternative : il est ignoré, comme en Python). */
const SPLIT_RE = /\p{L}+|\p{Nd}|\s+|[^\s\p{L}\p{Nd}_]/gu

export const BPE_EOS_TEXT = '<|endoftext|>'

export interface BpeTokenizer {
  /** Nombre de tokens sans EOS (ids 0..vocabSize-1). */
  vocabSize: number
  /** Identifiant du token de fin de document. */
  eosId: number
  /** Vocabulaire vu par le modèle (avec EOS). */
  modelVocabSize: number
  encode(text: string): number[]
  encodeDocument(text: string): number[]
  decode(ids: number[] | Int32Array): string
  /** Octets du token (pour le décodage incrémental en flux). */
  tokenBytes(id: number): Uint8Array
}

const MERGES: [number, number][] = (mergesJson.merges as number[][]).map((p) => [p[0], p[1]] as [number, number])
const RANKS = new Map<number, number>()
MERGES.forEach(([a, b], i) => RANKS.set(a * 65536 + b, i))

// token id → octets
const TOKEN_BYTES: Uint8Array[] = []
for (let i = 0; i < 256; i++) TOKEN_BYTES.push(Uint8Array.of(i))
for (const [a, b] of MERGES) {
  const ba = TOKEN_BYTES[a]
  const bb = TOKEN_BYTES[b]
  const merged = new Uint8Array(ba.length + bb.length)
  merged.set(ba, 0)
  merged.set(bb, ba.length)
  TOKEN_BYTES.push(merged)
}

const VOCAB_SIZE = 256 + MERGES.length
const EOS_ID = VOCAB_SIZE
const MODEL_VOCAB_SIZE = VOCAB_SIZE + 1

const utf8 = new TextEncoder()
const chunkCache = new Map<string, number[]>()

function encodeChunk(chunk: string): number[] {
  const hit = chunkCache.get(chunk)
  if (hit) return hit
  let ids: number[] = Array.from(utf8.encode(chunk))
  // Fusionne tant qu'une paire connue existe : on prend celle de rang le plus bas.
  while (ids.length >= 2) {
    let bestRank = -1
    let bestIdx = -1
    for (let i = 0; i < ids.length - 1; i++) {
      const r = RANKS.get(ids[i] * 65536 + ids[i + 1])
      if (r !== undefined && (bestRank < 0 || r < bestRank)) {
        bestRank = r
        bestIdx = i
      }
    }
    if (bestIdx < 0) break
    const newId = 256 + bestRank
    const merged: number[] = []
    let i = 0
    while (i < ids.length) {
      if (i < ids.length - 1 && RANKS.get(ids[i] * 65536 + ids[i + 1]) === bestRank) {
        merged.push(newId)
        i += 2
      } else {
        merged.push(ids[i])
        i += 1
      }
    }
    ids = merged
  }
  chunkCache.set(chunk, ids)
  return ids
}

function encode(text: string): number[] {
  const out: number[] = []
  const chunks = String(text ?? '').match(SPLIT_RE) ?? []
  for (const c of chunks) {
    const ids = encodeChunk(c)
    for (let i = 0; i < ids.length; i++) out.push(ids[i])
  }
  return out
}

/** Décodeur incrémental : indispensable au streaming (un token peut couper
 *  un caractère UTF-8 en deux ; on garde les octets partiels pour le suivant). */
export function createDecoder(): { push(ids: ArrayLike<number>): string; flush(): string } {
  const dec = new TextDecoder('utf-8', { fatal: false })
  return {
    push(ids) {
      const bytes: number[] = []
      for (let i = 0; i < ids.length; i++) {
        const id = ids[i]
        if (id >= VOCAB_SIZE) continue // EOS / hors vocabulaire : ignoré
        const b = TOKEN_BYTES[id]
        for (let j = 0; j < b.length; j++) bytes.push(b[j])
      }
      return bytes.length ? dec.decode(Uint8Array.from(bytes), { stream: true }) : ''
    },
    flush() {
      return dec.decode(Uint8Array.of(), { stream: false })
    },
  }
}

function decode(ids: number[] | Int32Array): string {
  const bytes: number[] = []
  for (let i = 0; i < ids.length; i++) {
    const id = ids[i]
    if (id >= VOCAB_SIZE) continue
    const b = TOKEN_BYTES[id]
    for (let j = 0; j < b.length; j++) bytes.push(b[j])
  }
  return new TextDecoder('utf-8', { fatal: false }).decode(Uint8Array.from(bytes))
}

/** Le tokenizer BPE entraîné du dépôt (singleton, immuable). */
export const BPE: BpeTokenizer = {
  vocabSize: VOCAB_SIZE,
  eosId: EOS_ID,
  modelVocabSize: MODEL_VOCAB_SIZE,
  encode,
  encodeDocument: (text: string) => encode(text).concat(EOS_ID),
  decode,
  tokenBytes: (id: number) => TOKEN_BYTES[id] ?? new Uint8Array(0),
}

/** Lexique BPE : les mots reconstitués les plus fréquents d'un corpus.
 *  Sert au garde-fou anti-charabia (comme `buildLexicon` au niveau caractère). */
export function bpeLexicon(text: string, minCount = 2, max = 6000): string[] {
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
