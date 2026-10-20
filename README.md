# NEXUS — Système d'agents IA 100 % local

Application web Next.js dont le but est **une chose : parler avec une IA**. Autour de la discussion,
le strict utile : agents IA autonomes, comptes utilisateurs, base de connaissances et mémoire,
connexions de comptes (Gmail, GitHub, TikTok), génération d'images/vidéos/3D — le reste de la
navigation est regroupé dans un bloc repliable « Ateliers & outils ».

> **Aucune dépendance à un service d'IA externe.** NEXUS n'appelle ni OpenAI, ni Ollama, ni aucun
> « géant », et ne demande **aucune clé d'API** : le cerveau (`src/lib/brain`) et le modèle de langue
> (`src/lib/llm`) sont entièrement codés à la main — transformer, cache clé/valeur, tokenizer,
> échantillonnage, entraînement et poids inclus. Le build et l'exécution fonctionnent **hors ligne**.

## Installation

Prérequis : **Node.js 20+** (Node 22 recommandé pour `node:sqlite`) ou Bun.

```bash
# 1. Installer les dépendances
npm install        # ou: bun install

# 2. Configurer la base de données
npx prisma generate
npx prisma db push      # ou laisser l'app créer ses tables au premier lancement

# 3. Lancer en développement
npm run dev
# → http://localhost:3000

# Ou lancer en production
npm run build
npm start
```

Au premier lancement, l'application vous propose de **créer le compte propriétaire**.
Ce premier compte récupère automatiquement les données déjà présentes (agents, conversations,
connaissances, mémoire) : rien n'est perdu.

## Déploiement sur Render

Le plus simple : **New + → Blueprint** sur Render, il lit `render.yaml` à la racine et configure tout.

En manuel, un Web Service Node a besoin de :

| Réglage | Valeur |
|---|---|
| Runtime | **Node** |
| Build Command | `npm ci && npm run build` |
| Start Command | `npm start` |
| Health Check Path | `/api/health` |
| Plan | Free possible au runtime (le cerveau est léger), **mais** le build Next.js monte à ~860 Mo de RAM : si le build échoue en OOM (exit 137), passer sur Starter |

Variables d'environnement :

| Variable | Valeur | Rôle |
|---|---|---|
| `NODE_VERSION` | `22.22.0` | **Obligatoire** : la base repose sur `node:sqlite` (Node ≥ 22.5) |
| `DATABASE_URL` | `file:/var/data/custom.db` | Fichier SQLite, à placer sur un **Disk Render** monté sur `/var/data` (sinon les données sont réinitialisées à chaque déploiement) |
| `NEXUS_SECRET_KEY` | une longue phrase secrète | Clé maîtresse du chiffrement AES-256-GCM des secrets (connexions Gmail/GitHub…) |
| `NEXUS_DEV_PASSWORD` | votre mot de passe | Mot de passe du compte Dev (par défaut `dev2026`) — à définir AVANT le premier démarrage |
| `SMTP_HOST` | `smtp.gmail.com` | **Recommandé** : serveur SMTP pour les codes de connexion (2FA) et la réinitialisation de mot de passe |
| `SMTP_PORT` | `465` | Port SMTP (465 = TLS, 587 = STARTTLS) |
| `SMTP_USER` | votre adresse d'envoi | Compte d'envoi (utilisez un **mot de passe d'application** Gmail) |
| `SMTP_PASS` | le mot de passe d'application | Mot de passe du compte d'envoi |
| `MAIL_FROM` | `NEXUS <vous@domaine.fr>` | Expéditeur affiché |

### 🛡️ Le Gardien (bot interne, anti-sommeil Render)

Au démarrage en production, NEXUS arme **le Gardien** : un bot interne qui
**ping `/api/health` toutes les 10 minutes** — sur le plan gratuit Render, un
service sans trafic s'endort après 15 min, le ping le maintient éveillé (Render
l'autorise). Il profite de chaque passage pour purger les sessions expirées et
les vieux codes de la base. L'URL pingée est déduite de `RENDER_EXTERNAL_URL`
(fourni automatiquement par Render) ou de `KEEP_ALIVE_URL`.

### 🔑 Connexion & mot de passe oublié

La connexion est **en une seule étape** (e-mail + mot de passe). Le lien
« Mot de passe oublié ? » envoie un code à 6 chiffres par e-mail (valable
10 minutes) puis permet de choisir un nouveau mot de passe : sans SMTP configuré,
le code est affiché dans un encart (mode développement) et journalisé côté
serveur — configurez SMTP pour l'envoi réel.

> **Important** : NEXUS utilise **uniquement une base SQLite locale** (fichier).
> Les variables `TURSO_DATABASE_URL` / `TURSO_AUTH_TOKEN` ne servent à rien — le code ne lit jamais
> Turso. Et le cerveau IA étant 100 % local, **aucune clé d'API IA** n'est nécessaire.

## Nouveautés de la v2.1

### 🔐 Comptes : connexion & création

- Création de compte et connexion par e-mail + mot de passe.
- Mot de passe haché en local avec **scrypt** (sel unique par compte) — jamais stocké en clair.
- Sessions en base (jeton aléatoire de 32 octets) conservées dans un **cookie httpOnly**, expirant au
  bout de 30 jours.
- Dès qu'un compte existe, **toutes les routes de données exigent une session** (401 sinon).
- En l'absence de compte, l'instance reste utilisable comme avant (mode mono-utilisateur historique).

### 👤 Historique & personnalisation par compte

Chaque compte possède ses propres données, sans aucun mélange :

- **Historique de chat** — conversations, messages et pièces jointes cloisonnés par compte ; à la
  connexion, l'application vide l'affichage et recharge l'historique du compte depuis le serveur.
- **Mémoire**, **base de connaissances**, **missions**, **agents**, **groupes d'agents**, **connexions**,
  **blueprints** et **clés API** : chaque table est filtrée par propriétaire.
- **Personnalisation** (menu *Mon compte*) : prénom utilisé par NEXUS, nom donné à l'assistant, ton
  (chaleureux / neutre / professionnel / direct / pédagogue), métier, entreprise, langue, avatar,
  message d'accueil et **consignes permanentes** injectées dans le prompt système du cerveau.

### 🧩 Blueprints — construisez vous-même le schéma de vos agents

Un blueprint est un **schéma visuel** (canvas glisser-déposer) qui décrit exactement comment un agent
traite un message. Menu *Blueprints*, ou bouton ⚙️ « Schéma » sur une carte d'agent du panneau Équipe.

Types de nœuds disponibles :

| Nœud | Rôle |
|---|---|
| 🟢 **Départ** | Entrée du schéma (message du visiteur). |
| 🎯 **Règle** | « Quand tu lis X → réponds Y ». Sans lien de sortie, la réponse est renvoyée telle quelle. |
| 🔀 **Condition** | Teste le message ou une variable → deux sorties (Vrai / Faux). |
| 🧠 **Cerveau IA** | Fait réfléchir le cerveau **local** de NEXUS avec votre consigne. |
| 📚 **Connaissance** | Cherche dans la base de connaissances du compte. |
| 🛠️ **Outil** | Recherche web, lecture de page, calcul, mails (IMAP), GitHub, mémoire, date/heure. |
| 🏷️ **Variable** | Stocke une valeur réutilisable (`{{message}}`, `{{autre}}`). |
| 🔌 **Webhook** | Appelle une URL externe (votre CRM, votre base). |
| 💬 **Réponse** | Texte final envoyé (variables autorisées). |
| ⛔ **Fin** | Termine le parcours. |

Le **testeur intégré** exécute le schéma sur un message d'exemple et affiche le parcours étape par
étape (nœuds franchis, règle déclenchée, variables). Gardes-fous : 80 nœuds maximum, 4 visites par
nœud (anti-boucle) et délai global de 45 s.

### 🔑 Clés API — vendez des chatbots

Menu *Clés API*. Une clé = un chatbot prêt à brancher sur le site de votre client.

Chaque clé se configure entièrement :

- **Règles « quand tu lis X → réponds Y »** — ex. : déclencheur *« Pourquoi mon ordinateur ne
  fonctionne pas »* → réponse *« Cela doit probablement être dû à la carte mère. »* (réponse garantie
  à l'identique, sans passer par le cerveau). Modes : contient, exactement, commence par, finit par,
  approchant (tolère l'orthographe), expression régulière. Sensible à la casse en option.
- **Schéma (blueprint) lié** et/ou **agent lié** (avec sa personnalité).
- **Prompt système** du chatbot, **message d'accueil**, **réponse de repli**.
- **Origines autorisées** (CORS) et **limite d'appels par minute**.
- Option *« règles strictes »* : ne répondre **que** les règles, jamais le cerveau.
- Activation / désactivation en un clic, statistiques d'appels et **journal des derniers appels**.

Le secret (`nx_…`) n'est affiché **qu'une seule fois** à la création (seule son empreinte SHA-256 est
stockée). Un bouton **« Tester cette clé »** exécute exactement l'appel que fera votre client, et un
snippet d'intégration (curl + JavaScript) est fourni à copier-coller.

#### API publique v1

```bash
curl -X POST https://votre-serveur/api/v1/chat \
     -H "Authorization: Bearer nx_…" \
     -H "Content-Type: application/json" \
     -d '{"message":"Pourquoi mon ordinateur ne fonctionne pas"}'
```

Réponse :

```json
{
  "reply": "Cela doit probablement être dû à la carte mère.",
  "source": "rule",
  "matched": "Pourquoi mon ordinateur ne fonctionne pas",
  "model": "nexus-local",
  "ms": 7,
  "key": { "name": "Bot SAV — Dépann'PC", "prefix": "nx_d55b" }
}
```

- `POST` ou `GET` (`?key=…&message=…`), pré-vol `OPTIONS` géré (CORS).
- Ordre de traitement : **règles exactes → blueprint → agent/cerveau local → message de repli**.
- `source` indique d'où vient la réponse : `rule`, `blueprint`, `agent`, `brain`, `welcome` ou `fallback`.
- Codes : `401` clé absente/invalide · `403` clé désactivée ou origine refusée · `429` limite atteinte.
- L'historique d'une conversation peut être transmis dans `history` (tableau `{role, content}`).

## 🛠️ Compte Dev & agent Dev

En plus des comptes classiques, NEXUS crée automatiquement un **compte développeur** juste après la
création du premier compte (le propriétaire). Il ouvre un espace technique **invisible depuis les
comptes standards**.

```
identifiant  : dev
mot de passe : dev2026          ← à changer depuis le menu « Mon compte »
```

> Le mot de passe initial se surcharge avec la variable d'environnement `NEXUS_DEV_PASSWORD`.
> Il est affiché **une seule fois** dans la console du serveur, lors de la création du compte.

L'espace développeur (**Espace Dev**, dans la barre latérale) réunit sept onglets :

| Onglet | Ce qu'il fait |
|---|---|
| **Vue d'ensemble** | Compteurs de la base, poids du code par dossier, fichiers les plus lourds, charge système, et les **sujets mal couverts** détectés dans le journal d'appels |
| **Site** | Personnalisation du site depuis le web : nom, slogan, emoji du logo, deux couleurs d'accent, textes de connexion et d'accueil, pied de page, visibilité des tuiles de l'accueil, **CSS libre** — avec aperçu en direct |
| **Agent Dev** | Discuter avec l'agent qui lit le code |
| **Code** | Explorateur de fichiers + recherche dans tout le projet (avec numéros de ligne) |
| **Correctifs** | Les propositions de l'agent Dev, à relire et à appliquer d'un clic |
| **Améliorations** | File de tâches alimentée par l'agent Dev et par vous |
| **Journal** | Derniers appels d'API, état des clés, sessions actives révocables |

### L'agent Dev

C'est le **seul agent qui a accès au code**, et **uniquement depuis le compte Dev** : il n'apparaît
dans l'équipe d'aucun autre compte, et il est marqué « système » (non supprimable).

Son moteur (`src/lib/devbrain.ts`) est 100 % local : il connaît la carte d'architecture du projet,
lit les vrais fichiers sur le disque, et répond avec des faits vérifiables (fichier + numéro de
ligne). Il sait :

- **Auditer** — « fais un audit du projet » : taille, répartition, dette technique, TODO réels
  (uniquement ceux en commentaire), état de la base.
- **Améliorer l'intelligence** — « comment rendre NEXUS plus intelligent ? » : les quatre leviers
  classés par rentabilité, avec l'état réel de la banque de connaissances.
- **Apprendre un fait** — « apprends à NEXUS que le support répond sous 24 h » : il fabrique
  l'entrée de connaissance **et le correctif prêt à appliquer** sur
  `src/lib/brain/knowledge-bank.ts`. Une fois appliqué, NEXUS répond avec ce savoir — hors-ligne.
- **Chercher / expliquer** — « où est gérée l'authentification ? », « explique-moi les blueprints ».
- **Diagnostiquer** — classement des fichiers suspects par densité de correspondances.
- **Optimiser** — fichiers les plus lourds, fonctions démesurées, `any`, `console.log`, `catch` vides.

Il fonctionne aussi bien dans l'onglet **Agent Dev** que dans le chat normal (sélectionnez l'agent
**🛠️ Dev**), et en passant par `POST /api/dev/agent`.

### Correctifs : rien n'est écrit sans validation

L'agent ne modifie jamais un fichier de lui-même. Chaque proposition :

1. est enregistrée avec son **ancre exacte** (un extrait réel du fichier, assez long pour être unique),
2. s'affiche en **diff avant/après** dans l'onglet Correctifs,
3. ne s'écrit qu'après votre clic sur **Appliquer** — avec une **sauvegarde horodatée** du fichier
   dans `.arena/dev-backups/` avant l'écriture.

Si le code a changé entre la proposition et l'application, l'ancre n'est plus trouvée et
l'application est **refusée** plutôt que d'écrire au mauvais endroit.

### Sécurité de l'espace Dev

- `devGuard()` : seules les requêtes du compte `dev` passent (401 anonyme, 403 pour tout autre
  compte connecté — propriétaire compris).
- Accès fichiers confiné à la racine du projet : `../` refusé, et liste noire sur `.git`,
  `node_modules`, `.env*`, `*.db`, les clés et les certificats.
- CSS personnalisé assaini (pas de `</style`, pas de `<script`, pas d'`@import` distant).
- L'identifiant `dev` est réservé : impossible à créer en inscription publique.

## Base de données

- Schéma : `prisma/schema.prisma` (référence) — l'accès se fait via la couche légère `src/lib/db.ts`
  (SQLite, migrations automatiques : les colonnes `userId` sont ajoutées sans casse).
- La base SQLite `db/custom.db` est incluse (données existantes : connaissances, agents, connexions…).
- Pour repartir de zéro : supprimez `db/custom.db` puis relancez l'application.

Modèles ajoutés en v2.1 : `User`, `Session`, `Blueprint`, `ApiKey`, `ApiKeyLog`, plus une colonne
`userId` sur `Conversation`, `Knowledge`, `Memory`, `Task`, `AgentProfile`, `AgentGroup`,
`AccountConnection` et un champ `blueprintId` sur `AgentProfile`.

Modèles de l'espace Dev : `SiteSetting` (réglages du site), `DevPatch` (correctifs proposés),
`DevTask` (file d'améliorations), plus les colonnes `role` sur `User` (`owner` / `dev` / `client`)
et `systemKey` sur `AgentProfile` (`'dev'` pour l'agent système).

## Structure

```
src/
  app/api/         → Routes API (auth, blueprints, clés, v1 publique, outils…)
  components/      → Composants UI (Bureau, Jarvis Brain, IDE, Hub, Blueprints, Clés API…)
  lib/             → Cerveau IA local, orchestrateur multi-agents, auth, blueprints, connecteurs
                     + espace Dev : devbrain.ts (agent), devfs.ts (accès code), site-settings.ts
  lib/brain/       → Le cerveau : classifieur, neurones, moteurs (maths, code, image, 3D, vidéo…)
  lib/llm/         → Le modèle de langue : transformer, cache KV, tokenizer, entraînement, retrieval
  hooks/           → Hooks React
prisma/            → Schéma de base de données
db/                → Base SQLite
public/            → Assets statiques
scripts/           → Scripts utilitaires
```

## Modules principaux

- **Discussion avec NEXUS** — le cœur du site : modèle de langue local + retrieval + garde-fous
- **Cerveau IA local** — raisonnement, mémoire, base de connaissances (aucun appel externe)
- **Comptes** — connexion, historique et personnalisation par utilisateur
- **Espace Dev** — dashboard, personnalisation du site depuis le web, agent Dev qui lit et améliore
  le code (`src/lib/devbrain.ts`, `src/lib/devfs.ts`, `src/lib/dev-seed.ts`)
- **Blueprints** — schémas d'agents construits visuellement
- **Clés API** — chatbots configurables et revendables (API publique v1)
- **Bureau** — délibérations multi-agents
- **Cerveau Jarvis 3D** — visualisation animée connectant les agents
- **Studios** — 3D, images, vidéo, code (20 langages)

## Le modèle de langue : un transformer écrit à la main

`src/lib/llm` est un modèle de langue complet, sans aucune bibliothèque d'IA :

| Élément | Fichier | Ce que c'est |
|---|---|---|
| Transformer | `model.ts` | attention multi-têtes, LayerNorm, MLP GELU, tête de sortie liée à l'embedding |
| Cache clé/valeur | `kv.ts` | `prefill` + `stepToken` : le prompt n'est recalculé qu'une fois |
| Tokenizer | `tokenize.ts`, `bpe.ts` | caractère (utilisé) ou BPE byte-level, commutable via `config.tokenizer` |
| Échantillonnage | `generate.ts` | température, top-k, pénalité de répétition, arrêt de ligne, graine déterministe |
| Entraînement | `train.ts`, `scripts/train-chat.ts` | Adam écrit à la main, rétropropagation, warmup + décroissance cosine, points de contrôle |
| Retrieval | `grounding.ts`, `dialogue.ts` | le contenu retrouvé (connaissances, mémoire, banque de dialogue) est injecté dans le prompt |
| Poids | `seed.ts`, `public/models/` | export binaire Float32 + méta JSON, chargés au démarrage |

**Modèle livré** : 178 496 paramètres — dim 64, 3 couches, 4 têtes, contexte 352, vocabulaire
caractère 104. Corpus d'entraînement : 398 exemples / 84 112 caractères, au format `chat-v1` :

```
H: <dernier échange, 34 car. max>      ← facultatif
Q: <message de l'utilisateur, 60>
C: <contenu retrouvé, 90 car. max>     ← ce dont la réponse doit parler
R: <réponse, 130>
```

Le contenu retrouvé est placé **juste avant** la réponse : la tâche du modèle est
une copie à courte portée. Avec `C:` en tête de bloc (~100 caractères plus loin),
il fallait une tête d'induction que 178 k paramètres n'ont pas acquise en 400 pas
— mesuré : NLL forcée figée à 2,6 nats/caractère, 52-59 % des caractères dans le
top-3, décodage glouton « de de le e de » (le rythme du français, pas son contenu),
alors que le même modèle sur-apprend une fenêtre figée à 0,578 en 80 pas.

Le modèle apprend donc une tâche précise : **lire le contenu retrouvé et rédiger la réponse**, pas
inventer des faits. C'est ce qui rend un modèle de cette taille honnête et utile.

À l'entraînement, les exemples sont emballés dans des blocs de longueur exactement `ctx` sans jamais
en couper un (`packChatBlocks`) : une fenêtre tirée au hasard dans le flux concaténé amputerait la
ligne `C:` ou la fin de `R:`. Le bourrage restant est du saut de ligne, trivial à prédire, donc la
perte affichée est **dilutionnée** (un bloc rempli à 76 % affiche ~0,35 nat de moins que la réalité) :
le chiffre honnête est la NLL de validation mesurée sur des exemples complets, que
`scripts/train-chat.ts` journalise à chaque point de contrôle.

**Mesures** (2 CPU, `scripts/` reproductibles) : cache KV identique au forward naïf à 2,4×10⁻⁷ près
et 38× plus rapide (40 tokens en 21 ms contre 800 ms) ; échantillonnage 2,5 ms/token ; une réponse
de chat arrive en ~400 ms, tokens diffusés en SSE.

**Garde-fous** (`verdictOn` dans `dialogue.ts`) : une génération n'est servie que si elle passe des
seuils **mesurés** sur le savoir local (≥ 3 mots de contenu, couverture lexicale ≥ 0,55, ancrage
≥ 0,42, ≥ 16 caractères et 4 mots, NLL ≤ 3,5 nats/caractère, unicité ≥ 0,5). Sinon NEXUS répond avec
le contenu retrouvé et **le dit** dans le fil de pensée — jamais de charabia présenté comme une
réponse, jamais de silence trompeur. Sans contenu retrouvé, le modèle ne génère pas du tout.

**Reproduire l'entraînement** :

```bash
node --import tsx scripts/train-chat.ts --steps 680 --batch 6   # entraîne + exporte les poids
node --import tsx scripts/check-chat-model.ts                    # ce que le modèle a vraiment appris
node --import tsx scripts/calibrate-chat.ts                      # mesure des garde-fous
node --import tsx scripts/check-kv.ts && node --import tsx scripts/check-bpe.ts   # non-régression
node scripts/check-chat-e2e.mjs                                  # latence réelle du chat (serveur lancé)
```

**Deux façons d'entraîner**, selon qui s'en occupe :

| | Où | Impact sur le chat |
|---|---|---|
| **Hors ligne** (recommandé) | `scripts/train-chat.ts`, process dédié | aucun : pleine vitesse, le serveur n'est pas concerné |
| **En arrière-plan** (agent Dev) | espace Dev → Entraîneur → « Modèle de langue », ou `NEXUS_AUTO_TRAIN=1` | atténué : le pas d'entraînement partage la boucle d'événements (rapport cyclique 1), une réponse passe de ~0,4 s à quelques secondes pendant le run |

Désactivé par défaut, parce que la fonction première du site est de parler avec
l'IA : un pas d'entraînement coûte plusieurs secondes de calcul synchrone. Le
rapport cyclique (`dutyCycle` dans `trainSteps`) borne la dégradation au lieu de
la supprimer — mesuré sans lui : 71 s pour diffuser 20 morceaux d'une réponse.

> Lecture honnête : un modèle de 178 k paramètres entraîné quelques heures sur 2 CPU n'est pas un
> concurrent de ChatGPT — `llm/RESULTS.md` documente les mêmes limites pour le prototype NumPy à
> 5,3 M de paramètres. L'intérêt ici est ailleurs : **tout est lisible, local et mesurable**, et
> l'architecture retrieval + garde-fous fait que la réponse servie est toujours du vrai français
> utile, générée par le modèle quand il est assez confiant, reprise du savoir local sinon.

## Corrections de bugs (v2.1)

- **Polices Google bloquantes** : `next/font/google` empêchait tout build ou démarrage hors ligne
  (« Failed to fetch Geist from Google Fonts »). Remplacé par une pile de polices système locales —
  NEXUS se compile et tourne désormais **sans Internet**, cohérent avec son fonctionnement 100 % local.
- **Moteur mathématique muet** : la moindre ponctuation (« Combien font 12 + 45 **?** ») était un
  « caractère illégal » qui faisait échouer tout le calcul, et la question partait en réponse générique
  au lieu de répondre 57. Le normaliseur neutralise désormais la ponctuation, les espaces et les
  symboles × ÷.
- **Fuite de données entre comptes** : sans session, les routes renvoyaient les données de *tous* les
  utilisateurs (filtre vide). Un garde-fou (`ownerGuard`) refuse désormais toute requête non
  authentifiée dès qu'un compte existe, et chaque route filtre par propriétaire.
- **Prompt système polluant les réponses** : les consignes d'un chatbot étaient concaténées au message
  du visiteur, et remontaient dans la réponse (« Analyse & Synthèse : contexte chatbot consignes
  propriétaire… »). Elles voyagent maintenant par un canal `systemPrompt` dédié.
- **Prénom du compte ignoré** : NEXUS n'utilisait que sa mémoire pour connaître votre prénom ; il
  utilise désormais aussi le prénom du compte, ainsi que son message d'accueil personnalisé.

## Sécurité

- Mots de passe : **scrypt** + sel aléatoire, comparaison à temps constant.
- Sessions : jeton aléatoire 32 octets, cookie `httpOnly` + `SameSite=Lax`, purge des sessions expirées.
- Clés API : secret affiché une seule fois, stocké **hashé** (SHA-256), révocable, avec limite de débit.
- Secrets de connexions (Gmail, GitHub…) : chiffrés en AES-256-GCM, jamais renvoyés en clair au client.
- Cloisonnement : chaque requête est filtrée par `userId` ; toute tentative d'accès à une ressource
  d'un autre compte renvoie `404`/`403`.
