// ─── NEXUS Brain — Extraction de mémoire par règles (100 % local) ────────────
// Remplace l'extraction LLM : motifs linguistiques français pour détecter les
// informations durables (identité, préférences, projets). Rapide et gratuit.

export interface ExtractedMemory {
  content: string
  kind: 'fact' | 'preference' | 'project' | 'person' | 'other'
}

interface Rule {
  re: RegExp
  kind: ExtractedMemory['kind']
  build: (m: RegExpMatchArray) => string
}

const RULES: Rule[] = [
  {
    re: /je m(?:'| )?appelle\s+([\p{L}'-]{2,30})/iu,
    kind: 'person',
    build: (m) => `L'utilisateur s'appelle ${m[1].trim()}`,
  },
  {
    re: /(?:mon nom|mon pr[ée]nom)\s+(?:c(?:est|')|est)\s+([\p{L}'-]{2,30})/iu,
    kind: 'person',
    build: (m) => `L'utilisateur s'appelle ${m[1].trim()}`,
  },
  {
    re: /(?:moi c(?:est|')|ici c(?:est|'))\s+([\p{L}'-]{2,30})\b/iu,
    kind: 'person',
    build: (m) => `L'utilisateur se présente comme ${m[1].trim()}`,
  },
  {
    re: /j(?:'| )?ai\s+(\d{1,2})\s*ans/iu,
    kind: 'fact',
    build: (m) => `L'utilisateur a ${m[1]} ans`,
  },
  {
    re: /j(?:'| )?habite\s+(?:[àa]|dans|au|en)\s+([\p{L}\s'-]{2,40}?)(?:[.,!]|$)/iu,
    kind: 'fact',
    build: (m) => `L'utilisateur habite à ${m[1].trim()}`,
  },
  {
    re: /je vis\s+(?:[àa]|dans|au|en)\s+([\p{L}\s'-]{2,40}?)(?:[.,!]|$)/iu,
    kind: 'fact',
    build: (m) => `L'utilisateur vit à ${m[1].trim()}`,
  },
  {
    re: /j(?:'| )?aime\s+(?:bien\s+|beaucoup\s+|trop\s+)?([\p{L}\s'-]{2,50}?)(?:[.,!]|$)/iu,
    kind: 'preference',
    build: (m) => `L'utilisateur aime ${m[1].trim()}`,
  },
  {
    re: /je pr[ée]f[èe]re\s+([\p{L}\s'-]{2,50}?)(?:[.,!]|$)/iu,
    kind: 'preference',
    build: (m) => `L'utilisateur préfère ${m[1].trim()}`,
  },
  {
    re: /(?:ma|mon)\s+(couleur|couleur pr[ée]f[ée]r[ée]e|style|genre)\s+(?:pr[ée]f[ée]r[ée]e?\s+)?(?:c(?:est|')|est)\s+([\p{L}\s'-]{2,30}?)(?:[.,!]|$)/iu,
    kind: 'preference',
    build: (m) => `La ${m[1].trim()} préférée de l'utilisateur : ${m[2].trim()}`,
  },
  {
    re: /(?:mon\s+)?jeu\s+(?:s(?:'| )?appelle|se nomme)\s+([\p{L}\d\s'-]{2,40}?)(?:[.,!]|$)/iu,
    kind: 'project',
    build: (m) => `Son jeu s'appelle ${m[1].trim()}`,
  },
  {
    re: /je (?:travaille|bosse)\s+(?:sur|dans)\s+([\p{L}\d\s'-]{2,60}?)(?:[.,!]|$)/iu,
    kind: 'project',
    build: (m) => `L'utilisateur travaille sur ${m[1].trim()}`,
  },
  {
    re: /je d[ée]veloppe\s+([\p{L}\d\s'-]{2,60}?)(?:[.,!]|$)/iu,
    kind: 'project',
    build: (m) => `L'utilisateur développe ${m[1].trim()}`,
  },
  {
    re: /mon projet\s+(?:c(?:est|')|est|:)\s+([\p{L}\d\s'-]{2,60}?)(?:[.,!]|$)/iu,
    kind: 'project',
    build: (m) => `Son projet : ${m[1].trim()}`,
  },
  {
    re: /mon objectif\s+(?:c(?:est|')|est|:)\s+([\p{L}\d\s'-]{2,60}?)(?:[.,!]|$)/iu,
    kind: 'other',
    build: (m) => `Son objectif : ${m[1].trim()}`,
  },
  {
    re: /mon (?:pseudo|email|mail)\s+(?:c(?:est|')|est|:)\s+([\w.@'-]{3,40})/iu,
    kind: 'fact',
    build: (m) => `Son ${/pseudo/.test(m[0]) ? 'pseudo' : 'email'} : ${m[1].trim()}`,
  },
]

/**
 * Détecte les informations durables dans un message utilisateur.
 * Retourne 0 à 3 souvenirs formulés à la 3ᵉ personne.
 */
export function extractMemories(userText: string): ExtractedMemory[] {
  const found: ExtractedMemory[] = []
  const seen = new Set<string>()
  for (const rule of RULES) {
    const m = userText.match(rule.re)
    if (m) {
      const content = rule.build(m).slice(0, 300)
      const key = content.toLowerCase().slice(0, 60)
      if (!seen.has(key)) {
        seen.add(key)
        found.push({ content, kind: rule.kind })
      }
    }
    if (found.length >= 3) break
  }
  return found
}

/** Titre de conversation automatique (premiers mots significatifs). */
export function autoTitle(userText: string): string {
  const cleaned = userText
    .replace(/^(salut|bonjour|hello|coucou|hey|yo|merci|stp|svp)[\s,!?]*/i, '')
    .replace(/\s+/g, ' ')
    .trim()
  if (!cleaned) return 'Nouvelle conversation'
  const words = cleaned.split(/\s+/).slice(0, 6).join(' ')
  const title = words.length > 48 ? `${words.slice(0, 45)}…` : words
  return title.charAt(0).toUpperCase() + title.slice(1)
}

/** Retient aussi les informations explicites « retiens que … ». */
export function extractExplicitRetention(userText: string): ExtractedMemory | null {
  const m = userText.match(
    /(?:retiens|retenez|note(?:r)?\s+(?:que|ca|ça|cette info)|souviens.?toi\s+que|garde\s+en\s+m[ée]moire\s+(?:que)?)\s*:?\s*(.{10,280})/i
  )
  if (!m) return null
  const raw = m[1].replace(/^que\s+/i, '').replace(/[.!?]+$/, '').trim()
  if (raw.length < 10) return null
  const content = `Retenu par l'utilisateur : ${raw}`
  return { content, kind: 'other' }
}
