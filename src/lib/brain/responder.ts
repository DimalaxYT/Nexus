// ─── NEXUS Brain — Moteur de réponses (personnalité + synthèse) ──────────────
// Gabarits français variés, remplissage de slots, intégration mémoire et
// connaissances. Chaque variante est choisie par graine déterministe.

import { hashString, mulberry32, pick, capitalize } from './text'
import { NEXUS_PRESENTATION } from './knowledge-bank'
import { summarizeResults, type SearchResult } from './search'

function variant<T>(key: string, options: readonly T[]): T {
  const rng = mulberry32(hashString(key))
  return pick(rng, options)
}

// ── Conversation simple ───────────────────────────────────────────────────────

export function greeting(name?: string): string {
  const base: string[] = [
    `Salut ! 👋 Ravi de te voir. Qu'est-ce qu'on construit aujourd'hui ?`,
    `Bonjour ! Prêt à travailler (ou à créer quelque chose d'amusant) ?`,
    `Hey ! Je suis opérationnel — cerveau local chargé, réseau de neurones chaud. Que puis-je faire ?`,
    `Coucou ! Des idées de scripts, des missions, une recherche… je suis là.`,
  ]
  return variant(`greet${name ?? ''}`, base)
}

export function farewell(): string {
  return variant('bye', [
    `À plus tard ! Je garde tout en mémoire — tes missions, tes notes, tes préférences. Bon courage 💪`,
    `Salut ! Reviens quand tu veux, je serai ici (je tourne en local, je ne pars nulle part 😄).`,
    `Bonne continuation ! N'oublie pas de sauvegarder ton travail… ou demande-le-moi.`,
  ])
}

export function thanks(): string {
  return variant('thx', [
    `Avec plaisir ! Et rappelle-toi : tout ça tourne à 100 % chez toi, sans aucune API. 😉`,
    `De rien ! Si tu as un autre script, une mission ou une question, je suis prêt.`,
    `Merci à toi ! C'est toujours un plaisir d'aider un créateur.`,
    `Pas de quoi 💪 Tu veux qu'on passe à autre chose ?`,
  ])
}

export function howAreYou(): string {
  return variant('how', [
    `Je vais très bien, merci ! Mes compétences locales sont affûtées et mon moteur de raisonnement est prêt. Et toi, comment ça va ?`,
    `Toujours opérationnel ! Missions en cours, base de connaissances chargée, outils affûtés. Et de ton côté ?`,
    `Ça va super ! Prêt à travailler, chercher, créer — ou à recevoir une mission si tu dois t'absenter 😄 Raconte, qu'est-ce qui t'amène ?`,
  ])
}

export function identity(): string {
  return `${NEXUS_PRESENTATION}

**Et je ne suis plus seul :** tu peux créer ta propre équipe d'agents (bouton **Équipe**), donner à chacun un **nom, un rôle et un prompt personnel**, les regrouper en **équipes**, puis choisir dans le chat avec qui parler — moi seul, un agent, un groupe, ou **toute l'équipe en table ronde** suivie de ma synthèse.`
}

export function capabilities(): string {
  return `**Voici tout ce que je sais faire :**

🔎 **Recherche & lecture web**
- Chercher des informations sur le web (moteur multi-sources en parallèle) et **synthétiser les pages** lues
- Lire une page (URL), te la résumer, avec **capture d'écran réelle** dans le panneau Navigateur
- Regarder **YouTube** : « regarde la dernière vidéo de X » → je trouve la chaîne, la vraie dernière vidéo, ses vues et sa durée

📧 **Bots connectés à tes comptes** (panneau **Connexions**)
- **Gmail** : « lis ma boîte mail » → tes agents lisent tes derniers mails (IMAP réel)
- **GitHub** : « mes repos GitHub », « mes notifications » → activité réelle de ton compte
- **TikTok** : « mon TikTok » → profil et dernières vidéos
- Une fois le compte relié, **chaque agent de ton équipe** peut s'en servir

🤖 **Missions autonomes** (mon point fort quand tu t'absentes)
- Bouton **Task** : donne un nom, une durée, des objectifs → je travaille **en arrière-plan**
- Je cherche sur **Google, YouTube, TikTok** et les **sources IA**, j'extrais des **compétences** et je les range dans ma base — **je m'améliore à chaque mission**

✍️ **Code (mon autre point fort)**
- Scripts **Roblox/Luau**, Python, JavaScript, C#, et bien plus — le code s'ouvre dans le **Studio Code**
- Tes agents peuvent **lire ton code** et te proposer des versions améliorées (**diff** à valider, jamais d'écriture sans toi)

🎨 **Création visuelle**
- Images **procédurales** (Studio Image), **scènes 3D animées** (Studio 3D), **pages web** interactives, et **vraies vidéos MP4** (Studio Vidéo) — tout est rendu en local

🧠 **Intelligence & mémoire**
- Moteur de raisonnement LLM + compétences locales en repli instantané, **mémoire longue terme** et **base de connaissances** persistantes
- **Salle des Cerveaux 3D** : un cerveau central façon Jarvis relié à chaque agent — tu vois qui travaille en direct

👥 **Équipe multi-agents** (ta création)
- Recrute tes agents : **nom, emoji, rôle, prompt personnel**, regroupe-les en **équipes**, désigne un **rédacteur du Bureau**
- Sélecteur au-dessus de la saisie : **NEXUS** · un **agent** en privé · **table ronde** · **Bureau** (délibération transparente + UNE réponse consolidée)

Essaie par exemple : *« quels sont tes mises à jour ? »*, *« lis ma boîte mail »*, *« regarde la dernière vidéo de fugu »*, *« génère une vidéo de ville la nuit »*, ou **recrute un agent** et parle-lui !`
}

// ── Recherche web ─────────────────────────────────────────────────────────────

/**
 * Recherche web (basique — titres + extraits).
 */
export function searchAnswer(query: string, results: SearchResult[], usedFallback: boolean, fallbackText?: string): string {
  if (usedFallback || results.length === 0) {
    return `**Recherche « ${query} »** — le réseau n'est pas accessible depuis le serveur pour le moment (recherche web bloquée ou hors-ligne). Mais mon cerveau local a ça en stock :\n\n${fallbackText ?? knowledgeFallback(query)}\n\n💡 *Astuce : réessaie dans un instant, ou précise ta demande pour que je réponde avec mes connaissances intégrées.*`
  }
  return summarizeResults(query, results)
}

/** Réponse de recherche approfondie : sources + synthèse extraite des pages réellement lues. */
export function searchAnswerDeep(query: string, results: SearchResult[], synthesis: string): string {
  if (!synthesis.trim()) return searchAnswer(query, results, false)
  const domains = [...new Set(results.slice(0, 6).map((r) => r.domain))]
  return `Voici ce que j'ai trouvé sur **« ${query} »** en consultant ${results.length} source(s)${domains.length > 0 ? ` (${domains.slice(0, 3).join(', ')}${domains.length > 3 ? '…' : ''})` : ''} :\n\n${synthesis}\n\n*Ce résumé est extrait des pages réellement lues — le détail des sources est dans le bloc « Sources » ci-dessous. Tu veux que je creuse un point précis ?*`
}

function knowledgeFallback(_query: string): string {
  return `Voici ce que je peux dire avec mes connaissances intégrées — pour une réponse à jour, réessaie la recherche quand le réseau sera disponible. Tu peux aussi préciser ta question, je creuserai avec toi !`
}

// ── Maths ─────────────────────────────────────────────────────────────────────

export function mathAnswer(expression: string, result: string, detail?: string): string {
  return variant(`math${expression}`, [
    `**${expression} = ${result}**${detail ? `\n\n*Détail : ${detail}*` : ''}`,
    `Le résultat est **${result}** pour \`${expression}\`${detail ? ` (${detail})` : ''}`,
    `✅ **${expression} → ${result}**${detail ? `\n\nCalcul : ${detail}` : ''}`,
  ])
}

// ── Code ─────────────────────────────────────────────────────────────────────

export function codeAnswer(filename: string, description: string, language: string): string {
  const cap = description.charAt(0).toUpperCase() + description.slice(1)
  return variant(`code${filename}`, [
    `Le script **${filename}** est prêt et ouvert dans le **Studio Code** ✅\n\n${cap}.\n\nTu peux l'éditer, le télécharger, ou me demander une variante (plus de réglages, des commentaires, une autre fonctionnalité).`,
    `C'est fait ✍️ — **${filename}** (${language}) t'attend dans l'éditeur : ${description}.\n\nDis-moi si tu veux que j'ajuste quelque chose : valeurs, cooldowns, couleurs, fonctionnalités bonus…`,
    `Script **${filename}** généré ✅ ${description}.\n\nOuvre le Studio Code pour le voir ; demande-moi toute modification ou un second script qui s'y connecte.`,
  ])
}

// ── Image / scène / page web ──────────────────────────────────────────────────

export function imageAnswer(styleDescription: string): string {
  return variant(`img${styleDescription}`, [
    `Voici ton image 🎨 — ${styleDescription}. Mon moteur d'art local y ajoute rayons de lumière, bokeh, vignettage et grain de film pour un rendu cinématographique ; même prompt = même rendu, zéro API.\n\nTu peux la télécharger, la **retoucher** dans le Studio Image, ou demander une **variante** (autre composition) : « une autre version », « version néon », « version neige », « un logo »…`,
    `Image prête ! ${styleDescription}, composée algorithmiquement puis post-traitée (lumière, étalonnage, grain) par mon art génératif local.\n\nEnvie d'une autre ambiance ? Dis « variante », « version désert », « style kawaii », un logo… Les mots de couleur comptent : « version bleue », « tout en or » !`,
  ])
}

export function sceneAnswer(sceneName: string, objectCount: number): string {
  return variant(`scene${sceneName}`, [
    `Scène **« ${sceneName} »** construite : **${objectCount} objets** placés, lumières et sol configurés. Elle est chargée dans le **Studio 3D** 🧊\n\nDans le studio tu peux déplacer/étirer les objets, appliquer des matériaux PBR, animer par clés, exporter en GLB/OBJ…`,
    `C'est construit ! « ${sceneName} » (${objectCount} objets) t'attend dans le Studio 3D.\n\nTu veux des ajustements ? Dis-moi par exemple « ajoute des arbres », « passe en néon nocturne »…`,
  ])
}

export function webpageAnswer(description: string): string {
  return variant(`web${description}`, [
    `Page générée ✅ ${description}. Elle est **interactive et responsive**, prête dans le **Studio Code** (aperçu live + console).\n\nDis-moi si tu veux changer les couleurs, ajouter une section, un formulaire…`,
    `Ta page est prête dans le Studio Code 🌐 — ${description}.\n\nTout est en HTML/CSS/JS pur, éditable librement. Je peux aussi en générer une version différente si tu veux comparer.`,
  ])
}

/** Réponse après génération d'une vraie vidéo MP4 (moteur procédural local). */
export function videoAnswer(theme: string, description: string, url: string): string {
  return variant(`vid${description}`, [
    `🎬 **Vidéo MP4 générée !** ${description}.\n\nLe moteur vidéo local a filmé la scène : parallaxe, eau animée, particules, travelling caméra, vignettage et grain — encodée par ffmpeg, **aucune API externe**. Elle est affichée ci-dessus et ouvrable dans le **Studio Vidéo** pour montage (coupe, filtres, vitesse, export).\n\nDis-moi « une autre variante », « 10 secondes », ou décris un autre décor à filmer !`,
    `C'est tourné ! 🎥 ${description} — rendu image par image en local puis encodé en **MP4 (H.264)**.\n\nTu peux la lire directement, la télécharger, ou me demander une autre ambiance (océan, ville, espace, aurore, pluie, neige…). Envie d'une version plus longue ? Dis « refais-la en 10 secondes ».`,
  ])
}

export function videoHonest(topic: string): string {
  return `Le rendu vidéo a échoué cette fois (moteur local saturé ou ffmpeg indisponible) — réessaie dans quelques instants. 😅

**En attendant, mes autres moteurs créatifs locaux :**
1. **Scène 3D animée** — je construis un décor dans le Studio 3D et tu y animes les objets image par image (timeline intégrée, export GLB)
2. **Image procédurale** — ton sujet « ${topic} » en art génératif, immédiat
3. **Studio Vidéo** — importe des clips et fais le montage (filtres, vitesse, trim) tout en local

Quelle option tu veux essayer ?`
}

// ── Missions ─────────────────────────────────────────────────────────────────

export function taskNotFound(name?: string): string {
  return `Je n'ai pas trouvé de mission correspondante${name ? ` à « ${name} »` : ''}. 🤔

Ouvre le bouton **Task** dans la barre du chat pour en créer une (nom, durée, objectifs, description) — ensuite je pourrai suivre son avancement, ajouter des notes et clôturer les étapes avec toi.`
}

export function taskUpdated(name: string, statusLabel: string, note?: string): string {
  return `Mission **« ${name} »** mise à jour : statut **${statusLabel}**${note ? ` — « ${note} »` : ''}. ✅

Tu la retrouves dans le panneau **Task** avec son journal d'avancement. Donne-moi de nouveaux points d'étape quand tu veux !`
}

// ── Connaissances ────────────────────────────────────────────────────────────

export function knowledgeSaved(title: string, category: string): string {
  return variant(`ksave${title}`, [
    `Noté dans ta base de connaissances 🧠 — **« ${title} »** rangé dans *${category}*. Je le retrouverai dès que tu me demanderas « que sais-tu sur… ».`,
    `C'est enregistré ✅ « ${title} » → *${category}*. Ta base de connaissances persiste entre les conversations.`,
  ])
}

export function knowledgeNotFound(query: string): string {
  return `Je n'ai rien trouvé dans ta base de connaissances pour « ${query} ».

Deux options :
1. **Enregistre** : dis-moi « retiens que … » et j'archiverai l'info durablement
2. **Réponds avec mon savoir intégré** : reformule ta question, mon cerveau local connaît pas mal de sujets (Roblox, programmation, science…)`
}

// ── Comptes connectés (mail / GitHub / TikTok) ───────────────────────────────

const frDate = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })

export function notConnected(provider: 'Gmail' | 'GitHub' | 'TikTok'): string {
  return `Je n'ai pas accès à ton compte **${provider}** pour le moment — relie-le d'abord dans le panneau **Connexions** 🔗

${provider === 'Gmail' ? "Une fois l'adresse + le **mot de passe d'application** enregistrés, je lirai tes derniers mails en direct (IMAP) — et chaque agent de ton équipe pourra le faire aussi." : provider === 'GitHub' ? "Une fois ton **Personal Access Token** enregistré, je suivrai tes repos, tes notifications et ton activité réelle." : 'Une fois ton **@pseudo** enregistré, je suivrai ton profil public et tes dernières vidéos.'}

Tout est stocké **localement** — le secret ne quitte jamais ce serveur.`
}

export function emailAnswer(emails: { from: string; subject: string; date: string; seen: boolean; snippet: string }[]): string {
  if (emails.length === 0) return `Ta boîte de réception est **vide** (aucun mail trouvé en IMAP). 📭\n\nJe vérifierai de nouveau quand tu veux — dis simplement « lis ma boîte mail ».`
  const listed = emails
    .slice(0, 6)
    .map((e) => {
      const d = frDate.format(new Date(e.date))
      const badge = e.seen ? '' : ' 🔵'
      const extrait = e.snippet ? `\n   > ${e.snippet.slice(0, 150)}` : ''
      return `**${e.subject}**${badge}\n   ${e.from} · ${d}${extrait}`
    })
    .join('\n\n')
  return `Voici tes **${emails.length} derniers mails** lus en direct sur ta boîte (IMAP) 📧 :\n\n${listed}\n\nLes non-lus portent le point bleu 🔵 — dis-moi si tu veux que je détaille l'un d'eux, ou que je surveille un expéditeur précis.`
}

export function githubAnswer(data: { login: string; publicRepos: number; followers: number; repos: { fullName: string; language: string; stars: number; pushedAt: string; private: boolean; description: string }[]; notifications: { repo: string; title: string; reason: string; unread: boolean }[] }): string {
  const parts: string[] = [`Compte **${data.login}** connecté 🐙 — ${data.publicRepos} repos publics · ${data.followers} abonnés.`]
  if (data.repos.length > 0) {
    parts.push(
      `**Repos actifs (dernier push) :**\n${data.repos
        .slice(0, 6)
        .map((r) => `- **${r.fullName}**${r.private ? ' 🔒' : ''}${r.language ? ` · ${r.language}` : ''} · ⭐ ${r.stars}${r.pushedAt ? ` · push ${frDate.format(new Date(r.pushedAt))}` : ''}${r.description ? `\n  ${r.description.slice(0, 120)}` : ''}`)
        .join('\n')}`
    )
  }
  if (data.notifications.length > 0) {
    parts.push(`**Notifications en attente (${data.notifications.length}) :**\n${data.notifications.slice(0, 5).map((n) => `- ${n.repo} : « ${n.title} » (${n.reason}${n.unread ? ', non lue' : ''})`).join('\n')}`)
  } else {
    parts.push('**Notifications :** aucune en attente ✅')
  }
  return `${parts.join('\n\n')}\n\nDonnées **réelles** de l'API GitHub — je peux surveiller un repo précis, résumer une notification ou suivre ton activité dans une mission.`
}

export function tiktokAnswer(data: { handle: string; nickname: string; followers: number; likes: number; videoCount: number; videos: { desc: string; url: string; plays: number; likes: number }[]; note?: string }): string {
  const head = `Profil **@${data.handle}**${data.nickname ? ` (${data.nickname})` : ''} 🎵 — ${data.followers} abonnés · ${data.likes} j'aime · ${data.videoCount} vidéos.`
  if (data.videos.length > 0) {
    const listed = data.videos
      .slice(0, 6)
      .map((v, i) => `${i + 1}. **${v.desc || '(sans description)'}** · ${v.plays} vues · ${v.likes} j'aime`)
      .join('\n')
    return `${head}\n\n**Tes dernières vidéos :**\n${listed}\n\n${data.note ? `*${data.note}*\n\n` : ''}Je peux suivre l'évolution des vues dans une **mission** si tu veux un rapport régulier.`
  }
  return `${head}\n\n${data.note ? `*${data.note}*` : "Je n'ai pas pu extraire le détail des vidéos (TikTok limite parfois la lecture automatique) — réessaie dans un instant."}`
}

// ── Heure / date ─────────────────────────────────────────────────────────────
export function timeAnswer(date: Date): string {
  const heure = date.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })
  const jour = capitalize(date.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }))
  return variant(`time${heure}`, [
    `Il est **${heure}** — nous sommes ${jour}. 🕒`,
    `🕒 **${heure}**, ${jour}. Calculé localement, sans serveur !`,
  ])
}

// ── À propos de l'utilisateur ────────────────────────────────────────────────

export function aboutUser(memories: string[]): string {
  if (memories.length === 0) {
    return `Je ne sais pas encore grand-chose sur toi — ma mémoire est vide pour le moment. 📝

Dis-moi simplement des choses comme *« je m'appelle … »*, *« j'habite à … »*, *« mon jeu s'appelle … »*, *« j'aime … »* — et je les retiendrai **durablement** (mémoire locale, conservée entre les conversations).`
  }
  const listed = memories.slice(0, 8).map((m) => `- ${m}`).join('\n')
  return `Voici ce que ma mémoire locale a retenu sur toi : 🧠\n\n${listed}\n\nTout est conservé dans ta base (SQLite locale) — tu peux demander de l'oublier via le panneau **Mémoire**, ou me donner de nouvelles infos à tout moment.`
}

/** Après une présentation spontanée (« je m'appelle … ») : accueil + confirmation. */
export function memorySavedIntro(memories: string[], fresh: { content: string }[]): string {
  const nameMatch = fresh.find((m) => /s'appelle/i.test(m.content))?.content.match(/s'appelle\s+([\p{L}-]+)/iu)
  const prenom = nameMatch?.[1]
  const listed = fresh.map((m) => `- ${m.content}`).join('\n')
  const reste = memories.filter((m) => !fresh.some((f) => f.content === m)).slice(0, 4)
  const restePart = reste.length > 0 ? `\n\n*(Et toujours en mémoire : ${reste.slice(0, 3).map((m) => `« ${m} »`).join(', ')}…)*` : ''
  return `Enchanté${prenom ? `, **${prenom}**` : ''} ! 🎉 J'ai enregistré ça dans ma **mémoire locale** (persistante entre les conversations) :\n\n${listed}${restePart}

Tu peux vérifier quand tu veux avec *« comment je m'appelle ? »* — tout est stocké dans ta base locale, jamais envoyé nulle part. Alors, on construit quoi ${prenom ?? 'ensemble'} ?`
}

// ── Smalltalk / savoir général ───────────────────────────────────────────────

export function generalAnswer(topic: string, bankAnswer?: string, memoryHits?: string[]): string {
  if (bankAnswer) return bankAnswer
  const memoryPart = memoryHits && memoryHits.length > 0 ? `\n\n**En rapport avec ta mémoire personnelle :**\n${memoryHits.slice(0, 3).map((m) => `- ${m}`).join('\n')}` : ''
  return `Ma spécialité, c'est l'**action locale** — je réfléchis avec un réseau de neurones embarqué, pas avec un modèle géant hébergé. Sur « ${topic} », voici ce que je te propose :${memoryPart}

1. **Je creuse avec mes connaissances intégrées** — reformule avec un mot-clé précis (Roblox, Python, git, la gravité, l'IA…)
2. **Je cherche sur le web** — dis « cherche ${topic} » et mon moteur autonome consulte les sources en direct
3. **Je passe à l'action** — un script, une image, une scène 3D, une page web, une mission…
4. **Je consulte mon équipe** — tes agents peuvent donner leur avis sur « ${topic} » (sélecteur au-dessus de la saisie → *Tous les agents*)

Que choisis-tu ? 😊`
}

// ── Erreur générique ─────────────────────────────────────────────────────────

export function apology(context: string): string {
  return variant(`err${context}`, [
    `Oups, un imprévu technique (${context}). Réessaie — mon cerveau local est stable, mais un outil a pu accrocher. 🛠️`,
    `Petit raté local (${context}) — rien de grave, redemande-le-moi ! Contrairement aux erreurs 429 d'avant, ici tout tourne chez toi.`,
  ])
}
