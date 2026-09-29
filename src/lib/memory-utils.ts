// ─── Utilitaires de déduplication mémoire (partagés entre les routes) ────────

const STOP_TOKENS = new Set([
  'les', 'des', 'une', 'que', 'qui', 'pour', 'avec', 'dans', 'sur', 'est', 'sont',
  'elle', 'elle', 'pour', 'mais', 'tout', 'tous', 'plus', 'cette', 'son', 'ses',
  'the', 'and', 'for', 'with', 'that', 'this', 'have', 'has', 'are', 'was',
])

/** Découpe un texte en ensemble de tokens significatifs (minuscules, sans accents retirés). */
export function tokenize(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .normalize('NFC')
      .split(/[^\p{L}\p{N}]+/u)
      .filter((w) => w.length > 2 && !STOP_TOKENS.has(w))
  )
}

/**
 * Détecte si `content` est un doublon (ou quasi-doublon) d'une mémoire existante
 * via la similarité de Jaccard sur les tokens (seuil 0.55).
 */
export function isDuplicateMemory(content: string, existing: { content: string }[]): boolean {
  const candidate = tokenize(content)
  if (candidate.size === 0) return true
  for (const mem of existing) {
    const other = tokenize(mem.content)
    if (other.size === 0) continue
    let inter = 0
    for (const w of candidate) if (other.has(w)) inter++
    const union = new Set([...candidate, ...other]).size
    if (union > 0 && inter / union >= 0.55) return true
  }
  return false
}
