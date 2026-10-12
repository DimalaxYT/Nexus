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
import { refactorExistingCode } from './codegen'
import { searchKnowledgeBank } from './knowledge-bank'
import { readWebpage, webSearch, type SearchResult } from './search'
import { extractKeySentences, synthesizePages, type PageContent } from './synthesize'
import {
  DEFAULT_BRAIN_PARAMETERS,
  getBrainReasoningLimits,
  isExplicitSearchRequest,
  normalizeBrainParameters,
  shouldSearchWebForReasoning,
  type BrainParameters,
} from './parameters'
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
  /** Réponse précédente disponible pour résoudre un suivi ou éviter une mauvaise interprétation. */
  previousAssistant?: string
  isClarificationFollowUp?: boolean
  brainParameters?: BrainParameters
  send: Emit
}

function formatPersonalContext(
  notes: DeepReasonInput['notes'],
  memories: string[],
  parameters: BrainParameters
): string {
  const blocks: string[] = []
  const detail = parameters.responseDetail
  const memoryLimit = detail === 'concise' ? 1 : detail === 'detailed' ? 5 : 3
  const noteCharacters = detail === 'concise' ? 180 : detail === 'detailed' ? 600 : 320

  if (notes.length > 0) {
    blocks.push(
      `### 📓 En lien avec tes notes personnelles\n` +
        notes
          .slice(0, parameters.noteLimit)
          .map((note) => `- **${note.title}** (*${note.category}*) : ${note.content.slice(0, noteCharacters)}`)
          .join('\n')
    )
  }
  if (parameters.usePersonalMemory && memories.length > 0) {
    blocks.push(`### 🧠 Informations retenues pertinentes\n${memories.slice(0, memoryLimit).map((memory) => `- ${memory}`).join('\n')}`)
  }
  return blocks.join('\n\n')
}

function localKnowledgeAnswer(answer: string, query: string, detail: BrainParameters['responseDetail']): string {
  if (detail !== 'concise') return answer
  const text = answer.replace(/```[\s\S]*?```/g, ' ').replace(/\s+/g, ' ').trim()
  const sentences = extractKeySentences(text, query, 3)
  if (sentences.length > 0) return `**En bref :**\n${sentences.map((sentence) => `- ${sentence}`).join('\n')}`
  const clean = text.replace(/[*_`#]/g, '').trim()
  return clean.length > 620 ? `${clean.slice(0, 617).trimEnd()}…` : clean
}

function isQuestionAboutNexusChanges(text: string): boolean {
  const normalized = normalize(text)
  const refersToNexus = /\b(?:ton|ta|tes|your|its|nexus|de toi|mon propre)\b/.test(normalized)
  const refersToCode = /\b(?:code|script|programme|source|moteur)\b/.test(normalized)
  const asksAboutChanges = /\b(?:change\w*|modif\w*|update\w*|mise\s+a\s+jour|ajout\w*|apport\w*|evolu\w*)\b/.test(normalized)
  const questionForm = /[?？]/.test(text) || /^(?:qu[' ]?est|quesque|what|which|why|how)\b/.test(normalized)
  return refersToNexus && refersToCode && asksAboutChanges && questionForm
}

function answerAboutNexusChanges(previousAssistant?: string): string {
  const previousFile = previousAssistant?.match(/\b([\p{L}\d_-]+\.(?:py|js|jsx|ts|tsx|lua|html|css))\b/iu)?.[1]
  const previousWasCodeGeneration = Boolean(
    previousFile && previousAssistant && /(?:script|fichier|code).{0,80}(?:pr[eê]t|g[eé]n[eé]r[eé]|cr[eé][ée]|ouvert|produit)/i.test(previousAssistant)
  )
  const correction = previousWasCodeGeneration
    ? `Ma réponse précédente a mal interprété ta question et a généré « ${previousFile} » au lieu d'y répondre. Ce fichier est séparé du moteur NEXUS : il n'a pas modifié mon propre code.`
    : `Je n'ai pas modifié mon moteur en réponse à cette question.`

  return `Tu demandes les changements apportés à mon propre code, pas la création d'un nouveau script. ${correction} Je ne peux pas consulter l'historique Git de mon moteur depuis cette conversation. Si tu ouvres les fichiers concernés dans le Studio Code ou me fournis un diff, je peux t'en faire un résumé précis.`
}

/**
 * Exécute le pipeline de raisonnement analytique profond (Chain-of-Thought +
 * RAG local + recherche web autonome si nécessaire + synthèse structurée).
 */
export async function deepReasonAndAnswer(input: DeepReasonInput): Promise<string> {
  const {
    userText,
    topic,
    notes,
    currentCode,
    previousAssistant,
    isClarificationFollowUp = false,
    send,
  } = input
  const brainParameters = normalizeBrainParameters(input.brainParameters ?? DEFAULT_BRAIN_PARAMETERS)
  const reasoningLimits = getBrainReasoningLimits(brainParameters.responseDetail)
  const memories = brainParameters.usePersonalMemory ? input.memories : []
  const cleanTopic = (topic || userText).replace(/[?!.]+$/, '').trim()
  const personalContext = formatPersonalContext(notes, memories, brainParameters)
  const appendPersonalContext = (answer: string) =>
    personalContext ? `${answer}\n\n${personalContext}` : answer
  const followUpQuestion = isClarificationFollowUp
    ? userText.match(/Question de suivi\s*\(«\s*([^»]+?)\s*»\)/i)?.[1]?.trim()
    : undefined
  const previousContext = isClarificationFollowUp && previousAssistant
    ? extractKeySentences(previousAssistant, cleanTopic, 3)
    : []
  const followUpAction = (followUpQuestion ?? '').replace(/^(?:et\s+)?/i, '').replace(/[?!.]+/g, '').trim()
  const researchTopic = isClarificationFollowUp && followUpAction
    ? `${followUpAction} ${cleanTopic}`
    : cleanTopic

  if (isQuestionAboutNexusChanges(userText)) {
    send({ type: 'thought', text: 'Question sur les changements du moteur détectée — je ne la confonds pas avec une demande de nouveau script.' })
    return answerAboutNexusChanges(previousAssistant)
  }

  const fencedMatch = userText.match(/```(\w+)?\n([\s\S]+?)```/)
  const codeToAnalyze =
    fencedMatch?.[2] ||
    (currentCode?.js?.trim() || currentCode?.html?.trim() || '')
  const codeLang = fencedMatch?.[1] || currentCode?.language || ''

  // Une clarification porte sur la réponse précédente : les mots du sujet original
  // ne doivent pas déclencher à tort un mode (architecture, diagnostic, audit).
  const mode = isClarificationFollowUp
    ? 'deep_explanation'
    : detectReasoningMode(userText, Boolean(codeToAnalyze))

  // 1) Mode Audit de code
  if (mode === 'code_audit' && codeToAnalyze) {
    send({
      type: 'thought',
      text: `Raisonnement analytique (mode Audit de code) :\n1. Inspection statique de l'AST / motifs (${codeToAnalyze.split('\n').length} lignes)\n2. Vérification sécurité (injections, secrets, autorité serveur)\n3. Génération automatique du correctif sécurisé.`,
    })
    const report = analyzeCodeStatic(codeToAnalyze, codeLang)
    const findingLimit = brainParameters.responseDetail === 'concise' ? 4 : brainParameters.responseDetail === 'balanced' ? 8 : report.findings.length
    const auditReport = {
      ...report,
      findings: report.findings.slice(0, findingLimit),
      strengths: report.strengths.slice(0, brainParameters.responseDetail === 'concise' ? 3 : report.strengths.length),
    }
    const auditMd = formatCodeAuditMarkdown(auditReport, currentCode?.filename ? `« ${currentCode.filename} »` : 'ton code')
    const refactored = refactorExistingCode(
      {
        html: currentCode?.html ?? '',
        css: currentCode?.css ?? '',
        js: codeToAnalyze,
        language: report.language,
        filename: currentCode?.filename,
      },
      userText
    )
    if (refactored && refactored.modified) {
      return `${auditMd}\n\n### 🛠️ Version corrigée et sécurisée automatiquement\nModifications appliquées :\n${refactored.changesSummary.map((c) => `- ${c}`).join('\n')}\n\n\`\`\`${report.language}\n${refactored.files.js.trim()}\n\`\`\``
    }
    return auditMd
  }

  // 2) Recherche dans la banque sémantique locale
  const bankHits = searchKnowledgeBank(
    isClarificationFollowUp ? researchTopic : userText,
    reasoningLimits.knowledgeMatches
  )
  const bestBank = bankHits[0]
  const shouldSearchWeb = shouldSearchWebForReasoning(
    brainParameters.webResearch,
    bestBank?.score,
    userText
  )

  // 3) Recherche Web suivant le réglage choisi et la couverture locale.
  let webResults: SearchResult[] = []
  let webSynthesis = ''
  if (shouldSearchWeb) {
    const searchStepId = `step-reason-${Date.now()}`
    send({
      type: 'step',
      id: searchStepId,
      tool: 'web_search',
      label: 'Recherche & Recoupement',
      detail: `analyse multi-sources sur « ${researchTopic.slice(0, 60)} »`,
      status: 'running',
    })
    try {
      const results = await webSearch(researchTopic, reasoningLimits.webResults)
      if (results && results.length > 0) {
        webResults = results.slice(0, reasoningLimits.webResults)
        const sources: SourceItem[] = webResults.map((r) => ({
          title: r.title,
          url: r.url,
          domain: r.domain,
          snippet: r.snippet,
        }))
        send({ type: 'sources', sources })

        // La profondeur choisie borne les pages lues et la quantité de faits extraits.
        const pagesToRead = webResults
          .filter((r) => !/(youtube|tiktok|reddit)/i.test(r.domain))
          .slice(0, reasoningLimits.pagesToRead)
        const readPages = (
          await Promise.all(
            pagesToRead.map(async (r): Promise<PageContent | null> => {
              const p = await readWebpage(r.url, 6000)
              return p ? { title: p.title, url: p.url, domain: r.domain, text: p.text } : null
            })
          )
        ).filter((p): p is PageContent => p !== null)

        if (readPages.length > 0) {
          webSynthesis = synthesizePages(
            researchTopic,
            readPages,
            reasoningLimits.synthesizedSentencesPerPage,
            reasoningLimits.synthesizedTotalSentences
          )
        }
        if (!webSynthesis) {
          const snippetText = webResults.map((r) => `${r.title}. ${r.snippet}`).join('. ')
          const keySents = extractKeySentences(snippetText, researchTopic, reasoningLimits.snippetSentences)
          if (keySents.length > 0) {
            webSynthesis = keySents.map((s) => `- ${s}`).join('\n')
          }
        }
        send({
          type: 'step',
          id: searchStepId,
          tool: 'web_search',
          label: 'Recherche & Recoupement',
          detail: `${webResults.length} sources croisées${readPages.length > 0 ? ` · ${readPages.length} pages analysées` : ''}`,
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
    text: `Décomposition analytique (${mode}) :\n1. Sujet central : « ${cleanTopic.slice(0, 70)} »\n2. Sources mobilisées : ${bestBank ? `savoir interne (${Math.round(bestBank.score * 100)}%)` : 'analyse conceptuelle'}${webResults.length > 0 ? ` + ${webResults.length} sources web` : ''}${notes.length > 0 ? ` + ${notes.length} note(s) personnelle(s)` : ''}${memories.length > 0 ? ` + ${memories.length} mémoire(s) pertinente(s)` : ''}${previousContext.length > 0 ? ' + réponse précédente' : ''}\n3. Structuration d'une réponse complète et actionnable.`,
  })

  // 4) Mode Comparaison (A vs B)
  if (mode === 'comparison') {
    const pair = extractComparisonPair(userText)
    const [itemA, itemB] = pair ?? [cleanTopic, 'les alternatives']
    const capA = capitalize(itemA)
    const capB = capitalize(itemB)
    const bankA = searchKnowledgeBank(itemA, 1)[0]
    const bankB = searchKnowledgeBank(itemB, 1)[0]
    const factsA = bankA && bankA.score >= 0.75
      ? extractKeySentences(bankA.entry.answer.replace(/```[\s\S]*?```/g, ' '), bankA.entry.question, reasoningLimits.comparisonFacts)
      : []
    const factsB = bankB && bankB.score >= 0.75
      ? extractKeySentences(bankB.entry.answer.replace(/```[\s\S]*?```/g, ' '), bankB.entry.question, reasoningLimits.comparisonFacts)
      : []
    const formatFacts = (facts: string[], sourceQuestion?: string) =>
      facts.length > 0
        ? `${sourceQuestion ? `*Fiche locale — ${sourceQuestion}*\n` : ''}${facts.map((fact) => `- ${fact}`).join('\n')}`
        : 'Pas d’extrait local suffisamment ciblé.'
    const webEvidence = webSynthesis || webResults
      .slice(0, reasoningLimits.comparisonFacts)
      .map((result) => `- **${result.title}** (*${result.domain}*) : ${result.snippet.slice(0, brainParameters.responseDetail === 'concise' ? 140 : brainParameters.responseDetail === 'detailed' ? 300 : 220)}`)
      .join('\n')
    const recommendation = factsA.length > 0 && factsB.length > 0
      ? 'Les informations disponibles couvrent les deux sujets, mais pas tes contraintes. Je ne désigne pas de gagnant sans connaître ton objectif prioritaire.'
      : 'Les informations disponibles ne forment pas une base équilibrée pour départager les deux options. Il faut préciser le contexte ou consulter des sources plus ciblées.'
    const comparisonGuidance = brainParameters.responseDetail === 'concise'
      ? `### 🎯 Pour choisir\n- Compare les options selon ton critère prioritaire (coût, performance, simplicité ou sécurité).\n- Donne-moi ton contexte pour une recommandation fondée.`
      : `### 🎯 Comment les départager\n- Définis le critère principal : coût, performance, simplicité, sécurité ou compatibilité.\n- Compare les deux options avec le même scénario et les mêmes contraintes.\n- Vérifie les éléments qui comptent pour ton projet plutôt que de choisir sur une préférence générale.`

    return appendPersonalContext(`## ⚖️ Comparaison : **${capA}** vs **${capB}**

${webEvidence ? `### 🌐 Éléments récupérés sur le Web
${webEvidence}` : ''}
### 📚 Ce que contient la base locale sur ${capA}
${formatFacts(factsA, bankA?.entry.question)}

### 📚 Ce que contient la base locale sur ${capB}
${formatFacts(factsB, bankB?.entry.question)}

${comparisonGuidance}

### Conclusion provisoire
${recommendation}
Dis-moi ton cas d’usage et le critère le plus important ; je pourrai alors formuler une recommandation fondée sur ce contexte.`)
  }

  // 5) Mode Diagnostic / Troubleshooting
  if (mode === 'troubleshooting') {
    const troubleshootingGuide = brainParameters.responseDetail === 'concise'
      ? `### 🔍 Vérifications rapides
1. Reproduis l'erreur et relève le premier message exact.
2. Vérifie les données manquantes, les permissions client/serveur et le format des entrées.
3. Applique un correctif minimal puis rejoue le même scénario.`
      : brainParameters.responseDetail === 'detailed'
        ? `### 🔍 Diagnostic approfondi
1. **Isoler la cause racine** : relève le premier message d'erreur et la ligne concernée, puis reproduis le problème dans un cas minimal.
2. **Vérifier les entrées** : inspecte les valeurs nulles/undefined/nil, les formats reçus et les ressources chargées de façon asynchrone.
3. **Contrôler l'exécution** : confirme le côté client/serveur, les permissions et les appels réseau ou base de données.
4. **Valider durablement** : applique le correctif, ajoute un test de régression et rejoue les cas voisins.`
        : `### 🔍 Méthodologie de résolution étape par étape
1. **Isoler la cause racine (Root Cause)** :
   - Vérifie le **message d'erreur exact** et la **ligne précise** dans la console (le premier message d'erreur est souvent la vraie cause, les suivants en sont des conséquences).
2. **Vérifier les 3 suspects habituels** :
   - **Données \`null\` / \`undefined\` / \`nil\`** : une variable ou ressource qui n'est pas encore chargée au moment de l'appel (asynchrone / \`WaitForChild\` / \`await\` manquant).
   - **Portée ou permissions** : code exécuté côté client au lieu du serveur (ou inversement), ou variable locale masquant une autre.
   - **Contrat d'entrée/sortie** : mauvais format JSON, type inattendu ou promesse non résolue.
3. **Valider le correctif** :
   - Colle ton bloc de code ou le message d'erreur exact ici (ou ouvre-le dans le **Studio Code**) : je l'analyserai ligne par ligne et te proposerai le correctif exact.`

    return appendPersonalContext(`## 🛠️ Diagnostic & Résolution : **${capitalize(cleanTopic)}**

${bestBank ? `### 1. Rappel technique clé
${localKnowledgeAnswer(bestBank.entry.answer, cleanTopic, brainParameters.responseDetail)}
` : ''}
${webSynthesis ? `### 2. Pistes issues des sources techniques
${webSynthesis}
` : ''}
${troubleshootingGuide}`)
  }

  // 6) Mode Architecture / Plan d'action
  if (mode === 'architecture_plan') {
    const architectureLayers = brainParameters.responseDetail === 'concise'
      ? `### 1. Structure minimale
1. **Données** : définis les types et l'état initial.
2. **Logique et interface** : isole les règles testables, puis relie-les à l'interface avec validation.`
      : brainParameters.responseDetail === 'detailed'
        ? `### 1. Découpage modulaire recommandé
1. **Données & état** : fixe les schémas, invariants, persistance et migrations avant l'interface.
2. **Logique métier** : isole les règles dans des fonctions pures, avec contrats et tests unitaires.
3. **Services & intégrations** : encapsule le réseau, la base de données et les permissions; prévois délais, erreurs et reprise.
4. **Interface** : connecte les entrées validées à la logique, avec états de chargement, succès et échec accessibles.`
        : `### 1. Découpage modulaire recommandé
1. **Couche Données & État (Modèle)** :
   - Définis d'abord les structures de données propres (types, schémas, état initial) avant d'écrire l'interface ou les effets visuels.
2. **Couche Logique Métier (Cœur)** :
   - Isole les règles métier dans de petites fonctions pures et testables indépendamment.
3. **Couche Interface & Interaction (Vue / Contrôleur)** :
   - Connecte les entrées utilisateur aux fonctions métier avec des retours visuels immédiats et une validation côté serveur.`
    const architectureMilestones = brainParameters.responseDetail === 'concise'
      ? `### 🚀 Deux jalons
- Prototype : une fonctionnalité de bout en bout.
- Robustesse : validation, gestion d'erreurs et test du parcours principal.`
      : brainParameters.responseDetail === 'detailed'
        ? `### 🚀 Jalons de réalisation
- **Prototype** : boucle minimale de bout en bout.
- **Robustesse** : validation, sécurité, tests de régression et gestion des erreurs.
- **Production** : persistance, observabilité, sauvegardes et surveillance.
- **Optimisation** : mesure des performances avant toute optimisation.`
        : `### 🚀 Plan d'exécution en 3 jalons (MVP → Production)
- **Jalon 1 (Prototype fonctionnel)** : implémenter la boucle principale minimale (1 seule fonctionnalité de bout en bout qui marche sans bug).
- **Jalon 2 (Robustesse & Sécurité)** : ajouter la gestion d'erreurs, la validation des entrées et la persistance des données.
- **Jalon 3 (Polish & Optimisation)** : soigner l'UX, les animations et les performances.`

    return appendPersonalContext(`## 🏗️ Plan d'architecture & de réalisation : **${capitalize(cleanTopic)}**

${architectureLayers}

${bestBank ? `### 2. Fondations techniques
${localKnowledgeAnswer(bestBank.entry.answer, cleanTopic, brainParameters.responseDetail)}
` : ''}
${webSynthesis ? `### 3. Bonnes pratiques & Sources
${webSynthesis}
` : ''}
${architectureMilestones}

💡 *Dis-moi « code-le » ou précise le langage souhaité (TypeScript, Python, Luau/Roblox, page Web…) et je te génère l'implémentation complète dans le Studio Code.*`)
  }

  // 7) Mode Explication approfondie (synthèse combinée : Banque + Web + Notes + Mémoire)
  const sections: string[] = []
  sections.push(`## 💡 Analyse & Synthèse : **${capitalize(cleanTopic)}**`)

  if (isClarificationFollowUp) {
    const previousReplyBlock = previousContext.length > 0
      ? `Le passage le plus pertinent de ma réponse précédente :\n\n${previousContext.map((sentence) => `> ${sentence}`).join('\n')}`
      : `Je reprends le sujet **${cleanTopic}** à partir de ta précision${followUpQuestion ? ` « ${followUpQuestion} »` : ''}.`
    sections.push(`### 🧵 Lien avec ta question précédente${followUpQuestion ? ` (« ${followUpQuestion} »)` : ''}\n${previousReplyBlock}`)
  }

  if (bestBank) {
    sections.push(localKnowledgeAnswer(bestBank.entry.answer, cleanTopic, brainParameters.responseDetail))
    const extraFactLimit = brainParameters.responseDetail === 'detailed' ? 3 : 1
    for (const hit of bankHits.slice(1)) {
      if (hit.score < 0.68) continue
      const facts = extractKeySentences(
        hit.entry.answer.replace(/```[\s\S]*?```/g, ' '),
        cleanTopic,
        extraFactLimit
      )
      if (facts.length > 0) {
        sections.push(`### Complément de la base locale — ${hit.entry.question}\n${facts.map((fact) => `- ${fact}`).join('\n')}`)
      }
    }
  }

  if (webSynthesis) {
    sections.push(`### 🌐 Synthèse des sources consultées en direct\n${webSynthesis}`)
  } else if (webResults.length > 0) {
    sections.push(
      `### 🌐 Sources et points clés repérés\n` +
        webResults
          .slice(0, reasoningLimits.comparisonFacts)
          .map((r) => `- **${r.title}** (*${r.domain}*) : ${r.snippet.slice(0, brainParameters.responseDetail === 'concise' ? 140 : brainParameters.responseDetail === 'detailed' ? 300 : 200)}`)
          .join('\n')
    )
  }

  if (personalContext) sections.push(personalContext)

  if (!bestBank && !webSynthesis && webResults.length === 0) {
    const fallbackAnswer = brainParameters.responseDetail === 'concise'
      ? `En bref, décompose **« ${cleanTopic} »** en objectif, entrées et résultat attendu, puis teste une petite solution concrète.`
      : brainParameters.responseDetail === 'detailed'
        ? `Voici une décomposition structurée de **« ${cleanTopic} »** :

1. **Définition & objectif** : précise le besoin, les utilisateurs concernés et le résultat mesurable.
2. **Mécanisme** : sépare les entrées, les règles de traitement, les dépendances et les sorties.
3. **Cas limites** : vérifie les erreurs, les permissions, les données manquantes et les contraintes de performance.
4. **Application pratique** : construis un prototype minimal, teste-le sur des scénarios réels et affine-le selon les résultats.`
        : `Voici une décomposition structurée de **« ${cleanTopic} »** :

1. **Définition & Objectif** : cerner précisément le problème que « ${cleanTopic} » résout et le résultat concret attendu.
2. **Mécanisme fondamental** : décomposer le sujet en sous-parties indépendantes (entrées → traitement → sortie) pour maîtriser sa complexité.
3. **Application pratique** : passer rapidement de la théorie à un prototype concret (script, scène 3D, page interactive ou mission de veille).`
    sections.push(fallbackAnswer)
    if (brainParameters.webResearch === 'never' && !isExplicitSearchRequest(userText)) {
      sections.push('La recherche Web automatique est désactivée. Pour des informations à jour, demande explicitement une recherche sur le Web.')
    }
  }

  sections.push(
    `*Tu veux aller plus loin ? Demande-moi un **exemple de code concret**, une **comparaison technique**, ou lance une **délibération du Bureau** pour avoir l'analyse croisée de toute ton équipe d'agents.*`
  )

  return sections.join('\n\n')
}
