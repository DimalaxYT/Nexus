// ─── NEXUS Brain — Extraction d'entités (durées, langages, URL, quantités…) ───

import { normalize } from './text'

export interface Entities {
  url?: string
  language?: string // langage de code détecté
  duration?: string // « 2 semaines », « 45 minutes »…
  size?: '1024x1024' | '1344x768' | '768x1344'
  style?: string // style artistique détecté
  numbers?: number[]
}

const LANG_PATTERNS: [RegExp, string][] = [
  [/\b(luau|roblox|roblox studio)\b/i, 'lua'],
  [/\blua\b/i, 'lua'],
  [/\bpython(3)?\b/i, 'python'],
  [/\bjavascript\b|\bjs\b/i, 'javascript'],
  [/\btypescript\b|\bts\b/i, 'typescript'],
  [/\bc#(sharp)?\b|\bcsharp\b/i, 'csharp'],
  [/\bc\+\+\b|\bcpp\b/i, 'cpp'],
  [/\bjava\b(?!script)/i, 'java'],
  [/\brust\b/i, 'rust'],
  [/\bgo(lang)?\b/i, 'go'],
  [/\bbash\b|\bshell\b|\bzsh\b/i, 'bash'],
  [/\bsql\b/i, 'sql'],
  [/\bglsl\b|\bshader\b/i, 'glsl'],
  [/\bhtml\b/i, 'html'],
]

const STYLE_PATTERNS: [RegExp, string][] = [
  [/\b(kawaii|mignon|mignonne|cute)\b/i, 'kawaii'],
  [/\b(neon|néon|cyberpunk|futuriste)\b/i, 'neon'],
  [/\b(pixel|retro|8.?bit)\b/i, 'pixel'],
  [/\b(aquarelle|watercolor|aquarela)\b/i, 'aquarelle'],
  [/\b(reel|realiste|photographie|photo)\b/i, 'realiste'],
  [/\b(minimaliste|minimal|epure)\b/i, 'minimal'],
  [/\b(banquise|neige|hiver|arctique)\b/i, 'neige'],
  [/\b(espace|spatial|galaxie|cosmos|planetes)\b/i, 'espace'],
]

/** Extrait les entités exploitables du message. */
export function extractEntities(text: string): Entities {
  const e: Entities = {}

  // URL
  const urlMatch = text.match(/https?:\/\/[^\s"'<>]+/i)
  if (urlMatch) e.url = urlMatch[0]

  // Langage de code
  for (const [re, lang] of LANG_PATTERNS) {
    if (re.test(text)) {
      e.language = lang
      break
    }
  }

  // Durée
  const durMatch = text.match(
    /\b(\d+|une?|deux|trois|quatre|cinq|six|sept|huit|neuf|dix|demi)\s*(semaines?|jours?|heures?|h\b|minutes?|mins?|mois|ans?|annees?)\b/i
  )
  if (durMatch) e.duration = durMatch[0].trim()

  // Format d'image (paysage / portrait)
  if (/\b(paysage|horizontal|large|wide|banniere|panoramique)\b/i.test(text)) e.size = '1344x768'
  else if (/\b(portrait|vertical|story|mobile|telephone)\b/i.test(text)) e.size = '768x1344'
  else e.size = '1024x1024'

  // Style artistique
  for (const [re, style] of STYLE_PATTERNS) {
    if (re.test(normalize(text))) {
      e.style = style
      break
    }
  }

  // Nombres (contexte général)
  e.numbers = (text.match(/-?\d+(?:[.,]\d+)?/g) ?? [])
    .map((n) => parseFloat(n.replace(',', '.')))
    .slice(0, 8)

  return e
}
