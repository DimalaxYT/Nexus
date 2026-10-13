// ─── NEXUS — Moteur de règles « Quand tu lis X → réponds Y » ─────────────────
// Utilisé par les BLUEPRINTS (nœud « Règle ») et par les CLÉS API vendables :
// un client écrit ses propres déclencheurs et leurs réponses exactes, sans
// qu'aucun modèle externe n'intervienne. 100 % local et déterministe.

export type MatchMode = 'contains' | 'exact' | 'startsWith' | 'endsWith' | 'regex' | 'fuzzy'

export interface ReplyRule {
  id: string
  /** Le déclencheur : ce que le client écrit (ou ce qu'on doit repérer). */
  match: string
  mode: MatchMode
  /** La réponse EXACTE à renvoyer quand le déclencheur est lu. */
  reply: string
  /** Sensible à la casse (décoché = comparaison souple, recommandé). */
  caseSensitive?: boolean
  /** Note libre, jamais renvoyée au client. */
  note?: string
}

export const MATCH_MODES: { id: MatchMode; label: string; hint: string }[] = [
  { id: 'contains', label: 'Contient', hint: 'Le message contient ce texte' },
  { id: 'exact', label: 'Exactement', hint: 'Le message est exactement ce texte' },
  { id: 'startsWith', label: 'Commence par', hint: 'Le message commence par ce texte' },
  { id: 'endsWith', label: 'Finit par', hint: 'Le message finit par ce texte' },
  { id: 'fuzzy', label: 'Approchant', hint: 'Mots proches (orthographe, ordre, synonymes simples)' },
  { id: 'regex', label: 'Expression', hint: 'Expression régulière (pour utilisateurs avancés)' },
]

/** Normalise un texte : minuscules, sans accents, ponctuation allégée, espaces simplifiés. */
export function normText(input: string, caseSensitive = false): string {
  let s = String(input ?? '')
  if (!caseSensitive) s = s.toLowerCase()
  s = s.normalize('NFD').replace(/\p{M}/gu, '')
  s = s.replace(/[’‘`]/g, "'").replace(/[“”]/g, '"')
  s = s.replace(/[^\p{L}\p{N}\s'"]/gu, ' ')
  return s.replace(/\s+/g, ' ').trim()
}

/** Découpe en mots porteurs de sens (≥ 2 caractères, sans mots-outils). */
function words(input: string): string[] {
  const STOP = new Set([
    'le', 'la', 'les', 'un', 'une', 'des', 'du', 'de', 'et', 'est', 'sont', 'que', 'qui',
    'quoi', 'pour', 'pas', 'ne', 'dans', 'sur', 'avec', 'mon', 'ma', 'mes', 'ton', 'ta', 'tes',
    'son', 'sa', 'ses', 'ce', 'cet', 'cette', 'il', 'elle', 'je', 'tu', 'nous', 'vous', 'au', 'aux',
    'en', 'se', 'si', 'ou', 'oui', 'non', 'the', 'a', 'an', 'is', 'are', 'to', 'of', 'my', 'your',
  ])
  return normText(input)
    .split(' ')
    .map((w) => w.replace(/^['"]|['"]$/g, ''))
    .filter((w) => w.length >= 2 && !STOP.has(w))
}

/** Similarité lexicale (Jaccard sur les mots utiles) — pour le mode « approchant ». */
export function fuzzyScore(a: string, b: string): number {
  const wa = new Set(words(a))
  const wb = new Set(words(b))
  if (wa.size === 0 || wb.size === 0) return 0
  let inter = 0
  for (const w of wa) if (wb.has(w)) inter++
  const union = new Set([...wa, ...wb]).size
  return union === 0 ? 0 : inter / union
}

/** Seuil du mode « approchant » : au-delà, on considère que c'est la même demande. */
export const FUZZY_THRESHOLD = 0.6

/** Un déclencheur est-il reconnu dans ce message ? */
export function ruleMatches(rule: ReplyRule, message: string): boolean {
  const raw = String(message ?? '')
  const trigger = String(rule.match ?? '')
  if (!trigger.trim()) return false
  const cs = Boolean(rule.caseSensitive)

  switch (rule.mode) {
    case 'exact':
      return normText(raw, cs) === normText(trigger, cs)
    case 'startsWith':
      return normText(raw, cs).startsWith(normText(trigger, cs))
    case 'endsWith':
      return normText(raw, cs).endsWith(normText(trigger, cs))
    case 'regex': {
      try {
        return new RegExp(trigger, cs ? '' : 'i').test(raw)
      } catch {
        return false // expression invalide → la règle est simplement ignorée
      }
    }
    case 'fuzzy':
      return fuzzyScore(trigger, raw) >= FUZZY_THRESHOLD
    case 'contains':
    default: {
      const a = normText(trigger, cs)
      const b = normText(raw, cs)
      // Repli souple : si la version stricte échoue, on tolère les petites
      // variations d'espaces/ponctuation déjà gérées, puis une similarité haute.
      if (b.includes(a)) return true
      return a.length >= 12 && fuzzyScore(trigger, raw) >= 0.85
    }
  }
}

/**
 * Renvoie la PREMIÈRE règle qui correspond (l'ordre du tableau = priorité).
 * C'est le cœur du comportement « Quand tu lis X → réponds Y ».
 */
export function findMatchingRule(rules: ReplyRule[] | undefined, message: string): ReplyRule | null {
  if (!Array.isArray(rules)) return null
  for (const rule of rules) {
    if (!rule || typeof rule.reply !== 'string') continue
    if (ruleMatches(rule, message)) return rule
  }
  return null
}

/** Nettoie et valide un tableau de règles venu du client (taille, nombre, modes). */
export function sanitizeRules(raw: unknown, max = 200): ReplyRule[] {
  if (!Array.isArray(raw)) return []
  const modes = new Set(MATCH_MODES.map((m) => m.id))
  const out: ReplyRule[] = []
  for (const item of raw.slice(0, max)) {
    if (!item || typeof item !== 'object') continue
    const r = item as Partial<ReplyRule>
    const match = String(r.match ?? '').slice(0, 600)
    const reply = String(r.reply ?? '').slice(0, 8000)
    if (!match.trim() || !reply.trim()) continue
    const mode = modes.has(r.mode as MatchMode) ? (r.mode as MatchMode) : 'contains'
    out.push({
      id: String(r.id ?? `r${out.length + 1}-${Math.random().toString(36).slice(2, 8)}`),
      match,
      mode,
      reply,
      caseSensitive: Boolean(r.caseSensitive),
      note: String(r.note ?? '').slice(0, 300),
    })
  }
  return out
}
