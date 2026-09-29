// ─── NEXUS Brain — Classifieur d'intentions hybride ──────────────────────────
// Combine le réseau de neurones (généralisation) et un scoreur lexical
// précis (mots déclencheurs pondérés). Le vainqueur l'emporte, avec repli.

import { INTENTS, buildDataset, type IntentLabel } from './dataset'
import { predict, trainNetwork, type TrainedNet } from './neural'
import { contentTokens, normalize, stem, hashString } from './text'

// ── Scoreur lexical : motifs pondérés par intention ──────────────────────────

type Weighted = [RegExp, number][]

const LEXICON: Record<IntentLabel, Weighted> = {
  greeting: [[/\b(bonjour|salut|hello|coucou|hey|yo|bonsoir|hi|bjr|slt|wesh)\b/, 4]],
  farewell: [[/\b(au revoir|bye|a plus|a\+|ciao|adieu|bonne (journee|nuit|soiree)|see you|a bientot|a demain)\b/, 5]],
  thanks: [[/\b(merci|thanks|thank you|thx)\b/, 6]],
  howareyou: [[/\b(ca va|comment vas.?tu|tu vas bien|la forme|ca boume|quoi de neuf|how are you|comment tu te sens)\b/, 6]],
  identity: [
    [/\b(qui es.?tu|tu es qui|c ?est quoi nexus|presente.?toi|parle moi de toi|ton nom|tu es une ia|tu es un robot|who are you|tu sers a quoi)\b/, 6],
    // « décris-toi », « décris toi », « raconte-toi », « présente-toi plus en détail »…
    [/\b(decris|decrire|presente| presenter|raconte|decrit|definis)\b.{0,12}\b(toi|te.?meme|vous.?meme|ton histoire|ta personne|ce que tu es)\b/, 9],
    [/\b(fais|donne|donne moi)\b.{0,10}\b(ta|une)\b\s*presentation\b/, 7],
    [/\b(describe|introduce)\s+yourself\b/, 7],
    [/\b(parle|raconte|dis)\b.{0,8}\b(de|sur)\s*toi\b/, 8],
    [/\b(t'es quoi|tu es quoi|t es qui|tes origines|ton historie|ton histoire)\b/, 5],
  ],
  capabilities: [
    [/\b(que sais.?tu faire|tu sais faire quoi|tes (fonctionnalites|capacites|outils|fonctions)|quels outils|quelle aide|l aide|help|commandes disponibles|que peux.?tu)\b/, 5],
    [/\b(liste (de )?tes outils|aide moi a comprendre l app)\b/, 3],
    // « quels fonctions tu as », « tu as quoi comme fonctions en plus »,
    // « qu'est-ce que tu as comme mises à jour »… (texte NORMALISÉ : sans accents)
    [/\b(quelles?|quels)\b.{0,16}\b(fonction\w*|capacites?|outils?|mises? a jour|maj|updates?|nouveautes?)\b.{0,24}\b(tu as|as.?tu|tu proposes?|tu possedes?|tu disposes?|en plus|de plus|chez toi|comme)\b/, 6],
    [/\b(fonction\w*|capacites?|outils?|mises? a jour|maj|nouveautes?|updates?)\b.{0,18}\b(en plus|de plus)\b/, 6],
    [/\b(tu as quoi|tu fais quoi|tu proposes quoi|on peut faire quoi|c est quoi tes)\b/, 5],
    // « ta dernière mise à jour », « quelle est ta dernière version »…
    [/\b(ta|tes|quelle|quelles? est|quelles? sont)\b.{0,10}\b(derniere|recente|nouvelle|nouvelles)\b.{0,10}\b(mises? a jour|maj|updates?|nouveautes?|versions?|fonctionnalites?|fonctions?)\b/, 7],
    [/\b(derniere mise a jour|derniere maj|derniere version|dernieres nouveautes|derniere nouveaute|nouvelles fonctions|fonctions en plus|nouveaux outils|quoi de nouveau|quoi de neuf chez toi)\b/, 8],
    [/\b(tes|mises)?\s*mises? a jour\b.{0,14}\b(tu as|recentes?|recent|chez nexus|de l app|de l application)\b/, 5],
  ],
  search: [
    [/\b(cherche|recherche|trouve.?moi|googlise?|renseigne.?toi)\b/, 4],
    [/\b(actualites|actus|news|meteo|temps qu.il fait|prix du|cours (du|de la)|score|resultat du match|bourse|en direct)\b/, 4],
    [/\b(aujourd.hui|hier|cette semaine|dernier(es|e)?s?)\b/, 1],
  ],
  readpage: [
    [/https?:\/\/\S+/, 7],
    [/\b(lis|lire|ouvre|ouvrir|visite|visiter|resume|analyse) (cette |le |la |ce )?(page|site|lien|url|article|article web)\b/, 5],
    [/\b(que dit (cette|ce) (page|site))\b/, 5],
  ],
  code: [
    [/\b(script|programme|code(r)?|developpe|fonction|algorithme|mod|bot|classe|api|shader|requete sql|automatis)\w*\b/, 3],
    [/\b(lua|luau|roblox studio|python|javascript|typescript|c#|csharp|c\+\+|cpp|java|rust|golang|glsl|bash|powershell|sql)\b/, 3],
    [/\b(jeux? roblox|roblox)\b.*\b(script|systeme|system|sauter|saut|piece|coin|magasin|shop|boutique|inventaire|checkpoint|porte|kill|degat|zombie|npc|pnj|datastore|sauvegarde|classement|leaderboard)\b/, 6],
    [/\b(un jeu (en|de) (python|lua|js))\b/, 3],
  ],
  image: [
    [/\b(genere|genere.?moi|cree|dessine|fais|donne).{0,20}\b(image|dessin|illustration|logo|avatar|icon|icone|poster|banniere|fond d.ecran|visuel|art)\b/, 6],
    [/\b(une? )\b(image|photo|illustration|dessin)\b/, 3],
    [/\b(image de|photo de|dessin de)\b/, 5],
  ],
  scene3d: [
    [/\b(scene 3d|monde 3d|en 3d|3d)\b/, 5],
    [/\b(modelise|maquette|baseplate)\b/, 4],
  ],
  webpage: [
    [/\b(page web|site web|site internet|landing page|page html|site pour|site de)\b/, 6],
    [/\b(en html|en css|mini.?jeu (en|html)|portfolio en ligne)\b/, 4],
  ],
  video: [
    [/\b(video|clip|film|trailer|bande.?annonce|cinematique|animation filmee)\b/, 6],
    [/\b(genere|fais|cree).{0,15}\b(video|clip)\b/, 8],
  ],
  math: [
    [/^[\s\d+\-*/^().,%]+$/, 10],
    [/\b(combien font|combien fait|calcule|resous|racine|puissance|au carre|pourcent de|pourcentage de|moyenne de|pgcd|ppcm|log de|sin |cos |tan )\b/, 6],
    [/\d+\s*[+\-*/^x*]\s*\d+/, 5],
  ],
  task: [
    [/\b(mission|tache|task|objectif|avancement|bilan|statut)\b/, 4],
    [/^mission\s*:/, 10],
    [/\b(je te confie|assigne|note dans la mission|ajoute (une )?(mission|objectif))\b/, 5],
  ],
  knowledge_save: [
    [/\b(retiens|note ca|note que|enregistre|souviens.?toi|stocke|garde en memoire|ajoute (ca|ça|a ma base|a ta base|cette note))\b/, 6],
    [/\b(base de connaissances|dans tes notes)\b/, 3],
  ],
  knowledge_query: [
    [/\b(que sais.?tu sur|que (as|as.?tu|avez).{0,4}retenu|mes notes|cherche dans (ta|la) base|tes notes|retrouve la note|tu te souviens (de|du))\b/, 6],
    [/\b(base de connaissances|mes connaissances)\b/, 3],
  ],
  time: [[/\b(quelle heure|quel jour|date du jour|la date d aujourd.hui|l heure|time|il est quelle heure)\b/, 8]],
  about_user: [
    [/\b(comment je m.appelle|qui je suis|mon nom|mon prenom|tu connais mon nom|tu sais qui je suis|ce que tu sais sur moi|mes infos|presente moi\b)/, 7],
    [/\b(tu te souviens de moi|mon profil|mes projets( personnels)?)\b/, 5],
    // Présentation spontanée : « je m'appelle … », « j'habite à … », « j'ai X ans »…
    [/\bje m.?appelle\b|\bm.?appelle\s+\p{L}{2,}/u, 7],
    [/\bj.?habite\b|\bje vis\s+(a|dans|au|en)\b/, 6],
    [/\bj.?ai\s+\d{1,2}\s+ans\b/, 6],
    [/\bmon (jeu|projet|serveur|chaine|cha[îi]ne)\s+(s.?appelle|est|c'?est)\b/, 6],
  ],
  smalltalk: [
    [/\b(explique|pourquoi|comment|c est quoi|qu.est.?ce que|raconte|blague|idee|idees|conseil|conseils|astuce|astuces|fais moi rire|motivation)\b/, 2],
    [/\b(je suis fatigue|demotive|triste|stresse)\b/, 4],
  ],
}

export interface Classification {
  intent: IntentLabel
  confidence: number
  source: 'neural' | 'lexical' | 'mixed'
  topScores: { intent: IntentLabel; score: number }[]
}

// ── Singleton : réseau entraîné une seule fois par process ────────────────────

const globalForBrain = globalThis as unknown as { __nexusNet?: TrainedNet }

function getNet(): TrainedNet {
  if (!globalForBrain.__nexusNet) {
    const dataset = buildDataset()
    globalForBrain.__nexusNet = trainNetwork(dataset, [...INTENTS])
  }
  return globalForBrain.__nexusNet
}

/** Prépare le réseau (peut être appelé au warm-up pour éviter la 1re latence). */
export function warmUpClassifier(): number {
  const net = getNet()
  return net.accuracy
}

function lexicalScores(text: string): Map<IntentLabel, number> {
  const scores = new Map<IntentLabel, number>()
  for (const intent of INTENTS) {
    let score = 0
    for (const [re, weight] of LEXICON[intent]) {
      if (re.test(text)) score += weight
    }
    if (score > 0) scores.set(intent, score)
  }
  return scores
}

/**
 * Classe le message : le réseau de neurones donne une distribution,
 * le scoreur lexical affine. Retourne l'intention + confiance 0→1.
 */
export function classify(rawText: string): Classification {
  // Le scoreur lexical travaille sur le texte NORMALISÉ (accents retirés) :
  // « décris-toi » doit matcher « decris.?toi » même accentué.
  const text = normalize(rawText)
  const net = getNet()
  const nn = predict(net, rawText)

  // Garde-fou dur : les questions auto-référentielles sont TOUJOURS identity
  // (jamais code, même si un mot comme « programme » traîne dans la phrase).
  if (/\b(decris|decrire|presente|raconte|decrit|definis)\b.{0,12}\b(toi|te.?meme|ce que tu es)\b/.test(text) ||
      /\b(qui es.?tu|tu es qui|parle moi de toi|parle de toi|describe yourself)\b/.test(text)) {
    return {
      intent: 'identity',
      confidence: 0.98,
      source: 'lexical',
      topScores: [
        { intent: 'identity', score: 0.98 },
        { intent: 'smalltalk', score: 0.2 },
      ],
    }
  }

  // Garde-fou CAPACITÉS / MISES À JOUR : les questions sur les fonctions, les
  // outils ou les nouveautés de l'application sont TOUJOURS « capabilities ».
  // Le réseau neuronal se trompe presque toujours sur ces formulations hors
  // vocabulaire (cas réels : « quels fonctions en plus tu as ? » → knowledge_save
  // — NEXUS rangeait la question dans sa base ! — et « quels est ta dernière
  // mise a jour ? » → readpage — il demandait une URL !).
  if (
    /\b(quelles?|quels|quoi|qu.?est.?ce|tu as quoi)\b.{0,20}\b(fonction\w*|capacites?|outils?|mises? a jour|maj|updates?|nouveautes?)\b/.test(text) ||
    /\b(derniere mise a jour|derniere maj|derniere version|dernieres nouveautes|fonctions en plus|nouvelles fonctions|nouveaux outils|quoi de neuf chez toi|quoi de nouveau)\b/.test(text) ||
    /\b(tu as quoi|tu fais quoi|tes fonctionnalites|tes capacites|tes outils|tes fonctions|tes mises? a jour|ta derniere|tes dernieres)\b/.test(text)
  ) {
    return {
      intent: 'capabilities',
      confidence: 0.94,
      source: 'lexical',
      topScores: [
        { intent: 'capabilities', score: 0.94 },
        { intent: 'identity', score: 0.2 },
      ],
    }
  }

  // Garde-fou SUIVI DE CONVERSATION : « fais-le », « réalise-le », « ok lance-le »,
  // « continue », « vas-y », « exécute »… sont des demandes qui référencent le
  // sujet précédent du chat. Le réseau neuronal se trompe presque toujours sur
  // ces messages très courts (mots hors vocabulaire → identity 99 % !), ce qui
  // faisait répondre NEXUS « je me présente » au lieu d'EXÉCUTER. On force la
  // route conversationnelle (LLM + historique du chat + contexte résolu).
  if (
    text.length <= 60 &&
    /^(?:ok |alors |bon |ben |et )*(?:vas[- ]?y|go\b|fais(?:[- ](?:le|la|les|ca))?|realise(?:[- ](?:le|la|les))?|execute(?:[- ](?:le|la|les))?|implemente(?:[- ](?:le|la|les))?|lance(?:[- ](?:le|la|les))?|termine(?:[- ](?:le|la|les))?|continue|c[' ]est parti|fonce|maintenant)\b[.!?]*\s*(?:stp|svp)?\s*$/i.test(text)
  ) {
    return {
      intent: 'smalltalk',
      confidence: 0.55,
      source: 'lexical',
      topScores: [
        { intent: 'smalltalk', score: 0.55 },
        { intent: 'code', score: 0.1 },
      ],
    }
  }

  const lex = lexicalScores(text)
  let lexBest: IntentLabel = 'smalltalk'
  let lexBestScore = 0
  const lexSorted = [...lex.entries()].sort((a, b) => b[1] - a[1])
  if (lexSorted.length > 0) {
    lexBest = lexSorted[0][0]
    lexBestScore = lexSorted[0][1]
  }

  // Le lexical est très fiable au-dessus de 4 points → il l'emporte
  if (lexBestScore >= 4) {
    const nnScore = nn.dist.get(lexBest) ?? 0
    return {
      intent: lexBest,
      confidence: Math.min(0.99, 0.6 + nnScore * 0.35 + Math.min(lexBestScore, 10) * 0.02),
      source: 'lexical',
      topScores: lexSorted.slice(0, 3).map(([intent, score]) => ({ intent, score: Math.min(1, score / 10) })),
    }
  }

  // Sinon : le neurone décide (seuil de confiance)
  if (nn.confidence >= 0.35) {
    const lexScore = lex.get(nn.label as IntentLabel) ?? 0
    // Protection ANTI-FAUX-POSITIFS : certaines intentions exigeantes ont des
    // déclencheurs lexicaux PRÉCIS (verbes impératifs, URL…). Si le neurone les
    // choisit sans AUCUN signal lexical, c'est presque toujours une erreur de
    // généralisation sur des mots hors vocabulaire → on route en conversation
    // (le LLM sait répondre, et les replis locaux restent accessibles).
    const RISKY: IntentLabel[] = ['knowledge_save', 'knowledge_query', 'readpage', 'task', 'time']
    if (RISKY.includes(nn.label as IntentLabel) && lexScore === 0) {
      return {
        intent: 'smalltalk',
        confidence: Math.min(0.5, nn.confidence * 0.6),
        source: 'lexical',
        topScores: [
          { intent: 'smalltalk', score: nn.confidence * 0.6 },
          { intent: nn.label as IntentLabel, score: 0.2 },
        ],
      }
    }
    // Les intentions à ARTEFACT (image, scène, code, page, vidéo, recherche)
    // sans AUCUN appui lexical demandent une confiance neurone élevée — en
    // dessous, on génèrerait un objet aléatoire pour une simple question
    // (réel : « quel est le capital du japon » → image 61 % !).
    const ARTIFACT: IntentLabel[] = ['search', 'code', 'image', 'scene3d', 'webpage', 'video']
    if (ARTIFACT.includes(nn.label as IntentLabel) && lexScore === 0 && nn.confidence < 0.65) {
      return {
        intent: 'smalltalk',
        confidence: Math.min(0.5, nn.confidence * 0.6),
        source: 'lexical',
        topScores: [
          { intent: 'smalltalk', score: nn.confidence * 0.6 },
          { intent: nn.label as IntentLabel, score: nn.confidence },
        ],
      }
    }
    return {
      intent: nn.label as IntentLabel,
      confidence: Math.min(0.99, nn.confidence + lexScore * 0.03),
      source: lexScore > 0 ? 'mixed' : 'neural',
      topScores: [...nn.dist.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3)
        .map(([intent, score]) => ({ intent: intent as IntentLabel, score })),
    }
  }

  // Dernier recours : lexical faible ou radicaux partagés
  if (lexBestScore > 0) {
    return {
      intent: lexBest,
      confidence: 0.3 + lexBestScore * 0.04,
      source: 'lexical',
      topScores: lexSorted.slice(0, 3).map(([intent, score]) => ({ intent, score: Math.min(1, score / 10) })),
    }
  }
  return {
    intent: 'smalltalk',
    confidence: nn.confidence,
    source: 'neural',
    topScores: [...nn.dist.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([intent, score]) => ({ intent: intent as IntentLabel, score })),
  }
}

/** Extrait le "sujet utile" d'un message (pour recherches, génération…). */
export function extractTopic(rawText: string): string {
  const base = normalize(rawText) // accents retirés → les motifs verbaux matchent
  let t = base
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(
      /\b(salut|bonjour|hello|coucou|hey|merci|stp|svp|s'il te plait|sil vous plait|nexus)\b/gi,
      ' '
    )
    .replace(
      /\b(peux.?tu|pourrais.?tu|veux|voudrais|j aimerais|j aimerai|je veux|il faut|faut)\b/gi,
      ' '
    )
    .replace(
      /\b(cherche(r)?|recherche(r)?|trouve(r)?|genere(r)?|genere.?moi|cree(r)?|cree.?moi|dessine(r)?|fais(.-moi)?|fabrique|construis|modelise|ecris|developpe|donne.?moi|montre.?moi|explique.?moi|raconte|calcule|decrit|decrire|produis)\b/gi,
      ' '
    )
    .replace(
      /\b(une?|des|le|la|les|mon|ma|mes|ton|ta|tes|son|sa|ses|du|de|d'|pour|avec|sur|dans|s'il|plait)\b/gi,
      ' '
    )
    .replace(/\s+/g, ' ')
    .trim()
  if (t.length < 2) t = base.replace(/^(genere|cree|fais|dessine|cherche|trouve|ecris|developpe)\s*/i, '').trim()
  return t.slice(0, 140) || 'sujet inconnu'
}

/** Radicaux partagés entre le message et un texte de référence (0→1). */
export function overlap(text: string, reference: string): number {
  const a = new Set(contentTokens(text).map(stem))
  const b = new Set(contentTokens(reference).map(stem))
  if (a.size === 0 || b.size === 0) return 0
  let inter = 0
  for (const x of a) if (b.has(x)) inter++
  return inter / Math.min(a.size, b.size)
}

export { hashString }
