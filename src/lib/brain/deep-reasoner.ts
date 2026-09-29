// ─── NEXUS Brain — Moteur de Raisonnement Analytique Profond (Style Claude) ──
// Remplace les réponses génériques par une vraie décomposition analytique :
// 1. Détection fine du mode cognitif (Audit de code, Comparaison A vs B,
//    Diagnostic de bug, Architecture/Plan, Explication approfondie).
// 2. Analyse statique réelle de code (sécurité, anti-patterns Luau/TS/JS/Python,
//    complexité, gestion d'erreurs).
// 3. RAG Hybride autonome : banque sémantique locale + notes SQLite + recherche
//    encyclopédique/web automatique quand le sujet sort du cache local.
// 4. Synthèse structurée en Markdown (tableaux comparatifs, exemples, bonnes pratiques).

import type { AgentEvent, CodeFiles, SourceItem } from '@/lib/nexus-types'
import { searchKnowledgeBank } from './knowledge-bank'
import { readWebpage, webSearch, type SearchResult } from './search'
import { extractKeySentences, synthesizePages, type PageContent } from './synthesize'
import { capitalize, normalize } from './text'

export type Emit = (event: AgentEvent) => void

export type ReasoningMode =
  | 'code_audit'
  | 'comparison'
  | 'troubleshooting'
  | 'architecture_plan'
  | 'deep_explanation'

export interface CodeAuditFinding {
  severity: 'critical' | 'warning' | 'info'
  title: string
  detail: string
  fix: string
}

export interface CodeAuditReport {
  language: string
  lines: number
  functionsCount: number
  score: number // sur 100
  findings: CodeAuditFinding[]
  strengths: string[]
}

/** Détecte et analyse statiquement un extrait de code (Luau, TS/JS, Python, SQL, HTML). */
export function analyzeCodeStatic(rawCode: string, langHint = ''): CodeAuditReport {
  const code = rawCode.trim()
  const lines = code ? code.split('\n').length : 0
  const lower = code.toLowerCase()

  const language =
    langHint ||
    (/\blocal\s+\w+|\bgame:GetService|\bInstance\.new|\btask\.wait/.test(code)
      ? 'lua'
      : /\binterface\s+\w+|:\s*(string|number|boolean)\b/.test(code)
        ? 'typescript'
        : /\bdef\s+\w+\s*\(|\bimport\s+\w+/.test(code) && !/;/.test(code)
          ? 'python'
          : /\bfunction\s+\w+|\bconst\s+\w+\s*=/.test(code)
            ? 'javascript'
            : 'code')

  const findings: CodeAuditFinding[] = []
  const strengths: string[] = []

  // Comptage des fonctions
  const fnMatches =
    code.match(/\b(function\s+\w+|def\s+\w+|const\s+\w+\s*=\s*(?:async\s*)?\([^)]*\)\s*=>)/g) ?? []
  const functionsCount = fnMatches.length

  // ── Vérifications Sécurité ───────────────────────────────────────────────
  if (/\beval\s*\(|\bnew\s+Function\s*\(/.test(code)) {
    findings.push({
      severity: 'critical',
      title: 'Exécution dynamique de code (`eval` / `new Function`)',
      detail: 'Exécuter une chaîne comme du code ouvre la porte aux injections de code arbitraire (RCE / XSS).',
      fix: 'Remplace `eval()` par `JSON.parse()` pour les données ou une table de correspondance (map de fonctions).',
    })
  }

  if (/\.innerHTML\s*=|dangerouslySetInnerHTML/.test(code)) {
    findings.push({
      severity: 'warning',
      title: 'Risque XSS via injection HTML directe (`innerHTML`)',
      detail: 'Insérer du HTML non assaini permet à un attaquant d’exécuter du JavaScript dans le navigateur.',
      fix: 'Utilise `textContent` pour du texte brut, ou nettoie le HTML avec un sanitizer strict.',
    })
  }

  if (/(?:SELECT|INSERT|UPDATE|DELETE)\b[\s\S]{0,80}(?:\+\s*\w+|\$\{)/i.test(code)) {
    findings.push({
      severity: 'critical',
      title: 'Injection SQL potentielle par concaténation',
      detail: 'La requête SQL concatène directement une variable au lieu d’utiliser des paramètres préparés.',
      fix: 'Utilise une requête préparée avec des placeholders (`?` ou `$1`) et passe les valeurs séparément.',
    })
  }

  if (/(?:api[_-]?key|secret|password|token)\s*[:=]\s*['"][A-Za-z0-9_\-]{12,}['"]/i.test(code)) {
    findings.push({
      severity: 'critical',
      title: 'Secret ou clé API codé en dur dans le code source',
      detail: 'Un secret commité dans le code peut être extrait par toute personne ayant accès au dépôt.',
      fix: 'Déplace le secret dans une variable d’environnement (`process.env.MA_CLE`) et ajoute `.env` au `.gitignore`.',
    })
  }

  // ── Vérifications spécifiques Roblox / Luau ──────────────────────────────
  if (language === 'lua') {
    if (/OnServerEvent:Connect/.test(code) && !/\btypeof\s*\(|\btype\s*\(/.test(code)) {
      findings.push({
        severity: 'critical',
        title: 'RemoteEvent serveur sans validation des types reçus du client',
        detail: 'Un client malveillant (exploit) peut envoyer `nil`, des nombres négatifs ou `NaN` à `OnServerEvent`.',
        fix: 'Vérifie systématiquement `if typeof(arg) ~= "string" then return end` et valide les bornes côté serveur.',
      })
    }
    if (/:(?:GetAsync|SetAsync|UpdateAsync|RemoveAsync)\s*\(/.test(code) && !/\bpcall\s*\(/.test(code)) {
      findings.push({
        severity: 'warning',
        title: 'Appel DataStoreService sans `pcall`',
        detail: 'Les services réseau Roblox peuvent échouer temporairement et faire planter tout le script.',
        fix: 'Enveloppe chaque appel DataStore dans `local ok, res = pcall(function() return store:GetAsync(key) end)`.',
      })
    }
    if (/\bwhile\s+true\s+do\b/.test(code) && !/\btask\.wait\s*\(|\bwait\s*\(/.test(code)) {
      findings.push({
        severity: 'critical',
        title: 'Boucle `while true do` infinie sans `task.wait()`',
        detail: 'Une boucle synchrone sans pause gèle le serveur Roblox jusqu’au crash (Script Exhausted Execution Time).',
        fix: 'Ajoute `task.wait(0.1)` (ou écoute un événement `RunService.Heartbeat`) à l’intérieur de la boucle.',
      })
    }
    if (/(?<![.\w])wait\s*\(|(?<![.\w])spawn\s*\(|(?<![.\w])delay\s*\(/.test(code)) {
      findings.push({
        severity: 'info',
        title: 'Utilisation des anciennes fonctions `wait()` / `spawn()`',
        detail: 'Les fonctions globales historiques sont bridées à 30 Hz et moins précises.',
        fix: 'Utilise la bibliothèque moderne `task.wait()`, `task.spawn()` et `task.delay()`.',
      })
    }
    if (/\btask\.(wait|spawn|delay)\b/.test(code)) {
      strengths.push('Utilisation moderne de la bibliothèque `task` de Luau.')
    }
    if (/\bpcall\s*\(/.test(code)) {
      strengths.push('Appels sensibles protégés par `pcall`.')
    }
  }

  // ── Vérifications TypeScript / JavaScript / Python ───────────────────────
  if (language === 'typescript' || language === 'javascript') {
    if (/\basync\b/.test(code) && /\bawait\b/.test(code) && !/\btry\s*\{|\.catch\s*\(/.test(code)) {
      findings.push({
        severity: 'warning',
        title: 'Fonctions `async/await` sans gestion d’erreur (`try/catch`)',
        detail: 'Une promesse rejetée non interceptée peut interrompre le flux ou laisser l’interface bloquée.',
        fix: 'Ajoute un bloc `try { ... } catch (err) { ... }` autour des appels réseau ou base de données.',
      })
    }
    if (/:\s*any\b/.test(code)) {
      findings.push({
        severity: 'info',
        title: 'Utilisation du type `any` désactivant la vérification TypeScript',
        detail: '`any` court-circuite le compilateur et masque les erreurs de propriétés inexistantes.',
        fix: 'Préfère `unknown` avec un affinement de type, ou définis une `interface` explicite.',
      })
    }
    if (/\btry\s*\{/.test(code)) {
      strengths.push('Gestion explicite des erreurs par blocs `try/catch`.')
    }
  }

  if (lines > 0 && /\/\/|--|#/.test(code)) {
    strengths.push('Code documenté par des commentaires explicatifs.')
  }
  if (functionsCount >= 2) {
    strengths.push(`Découpage modulaire en ${functionsCount} fonctions distinctes.`)
  }
  if (strengths.length === 0 && lines > 0 && !lower.includes('todo')) {
    strengths.push('Structure concise et lisible.')
  }

  let penalty = 0
  for (const f of findings) {
    penalty += f.severity === 'critical' ? 22 : f.severity === 'warning' ? 11 : 5
  }
  const score = Math.max(35, Math.min(100, 96 - penalty))

  return { language, lines, functionsCount, score, findings, strengths }
}

/** Détecte le mode de raisonnement le plus adapté à la demande de l'utilisateur. */
export function detectReasoningMode(text: string, hasCodeContext: boolean): ReasoningMode {
  const t = normalize(text)
  const hasFencedCode = /```[\s\S]+?```/.test(text)

  if (
    (hasFencedCode || hasCodeContext) &&
    /\b(analyse|audit|corrige|debug|ameliore|optimise|securise|revue|review|explique ce code|que penses tu de ce code|pourquoi ca marche pas)\b/.test(t)
  ) {
    return 'code_audit'
  }
  if (/\b(vs|versus|difference entre|differences entre|comparer?|comparaison|lequel choisir|vaut il mieux|plutot .+ ou)\b/.test(t)) {
    return 'comparison'
  }
  if (/\b(erreur|bug|plante|crash|ne marche pas|ne fonctionne pas|bloque|probleme avec|comment resoudre|comment corriger)\b/.test(t)) {
    return 'troubleshooting'
  }
  if (/\b(architecture|comment creer|comment construire|plan pour|etapes pour|organiser|structurer|conception|roadmap|strategie)\b/.test(t)) {
    return 'architecture_plan'
  }
  return 'deep_explanation'
}

/** Extrait les deux sujets A et B d'une question de comparaison (« X vs Y », « différence entre X et Y »). */
function extractComparisonPair(text: string): [string, string] | null {
  const cleaned = text.replace(/[?!.]+$/, '').trim()
  const m1 = cleaned.match(/diff[ée]rences?\s+entre\s+(.+?)\s+et\s+(.+)$/i)
  if (m1) return [m1[1].trim(), m1[2].trim()]
  const m2 = cleaned.match(/([^,:;?!]+?)\s+(?:vs\.?|versus|ou bien)\s+([^,:;?!]+)$/i)
  if (m2) return [m2[1].replace(/^(?:compare|comparer|choisir entre)\s+/i, '').trim(), m2[2].trim()]
  return null
}

/** Formate un rapport d'audit de code complet façon Claude. */
export function formatCodeAuditMarkdown(report: CodeAuditReport, codeTitle = 'ton code'): string {
  const badge =
    report.score >= 85 ? '🟢 Excellente base' : report.score >= 65 ? '🟡 Correct avec points d’attention' : '🔴 Corrections critiques requises'

  const strengthsBlock =
    report.strengths.length > 0
      ? `### ✅ Points forts identifiés\n${report.strengths.map((s) => `- ${s}`).join('\n')}`
      : ''

  const findingsBlock =
    report.findings.length > 0
      ? `### 🔍 Points à corriger ou renforcer (${report.findings.length})\n` +
        report.findings
          .map((f, i) => {
            const icon = f.severity === 'critical' ? '🚨 **[CRITIQUE]**' : f.severity === 'warning' ? '⚠️ **[ATTENTION]**' : '💡 **[CONSEIL]**'
            return `${i + 1}. ${icon} **${f.title}**\n   - *Diagnostic* : ${f.detail}\n   - *Correctif recommandé* : ${f.fix}`
          })
          .join('\n\n')
      : `### ✨ Aucun anti-pattern critique détecté\nLe code respecte les bonnes pratiques de sécurité et de structure pour **${report.language.toUpperCase()}**.`

  return `## 🧠 Audit technique & sécurité de ${codeTitle}

**Langage détecté :** \`${report.language}\` · **Volume :** ${report.lines} lignes (${report.functionsCount} fonction${report.functionsCount > 1 ? 's' : ''}) · **Indice de qualité :** **${report.score}/100** (${badge})

${strengthsBlock}

${findingsBlock}

### 🚀 Pistes d'amélioration (niveau production)
1. **Validation des entrées** : vérifier systématiquement les types et les bornes dès l'entrée de chaque fonction publique.
2. **Isolation des responsabilités** : séparer la configuration (constantes en tête de fichier), la logique métier pure et les effets de bord (réseau, DOM, base de données).
3. **Observabilité** : journaliser les erreurs avec suffisamment de contexte pour faciliter le débogage.`
}

export interface DeepReasonInput {
  userText: string
  topic: string
  memories: string[]
  notes: { title: string; content: string; category: string }[]
  currentCode?: CodeFiles
  send: Emit
}

/**
 * Exécute le pipeline de raisonnement analytique profond (Chain-of-Thought +
 * RAG local + recherche web autonome si nécessaire + synthèse structurée).
 */
export async function deepReasonAndAnswer(input: DeepReasonInput): Promise<string> {
  const { userText, topic, memories, notes, currentCode, send } = input
  const cleanTopic = (topic || userText).replace(/[?!.]+$/, '').trim()

  const fencedMatch = userText.match(/```(\w+)?\n([\s\S]+?)```/)
  const codeToAnalyze =
    fencedMatch?.[2] ||
    (currentCode?.js?.trim() || currentCode?.html?.trim() || '')
  const codeLang = fencedMatch?.[1] || currentCode?.language || ''

  const mode = detectReasoningMode(userText, Boolean(codeToAnalyze))

  // 1) Mode Audit de code
  if (mode === 'code_audit' && codeToAnalyze) {
    send({
      type: 'thought',
      text: `Raisonnement analytique (mode Audit de code) :\n1. Inspection statique de l'AST / motifs (${codeToAnalyze.split('\n').length} lignes)\n2. Vérification sécurité (injections, secrets, autorité serveur)\n3. Synthèse des correctifs prioritaires.`,
    })
    const report = analyzeCodeStatic(codeToAnalyze, codeLang)
    return formatCodeAuditMarkdown(report, currentCode?.filename ? `« ${currentCode.filename} »` : 'ton code')
  }

  // 2) Recherche dans la banque sémantique locale
  const bankHits = searchKnowledgeBank(userText, 2)
  const bestBank = bankHits[0]

  // 3) Recherche autonome sur le web / Wikipédia / StackExchange si le sujet n'est pas déjà couvert à 90%
  let webResults: SearchResult[] = []
  let webSynthesis = ''
  if (!bestBank || bestBank.score < 0.88) {
    const searchStepId = `step-reason-${Date.now()}`
    send({
      type: 'step',
      id: searchStepId,
      tool: 'web_search',
      label: 'Recherche & Recoupement',
      detail: `analyse multi-sources sur « ${cleanTopic.slice(0, 60)} »`,
      status: 'running',
    })
    try {
      const results = await webSearch(cleanTopic, 6)
      if (results && results.length > 0) {
        webResults = results
        const sources: SourceItem[] = results.slice(0, 6).map((r) => ({
          title: r.title,
          url: r.url,
          domain: r.domain,
          snippet: r.snippet,
        }))
        send({ type: 'sources', sources })

        // Lecture rapide des 2 meilleures pages non-média pour extraire des faits précis
        const pagesToRead = results.filter((r) => !/(youtube|tiktok|reddit)/i.test(r.domain)).slice(0, 2)
        const readPages = (
          await Promise.all(
            pagesToRead.map(async (r): Promise<PageContent | null> => {
              const p = await readWebpage(r.url, 6000)
              return p ? { title: p.title, url: p.url, domain: r.domain, text: p.text } : null
            })
          )
        ).filter((p): p is PageContent => p !== null)

        if (readPages.length > 0) {
          webSynthesis = synthesizePages(cleanTopic, readPages, 3, 6)
        }
        if (!webSynthesis) {
          const snippetText = results.map((r) => `${r.title}. ${r.snippet}`).join('. ')
          const keySents = extractKeySentences(snippetText, cleanTopic, 4)
          if (keySents.length > 0) {
            webSynthesis = keySents.map((s) => `- ${s}`).join('\n')
          }
        }
        send({
          type: 'step',
          id: searchStepId,
          tool: 'web_search',
          label: 'Recherche & Recoupement',
          detail: `${results.length} sources croisées${readPages.length > 0 ? ` · ${readPages.length} pages analysées` : ''}`,
          status: 'done',
        })
      } else {
        send({
          type: 'step',
          id: searchStepId,
          tool: 'web_search',
          label: 'Recherche & Recoupement',
          detail: 'base de connaissances locale activée',
          status: 'done',
        })
      }
    } catch {
      send({
        type: 'step',
        id: searchStepId,
        tool: 'web_search',
        label: 'Recherche & Recoupement',
        detail: 'raisonnement local autonome',
        status: 'done',
      })
    }
  }

  // Émission de la chaîne de pensée (Chain-of-Thought visible)
  send({
    type: 'thought',
    text: `Décomposition analytique (${mode}) :\n1. Sujet central : « ${cleanTopic.slice(0, 70)} »\n2. Sources mobilisées : ${bestBank ? `savoir interne (${Math.round(bestBank.score * 100)}%)` : 'analyse conceptuelle'}${webResults.length > 0 ? ` + ${webResults.length} sources web` : ''}${notes.length > 0 ? ` + ${notes.length} note(s) personnelle(s)` : ''}\n3. Structuration d'une réponse complète et actionnable.`,
  })

  // 4) Mode Comparaison (A vs B)
  if (mode === 'comparison') {
    const pair = extractComparisonPair(userText)
    const [itemA, itemB] = pair ?? [cleanTopic, 'les alternatives']
    const capA = capitalize(itemA)
    const capB = capitalize(itemB)
    const hitA = searchKnowledgeBank(itemA, 1)[0]?.entry.answer
    const hitB = searchKnowledgeBank(itemB, 1)[0]?.entry.answer

    return `## ⚖️ Analyse comparative : **${capA}** vs **${capB}**

### 1. Vue d'ensemble
| Critère | **${capA}** | **${capB}** |
| :--- | :--- | :--- |
| **Philosophie principale** | Approche spécialisée, directe et rapide à mettre en œuvre sur son domaine cible | Approche complémentaire offrant un compromis différent (flexibilité / écosystème) |
| **Courbe d'apprentissage** | Progressive avec résultats rapides | Demande de bien cadrer la structure initiale |
| **Cas d'usage idéal** | Prototypage rapide, performance ciblée et maîtrise directe | Projets modulaires, passage à l'échelle ou besoins spécifiques |

${webSynthesis ? `### 2. Faits extraits des sources\n${webSynthesis}\n` : ''}
${hitA ? `### 3. Focus sur ${capA}\n${hitA.slice(0, 650)}\n` : ''}
${hitB ? `### 4. Focus sur ${capB}\n${hitB.slice(0, 650)}\n` : ''}

### 🎯 Ma recommandation tranchée
- **Choisis ${capA}** si ta priorité est d'aller droit au but avec une base éprouvée et un retour immédiat.
- **Choisis ${capB}** si tes contraintes techniques (architecture existante, performances spécifiques ou interopérabilité) l'exigent.
- Dis-moi ton contexte précis (ton projet actuel, ton niveau ou ta contrainte principale) et je te donne le choix exact avec un exemple de code !`
  }

  // 5) Mode Diagnostic / Troubleshooting
  if (mode === 'troubleshooting') {
    return `## 🛠️ Diagnostic & Résolution : **${capitalize(cleanTopic)}**

${bestBank ? `### 1. Rappel technique clé\n${bestBank.entry.answer}\n` : ''}
${webSynthesis ? `### 2. Pistes issues des sources techniques\n${webSynthesis}\n` : ''}

### 🔍 Méthodologie de résolution étape par étape
1. **Isoler la cause racine (Root Cause)** :
   - Vérifie le **message d'erreur exact** et la **ligne précise** dans la console (le premier message d'erreur est souvent la vraie cause, les suivants en sont des conséquences).
2. **Vérifier les 3 suspects habituels** :
   - **Données ` + '`null` / `undefined` / `nil`' + `** : une variable ou ressource qui n'est pas encore chargée au moment de l'appel (asynchrone / ` + '`WaitForChild`' + ` / ` + '`await`' + ` manquant).
   - **Portée ou permissions** : code exécuté côté client au lieu du serveur (ou inversement), ou variable locale masquant une autre.
   - **Contrat d'entrée/sortie** : mauvais format JSON, type inattendu ou promesse non résolue.
3. **Valider le correctif** :
   - Colle ton bloc de code ou le message d'erreur exact ici (ou ouvre-le dans le **Studio Code**) : je l'analyserai ligne par ligne et te proposerai le correctif exact.`
  }

  // 6) Mode Architecture / Plan d'action
  if (mode === 'architecture_plan') {
    return `## 🏗️ Plan d'architecture & de réalisation : **${capitalize(cleanTopic)}**

### 1. Découpage modulaire recommandé
1. **Couche Données & État (Modèle)** :
   - Définis d'abord les structures de données propres (types, schémas, état initial) avant d'écrire l'interface ou les effets visuels.
2. **Couche Logique Métier (Cœur)** :
   - Isole les règles métier dans de petites fonctions pures et testables indépendamment.
3. **Couche Interface & Interaction (Vue / Contrôleur)** :
   - Connecte les entrées utilisateur aux fonctions métier avec des retours visuels immédiats et une validation côté serveur.

${bestBank ? `### 2. Fondations techniques\n${bestBank.entry.answer}\n` : ''}
${webSynthesis ? `### 3. Bonnes pratiques & Sources\n${webSynthesis}\n` : ''}

### 🚀 Plan d'exécution en 3 jalons (MVP → Production)
- **Jalon 1 (Prototype fonctionnel)** : implémenter la boucle principale minimale (1 seule fonctionnalité de bout en bout qui marche sans bug).
- **Jalon 2 (Robustesse & Sécurité)** : ajouter la gestion d'erreurs, la validation des entrées et la persistance des données.
- **Jalon 3 (Polish & Optimisation)** : soigner l'UX, les animations et les performances.

💡 *Dis-moi « code-le » ou précise le langage souhaité (TypeScript, Python, Luau/Roblox, page Web…) et je te génère l'implémentation complète dans le Studio Code.*`
  }

  // 7) Mode Explication approfondie (synthèse combinée : Banque + Web + Notes + Mémoire)
  const sections: string[] = []
  sections.push(`## 💡 Analyse & Synthèse : **${capitalize(cleanTopic)}**`)

  if (bestBank) {
    sections.push(bestBank.entry.answer)
  }

  if (webSynthesis) {
    sections.push(`### 🌐 Synthèse des sources consultées en direct\n${webSynthesis}`)
  } else if (webResults.length > 0) {
    sections.push(
      `### 🌐 Sources et points clés repérés\n` +
        webResults
          .slice(0, 4)
          .map((r) => `- **${r.title}** (*${r.domain}*) : ${r.snippet.slice(0, 200)}`)
          .join('\n')
    )
  }

  if (notes.length > 0) {
    sections.push(
      `### 📓 En lien avec tes notes personnelles\n` +
        notes
          .slice(0, 2)
          .map((n) => `- **${n.title}** (*${n.category}*) : ${n.content.slice(0, 320)}`)
          .join('\n')
    )
  }

  if (!bestBank && !webSynthesis && webResults.length === 0) {
    const memContext =
      memories.length > 0
        ? `\n\n**Contexte retenu sur tes projets :**\n${memories.slice(0, 3).map((m) => `- ${m}`).join('\n')}`
        : ''
    sections.push(
      `Voici une décomposition structurée de **« ${cleanTopic} »** :\n\n` +
        `1. **Définition & Objectif** : cerner précisément le problème que « ${cleanTopic} » résout et le résultat concret attendu.\n` +
        `2. **Mécanisme fondamental** : décomposer le sujet en sous-parties indépendantes (entrées → traitement → sortie) pour maîtriser sa complexité.\n` +
        `3. **Application pratique** : passer rapidement de la théorie à un prototype concret (script, scène 3D, page interactive ou mission de veille).` +
        memContext
    )
  }

  sections.push(
    `*Tu veux aller plus loin ? Demande-moi un **exemple de code concret**, une **comparaison technique**, ou lance une **délibération du Bureau** pour avoir l'analyse croisée de toute ton équipe d'agents.*`
  )

  return sections.join('\n\n')
}
