// ─── NEXUS — Fabrique d'entrées de connaissance ──────────────────────────────
// Module neutre (sans dépendance vers devbrain ni devtrainer) : il fabrique le
// correctif qui ajoute un savoir à la banque intégrée, servi hors-ligne à tous
// les comptes.

import fs from 'fs'
import { safePath } from './devfs'

/** Échappe une chaîne pour un littéral de gabarit TypeScript. */
export function tsTemplateLiteral(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$\{/g, '\\${')
}

/** Échappe une chaîne pour un littéral entre simples quotes TypeScript. */
export function tsSingleQuote(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, ' ')
}

export const KNOWLEDGE_BANK_PATH = 'src/lib/brain/knowledge-bank.ts'

export interface KnowledgePatchDraft {
  title: string
  filePath: string
  before: string
  after: string
  rationale: string
}

/**
 * Fabrique le correctif qui ajoute une entrée à la banque de connaissances
 * intégrée. Le remplacement est ciblé : `before` est un extrait réel du fichier
 * (assez long pour être unique), `after` est ce même extrait, complété.
 */
export function buildKnowledgePatch(input: {
  keywords: string[]
  question: string
  answer: string
}): KnowledgePatchDraft | null {
  let raw = ''
  try {
    raw = fs.readFileSync(safePath(KNOWLEDGE_BANK_PATH), 'utf8')
  } catch {
    return null
  }
  const marker = 'export const NEXUS_KNOWLEDGE: KnowledgeEntry[] = ['
  const start = raw.indexOf(marker)
  if (start < 0) return null
  const close = raw.indexOf('\n]\n', start)
  if (close < 0) return null

  const anchorStart = Math.max(start + marker.length, close - 400)
  const before = raw.slice(anchorStart, close) + '\n]'
  const entry = [
    '  {',
    `    keywords: [${input.keywords.map((k) => `'${tsSingleQuote(k)}'`).join(', ')}],`,
    `    question: '${tsSingleQuote(input.question)}',`,
    '    answer: `' + tsTemplateLiteral(input.answer) + '`,',
    '  },',
  ].join('\n')
  const after = raw.slice(anchorStart, close) + '\n' + entry + '\n]'

  if (raw.split(before).length !== 2) return null // ancre non unique : on s'abstient
  return {
    title: `Banque de connaissances : « ${input.question} »`,
    filePath: KNOWLEDGE_BANK_PATH,
    before,
    after,
    rationale:
      'Ajoute un savoir vérifiable à la banque intégrée. Il sera servi hors-ligne à tous les comptes, sans passer par une API externe.',
  }
}
