// ─── NEXUS — Modèles de blueprints « assistants » ───────────────────────────
// Points de départ prêts à l'emploi, à personnaliser dans l'atelier Blueprints.

import type { BlueprintGraph, BlueprintNode, BlueprintEdge } from '@/lib/nexus-types'

export interface BlueprintTemplate {
  id: string
  name: string
  description: string
  graph: BlueprintGraph
}

const node = (id: string, type: BlueprintNode['type'], x: number, y: number, title: string, config: Record<string, unknown>): BlueprintNode => ({
  id,
  type,
  x,
  y,
  title,
  config,
})
const edge = (id: string, from: string, fromPort: string, to: string): BlueprintEdge => ({ id, from, fromPort, to })

export const BLUEPRINT_TEMPLATES: BlueprintTemplate[] = [
  {
    id: 'veille-site',
    name: 'Veille de site',
    description: 'Surveille une page. Dès qu’elle change, prévient par notification et par e-mail.',
    graph: {
      nodes: [
        node('t1', 'start', 80, 160, 'Départ', { greeting: '' }),
        node('t2', 'watch', 320, 160, 'Surveiller le site', { url: '', keyword: '', variable: 'veille' }),
        node('t3', 'condition', 560, 160, 'A-t-il changé ?', { left: 'variable', variable: 'veille_changed', operator: 'equals', value: 'oui' }),
        node('t4', 'notify', 800, 60, 'Prévenir', {
          title: 'Changement sur le site surveillé',
          body: 'Le site surveillé a changé. Extrait : {{veille}}',
          channel: 'both',
        }),
        node('t5', 'reply', 1040, 60, 'Confirmer', { text: 'Un changement a été détecté. Je t’ai prévenu.' }),
        node('t6', 'reply', 800, 260, 'Rien de neuf', { text: 'Rien de nouveau sur le site depuis la dernière vérification.' }),
        node('t7', 'reply', 320, 360, 'Site illisible', { text: 'Le site n’a pas pu être lu. Vérifie son adresse.' }),
      ],
      edges: [
        edge('te1', 't1', 'out', 't2'),
        edge('te2', 't2', 'out', 't3'),
        edge('te3', 't3', 'true', 't4'),
        edge('te4', 't4', 'out', 't5'),
        edge('te5', 't3', 'false', 't6'),
        edge('te6', 't2', 'error', 't7'),
      ],
    },
  },
  {
    id: 'assistant-quotidien',
    name: 'Assistant quotidien',
    description: 'Lit ta boîte mail, dégage ce qui est urgent et te remet un point clair avec des actions.',
    graph: {
      nodes: [
        node('a1', 'start', 80, 160, 'Départ', { greeting: '' }),
        node('a2', 'tool', 320, 160, 'Lire la boîte mail', { tool: 'check_email', argument: '', variable: 'mails' }),
        node('a3', 'brain', 560, 160, 'Analyser', {
          instruction:
            'Tu es l’assistant personnel de l’utilisateur. Voici ses derniers mails :\n{{mails}}\nFais un point clair : ce qui est urgent, ce qui attend une réponse, puis propose trois actions concrètes.',
          variable: 'reponse',
          useHistory: 'false',
        }),
        node('a4', 'notify', 800, 160, 'Remettre le point', { title: 'Point de la journée', body: '{{reponse}}', channel: 'inapp' }),
        node('a5', 'reply', 1040, 160, 'Répondre', { text: '{{reponse}}' }),
        node('a6', 'reply', 320, 360, 'Boîte inaccessible', { text: 'Je n’ai pas pu lire ta boîte mail. Vérifie la connexion dans le panneau Connexions.' }),
      ],
      edges: [
        edge('ae1', 'a1', 'out', 'a2'),
        edge('ae2', 'a2', 'out', 'a3'),
        edge('ae3', 'a3', 'out', 'a4'),
        edge('ae4', 'a4', 'out', 'a5'),
        edge('ae5', 'a2', 'error', 'a6'),
      ],
    },
  },
]

export function findTemplate(id: string): BlueprintTemplate | undefined {
  return BLUEPRINT_TEMPLATES.find((t) => t.id === id)
}
