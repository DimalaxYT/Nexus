// ─── NEXUS — Personnalisation par compte ─────────────────────────────────────
// Chaque compte a son propre ton, son prénom, ses consignes permanentes.
// Ce bloc est injecté dans le prompt système du cerveau local (jamais envoyé
// ailleurs : tout reste sur le serveur).

import type { UserProfile } from '@/lib/auth'

/**
 * PERSONNALISATION PAR COMPTE : ce que NEXUS doit savoir sur CET utilisateur.
 * Injecté dans le prompt système — chaque compte a donc son propre ton, son
 * prénom, ses consignes permanentes. 100 % local, rien ne quitte le serveur.
 */
export function personaBlock(profile?: UserProfile | null): string {
  if (!profile) return ''
  const lines: string[] = []
  const name = (profile.displayName ?? '').trim()
  const assistant = (profile.assistantName ?? '').trim()
  if (name) lines.push(`L'utilisateur s'appelle ${name} : appelle-le par son prénom quand c'est naturel.`)
  if (assistant && assistant.toLowerCase() !== 'nexus') {
    lines.push(`Il t'a demandé de t'appeler « ${assistant} » : présente-toi sous ce nom.`)
  }
  if (profile.company) lines.push(`Contexte professionnel : ${profile.company}.`)
  if (profile.bio) lines.push(`Son métier / son contexte : ${profile.bio}`)
  const tones: Record<string, string> = {
    neutre: 'Reste neutre et factuel.',
    chaleureux: 'Sois chaleureux, encourageant et proche, sans excès.',
    professionnel: 'Adopte un ton professionnel, sobre et précis.',
    direct: 'Va droit au but : phrases courtes, zéro détour.',
    pedagogue: 'Explique pas à pas, avec des exemples concrets.',
  }
  if (profile.tone && tones[profile.tone]) lines.push(`TON DEMANDÉ : ${tones[profile.tone]}`)
  if (profile.language && !/^fr/i.test(profile.language)) {
    lines.push(`Réponds dans la langue : ${profile.language}.`)
  }
  const instructions = (profile.instructions ?? '').trim()
  if (instructions) {
    lines.push(`CONSIGNES PERMANENTES DE CE COMPTE (prioritaires sur tout le reste, sans jamais enfreindre la sécurité) :
${instructions}`)
  }
  return lines.length > 0 ? `PERSONNALISATION DU COMPTE :
${lines.join('\n')}` : ''
}
