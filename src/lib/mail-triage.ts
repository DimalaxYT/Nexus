// ─── NEXUS — Vérification et tri des mails (100 % local, sans API) ───────────
// Classe les mails réellement lus en IMAP en catégories lisibles :
//   1. « À traiter » : une question, une demande, une échéance, un rappel ;
//   2. « Personnels & échanges » : messages de personnes (par défaut) ;
//   3. « Notifications » : comptes automatiques, alertes, réseaux, forges ;
//   4. « Promotions & newsletters » : offres, soldes, désinscription proposée.
// Lecture seule : NEXUS ne déplace, ne supprime et n'archive jamais un mail.

import type { EmailItem } from '@/lib/connections-tools'

export type MailCategory = 'todo' | 'people' | 'notifications' | 'promos'

export const MAIL_CATEGORY_LABEL: Record<MailCategory, string> = {
  todo: 'À traiter',
  people: 'Personnels & échanges',
  notifications: 'Notifications',
  promos: 'Promotions & newsletters',
}

const ORDER: MailCategory[] = ['todo', 'people', 'notifications', 'promos']

const noAccents = (t: string) => t.normalize('NFD').replace(/[\u0300-\u036f]/g, '')

const AUTOMATED = /(no-?reply|noreply|do-?not-?reply|notification|notifications|alert|alerts|security|securite|billing|facturation|mailer|bounce|support@|team@|info@|accounts?@|github|gitlab|linkedin|facebook|instagram|tiktok|twitter|x\.com|youtube|discord|slack|google|apple|microsoft|amazon|paypal|netflix|spotify)/
const PROMO = /(newsletter|promo|promotion|offre|offres|soldes|solde|%|-\s?\d{2}\s?%|reduction|réduction|deal|bons? plans?|webinar|unsubscribe|desinscri|désinscri|exclusif|nouveaute|nouveauté|jusqu'a|jusqu'à|gratuit|black friday|cashback|code promo)/
const TODO = /(\?|urgent|urgence|imperativement|impérativement|avant le|avant lundi|avant demain|échéance|echeance|deadline|relance|rappel|facture|paiement|payer|reglement|règlement|confirmez|confirmer|valider|validez|merci de (me )?(repondre|répondre|confirmer|retourner|m'envoyer|me transmettre)|pouvez[- ]vous|peux[- ]tu|pourrais[- ]tu|pourriez[- ]vous|rendez[- ]vous|rdv|action requise|action required|expire|expiration|verification requise|vérification requise)/i

function haystack(e: EmailItem): string {
  return noAccents(`${e.subject} ${e.snippet} ${e.fromAddress} ${e.from}`.toLowerCase())
}

/** Catégorie d'un mail (règles lisibles, ordre de priorité : à traiter > promos > notifications > personnes). */
export function categorizeEmail(e: EmailItem): MailCategory {
  const h = haystack(e)
  const hasTodo = TODO.test(noAccents(`${e.subject} ${e.snippet}`.toLowerCase())) || TODO.test(`${e.subject} ${e.snippet}`)
  const isPromo = PROMO.test(h)
  const isAuto = AUTOMATED.test(h)
  // Une question ou une échéance d'un expéditeur automatique reste « à traiter »
  // (facture, sécurité, validation…), mais une newsletter ne l'est jamais.
  if (hasTodo && !(isPromo && !isAuto)) return 'todo'
  if (isPromo && !hasTodo) return 'promos'
  if (isAuto) return 'notifications'
  return 'people'
}

export interface MailTriage {
  total: number
  unread: number
  groups: { category: MailCategory; label: string; items: EmailItem[] }[]
}

/** Trie les mails par catégorie ; dans chaque catégorie, non lus d'abord puis du plus récent au plus ancien. */
export function triageEmails(emails: EmailItem[]): MailTriage {
  const buckets = new Map<MailCategory, EmailItem[]>(ORDER.map((c) => [c, []]))
  for (const e of emails) buckets.get(categorizeEmail(e))?.push(e)
  const byDate = (a: EmailItem, b: EmailItem) => {
    if (a.seen !== b.seen) return a.seen ? 1 : -1
    return new Date(b.date).getTime() - new Date(a.date).getTime()
  }
  return {
    total: emails.length,
    unread: emails.filter((e) => !e.seen).length,
    groups: ORDER.map((category) => ({
      category,
      label: MAIL_CATEGORY_LABEL[category],
      items: (buckets.get(category) ?? []).sort(byDate),
    })).filter((g) => g.items.length > 0),
  }
}

/** Synthèse triée en markdown (réponse directe, sans recherche web). */
export function triageMarkdown(triage: MailTriage, frDate: Intl.DateTimeFormat, shown = 5): string {
  if (triage.total === 0) {
    return 'Ta boîte de réception est **vide** (aucun mail trouvé en IMAP). 📭'
  }
  const head = `J'ai lu et trié tes **${triage.total} derniers mails** en direct (IMAP) : **${triage.unread} non lu(s)**. Rien n'a été déplacé ni supprimé.`
  const sections = triage.groups.map((g) => {
    const lines = g.items.slice(0, shown).map((e) => {
      const badge = e.seen ? '' : ' 🔵'
      const extrait = e.snippet ? `\n   > ${e.snippet.slice(0, 120)}` : ''
      return `- **${e.subject}**${badge} — ${e.from} · ${frDate.format(new Date(e.date))}${extrait}`
    })
    const more = g.items.length > shown ? `\n  _… et ${g.items.length - shown} autre(s) dans cette catégorie_` : ''
    return `### ${g.label} (${g.items.length})\n${lines.join('\n')}${more}`
  })
  const todo = triage.groups.find((g) => g.category === 'todo')
  const advice = todo
    ? `\n\n**Priorité :** commence par « ${todo.items[0].subject} ». Dis-moi si tu veux que je résume l'un de ces mails ou que je surveille un expéditeur.`
    : '\n\nAucun mail urgent détecté. Dis-moi si tu veux un détail sur l\'un d\'eux.'
  return `${head}\n\n${sections.join('\n\n')}${advice}`
}

/** Bloc de faits pour le LLM (quand la demande passe par le moteur de conversation). */
export function triageFactsBlock(triage: MailTriage): string {
  return triage.groups
    .map((g) => `${g.label.toUpperCase()} (${g.items.length}) : ${g.items.slice(0, 8).map((e) => `« ${e.subject} » de ${e.from}`).join(' ; ')}`)
    .join('\n')
}
