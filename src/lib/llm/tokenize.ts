// ─── NEXUS — Couche tokenizer du LLM maison ──────────────────────────────────
// Un seul point d'entrée pour encoder/décoder du texte, quel que soit le
// tokenizer du modèle :
//   · `char` — vocabulaire de caractères appris (modèles `grounded-v1` existants),
//   · `bpe`  — sous-mots byte-level entraînés du dépôt (`./bpe`, vocabulaire 2049),
//              utilisé par le format de conversation `chat-v1`.
// Le dispatch se fait sur `cfg.tokenizer`, donc les anciens modèles en base
// continuent de fonctionner tels quels (aucune migration nécessaire).

import { BPE, createDecoder } from './bpe'
import { decodeIds, encodeText, type LmConfig, type Vocab } from './model'

export function isBpe(cfg: LmConfig): boolean {
  return cfg.tokenizer === 'bpe'
}

/** Taille réelle du vocabulaire vu par le modèle. */
export function vocabSizeOf(cfg: LmConfig, vocab: Vocab): number {
  return isBpe(cfg) ? BPE.modelVocabSize : vocab.itos.length
}

/** Identifiant de fin de document, ou `null` si le tokenizer n'en a pas (char). */
export function eosIdOf(cfg: LmConfig): number | null {
  return isBpe(cfg) ? BPE.eosId : null
}

export function encodeFor(cfg: LmConfig, vocab: Vocab, text: string): Int32Array {
  if (isBpe(cfg)) {
    const ids = BPE.encode(text)
    return Int32Array.from(ids)
  }
  return encodeText(vocab, text)
}

export function decodeFor(cfg: LmConfig, vocab: Vocab, ids: number[] | Int32Array): string {
  if (isBpe(cfg)) return BPE.decode(ids)
  return decodeIds(vocab, Array.from(ids as ArrayLike<number>))
}

/**
 * Décodeur incrémental : renvoie du texte dès qu'un token complet forme des
 * caractères valides (indispensable pour diffuser la réponse pendant la
 * génération). En mode `char`, chaque token est un caractère.
 */
export function createStreamDecoder(cfg: LmConfig, vocab: Vocab): { push(ids: ArrayLike<number>): string; flush(): string } {
  if (isBpe(cfg)) return createDecoder()
  return {
    push: (ids) => decodeIds(vocab, Array.from(ids as ArrayLike<number>)),
    flush: () => '',
  }
}
