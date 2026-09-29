// ─── NEXUS Brain — Fondations de traitement du texte (100 % local, zéro API) ──
// Tokenisation, normalisation, stemmeur léger FR/EN, similarités.
// Tout est codé from scratch : aucune dépendance externe.

/** Hache une chaîne en entier 32 bits (FNV-1a). */
export function hashString(str: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

/** Générateur pseudo-aléatoire déterministe (mulberry32) — reproductible. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Choisit un élément au hasard (RNG déterministe). */
export function pick<T>(rng: () => number, arr: readonly T[]): T {
  return arr[Math.floor(rng() * arr.length) % arr.length]
}

/** Normalise : minuscules, accents retirés, ponctuation retirée (garde : URL, @, nombres). */
export function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[''`]/g, "'")
    .replace(/[^\p{L}\p{N}\s'+@.:/_-]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Mots vides FR + EN (déterminants, pronoms, auxiliaires courants…). */
const STOPWORDS = new Set([
  'le', 'la', 'les', 'un', 'une', 'des', 'de', 'du', 'd', 'l', 'au', 'aux',
  'et', 'ou', 'mais', 'donc', 'or', 'ni', 'car', 'que', 'qui', 'quoi', 'dont',
  'ce', 'cet', 'cette', 'ces', 'son', 'sa', 'ses', 'leur', 'leurs', 'mon', 'ma',
  'mes', 'ton', 'ta', 'tes', 'notre', 'nos', 'votre', 'vos', 'il', 'elle', 'ils',
  'elles', 'je', 'tu', 'nous', 'vous', 'on', 'en', 'y', 'se', 'soi',
  'est', 'sont', 'etre', 'ai', 'as', 'avons', 'avez', 'ont', 'avoir',
  'the', 'an', 'of', 'to', 'in', 'on', 'at', 'for', 'and', 'or', 'but',
  'is', 'are', 'was', 'were', 'be', 'been', 'it', 'this', 'that', 'these',
  'those', 'i', 'you', 'he', 'she', 'we', 'they', 'my', 'your', 'his', 'her',
  'pour', 'avec', 'sans', 'dans', 'sur', 'sous', 'par', 'comme',
  'moi', 'toi', 'lui', 'eux', 'me', 'te', 'ne', 'pas', 'tres', 'bien',
  'stp', 'svp', 'sil', 'plait', 'please', 'juste', 'fais', 'fait', 'faire',
])

/** Coupe en mots bruts (normalisés ; élisions françaises découpées sur l'apostrophe). */
export function tokenize(text: string): string[] {
  return normalize(text)
    .split(/[\s/']+/)
    .map((w) => w.replace(/^[.'@_-]+|[.'@_-]+$/g, ''))
    .filter((w) => w.length > 0)
}

/** Termes significatifs (hors mots vides). */
export function contentTokens(text: string): string[] {
  return tokenize(text).filter((w) => w.length > 1 && !STOPWORDS.has(w))
}

/**
 * Stemmeur léger FR/EN : retire les terminaisons courantes sans dictionnaire.
 * Assez robuste pour un classifieur d'intentions (renforcé par bigrammes).
 */
export function stem(word: string): string {
  let w = word
  if (w.length <= 3) return w
  const suffixes = [
    'issements', 'issement', 'atrices', 'atrice', 'ateurs', 'ateur',
    'ations', 'ation', 'logies', 'logie', 'ements', 'ement', 'amment',
    'emment', 'istes', 'iste', 'ances', 'ance', 'ences', 'ence',
    'ables', 'able', 'ibles', 'ible', 'ismaux', 'ismes', 'isme',
    'euses', 'euse', 'trices', 'trice', 'eurs', 'eur', 'eres', 'ere',
    'ites', 'ite', 'aires', 'aire',
    'era', 'erai', 'eras', 'erez', 'ions', 'aient', 'erais', 'erait',
    'eront', 'ez', 'er', 'ee', 'ees', 'ies', 'ely', 'ed', 'es', 'ing', 'ly',
    's', 'x', 'e',
  ]
  for (const suf of suffixes) {
    if (w.endsWith(suf) && w.length - suf.length >= 3) {
      w = w.slice(0, -suf.length)
      break
    }
  }
  return w
}

/** Termes significatifs radicaux (pour similarités et vectorisation). */
export function stems(text: string): string[] {
  return contentTokens(text).map(stem)
}

/** Similarité de Jaccard sur les radicaux (0→1). */
export function jaccard(a: string, b: string): number {
  const sa = new Set(stems(a))
  const sb = new Set(stems(b))
  if (sa.size === 0 || sb.size === 0) return 0
  let inter = 0
  for (const x of sa) if (sb.has(x)) inter++
  return inter / (sa.size + sb.size - inter)
}

/** Détecte la langue dominante (heuristique : mots fonctionnels FR). */
export function isFrench(text: string): boolean {
  const t = ` ${normalize(text)} `
  const fr = (t.match(/\s(le|la|les|un|une|des|je|tu|est|pour|avec|dans|sur|qui|que|pas|mais|mon|ma|tes|vous|nous|et|tu|c'est)\s/g) ?? []).length
  const en = (t.match(/\s(the|and|is|are|you|your|for|with|this|that|what|how|can|make|create|write)\s/g) ?? []).length
  return fr >= en
}

/** Met la première lettre en majuscule. */
export function capitalize(s: string): string {
  return s.length === 0 ? s : s.charAt(0).toUpperCase() + s.slice(1)
}
