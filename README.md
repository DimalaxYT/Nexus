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
| `TURSO_DATABASE_URL` | `libsql://nexus-<organisation>.turso.io` | **Recommandé** : base Turso qui garde les données (voir ci-dessous) |
| `TURSO_AUTH_TOKEN` | le jeton de la base | Jeton d'accès Turso (`turso db tokens create …`) — jamais dans le dépôt |
| `DATABASE_URL` | `file:/var/data/custom.db` | Fichier SQLite local (sans Turso). Sur un plan payant, à placer sur un **Disk Render** monté sur `/var/data` ; avec Turso, il ne sert qu'à l'import initial |
| `NEXUS_SECRET_KEY` | une longue phrase secrète | **Obligatoire en production** : clé maîtresse du chiffrement AES-256-GCM des secrets (connexions, webhooks). À fixer une fois pour toutes — la changer rend illisibles les secrets enregistrés ; sans elle, la clé est générée dans un fichier que Render efface au redémarrage |
| `NEXUS_DEV_PASSWORD` | votre mot de passe | **Fortement recommandé** : mot de passe du compte Dev. Remplace aussi le mot de passe public `dev2026` du compte livré avec la base (import Turso compris) ; un mot de passe changé depuis « Mon compte » n'est jamais écrasé |
| `SMTP_HOST` | `smtp-relay.brevo.com` | Serveur SMTP pour les codes de réinitialisation de mot de passe et les notifications. **Plan gratuit Render : les ports 25, 465 et 587 sont bloqués** — prenez un fournisseur qui accepte le port 2525 (Brevo, SendGrid, Mailgun…) ; Gmail ne fonctionne que sur un plan payant |
| `SMTP_PORT` | `2525` | `2525` sur le plan gratuit ; `465` (TLS) ou `587` (STARTTLS) sur un plan payant |
| `SMTP_USER` | votre adresse d'envoi | Compte d'envoi (utilisez un **mot de passe d'application** Gmail) |
| `SMTP_PASS` | le mot de passe d'application | Mot de passe du compte d'envoi |
| `MAIL_FROM` | `NEXUS <vous@domaine.fr>` | Expéditeur affiché |

### 🗄️ Base de données Turso (recommandée sur Render)

Sur le plan gratuit, Render **efface le système de fichiers** à chaque redéploiement, redémarrage ou mise
en veille, et n'accepte pas de disque persistant : une base SQLite locale y perd comptes, conversations et
savoir. [Turso](https://turso.tech) (offre gratuite : 5 Go, 500 millions de lignes lues par mois) garde les
données hors du serveur.

1. **Créez une base libSQL** — sur le tableau de bord Turso (moteur *libSQL*, région européenne
   comme *AWS EU West (Ireland)*, proche de Render Frankfurt) ou avec la CLI :

   ```bash
   turso db create nexus            # base libSQL (ne pas ajouter --tursodb)
   turso db show nexus --url        # → TURSO_DATABASE_URL
   turso db tokens create nexus     # → TURSO_AUTH_TOKEN
   ```

2. **Render → votre service → Environment** : ajoutez `TURSO_DATABASE_URL` et `TURSO_AUTH_TOKEN`, puis
   enregistrez (Render redéploie).
3. **Premier démarrage** : si la base Turso est vide, NEXUS y recopie automatiquement la base locale
   (le fichier de `DATABASE_URL` s'il existe, sinon `db/custom.db` livré avec le dépôt) — compte Dev,
   agents, savoir, entraînement. Une base qui contient déjà des données n'est jamais touchée
   (`TURSO_AUTO_IMPORT=0` désactive l'import). Pour garder plutôt les données **actuellement en ligne**,
   faites d'abord *Dev → Réglages → Migrer les données vers Turso*, puis ajoutez les deux variables.
4. **Vérifiez** dans *Dev → Réglages* : « Base active : Turso — réplique locale ». `/api/health` répond
   aussi `"db": "turso (réplique locale)"`.

**Pourquoi c'est aussi rapide qu'en local** : NEXUS garde une **réplique locale** de la base (un fichier
dans le dossier temporaire, resynchronisé au démarrage). Les lectures — l'essentiel du trafic — se font
sur place, sans aller-retour réseau ; les écritures partent directement à Turso, puis la réplique est
resynchronisée avant de répondre, si bien qu'on relit toujours ce qu'on vient d'écrire. Si la réplique ne
peut pas s'ouvrir, tout passe par Turso en direct (`TURSO_REPLICA=0` force ce mode). Mesures sur le build
de production avec 25 ms de latence réseau simulée vers un serveur libSQL :

| Mesure | Base locale | Turso direct | Turso + réplique |
|---|---|---|---|
| Panneaux et API (conversations, savoir, mémoire, agents, entraînement) | 2,7–5,4 ms | 32–105 ms | 2,4–5,9 ms |
| Chat : premier mot / réponse complète (conversation en cours) | 10–18 / 40–64 ms | 127–134 / 160–181 ms | 12–15 / 45–61 ms |
| Sauvegarde d'une conversation | 4 ms | 62 ms | 62 ms |
| Démarrage → serveur prêt | 0,6 s | 2,3 s au premier démarrage (import compris) | 1,1 s (2,7 s au premier, import compris) |

La configuration faite dans *Dev → Réglages* est enregistrée dans un fichier `nexus-db.json` à côté de la
base locale : sur le plan gratuit de Render, il disparaît au redémarrage — préférez les variables
d'environnement (le panneau le rappelle).

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
10 minutes) puis permet de choisir un nouveau mot de passe. Sans SMTP configuré,
le code n'est affiché à l'écran qu'en développement ; en production, il est
seulement écrit dans les journaux du serveur (Render → Logs) — sinon n'importe
qui pourrait réinitialiser n'importe quel compte. Configurez SMTP pour l'envoi réel.

> **Important** : sans Turso, NEXUS utilise **une base SQLite locale** (le fichier de `DATABASE_URL`, ou
> `db/custom.db`). Avec `TURSO_DATABASE_URL` + `TURSO_AUTH_TOKEN` (ou un réglage fait dans *Dev → Réglages*),
> les données vivent sur Turso, lues depuis une réplique locale. Et le cerveau IA étant 100 % local,
> **aucune clé d'API IA** n'est nécessaire.

## ⚡ Performances

Sur le plan gratuit de Render, l'instance dispose d'environ **0,1 CPU** : tout calcul y est ~10 fois plus
lent que sur un poste de développement, et pendant un calcul synchrone le serveur ne répond à **personne**
(chargement de la page, chat, panneaux). Les principales sources de lenteur ont été supprimées :

- **Démarrage** — le classifieur d'intentions n'est plus réentraîné à chaque démarrage (le serveur restait
  sourd ~22 s après chaque lancement, soit plusieurs minutes sur Render). Ses poids sont livrés dans `public/models/nexus-intent-v1.bin`
  (+ `.json` : empreinte du corpus, intentions, précision) et chargés en ~0,3 s. Si le corpus, le
  vectoriseur ou les hyperparamètres changent, l'empreinte ne correspond plus : le serveur réentraîne
  alors **en arrière-plan, par tranches** (il continue de répondre) et garde le résultat en cache dans le
  dossier temporaire. L'entraînement lui-même est 4× plus rapide, à poids identiques au bit près.
- **Chat** — quand les rédactions du modèle de langue échouent 4 fois de suite aux garde-fous de qualité,
  NEXUS répond directement avec le savoir local retrouvé, sans payer une génération qui serait jetée ; le
  modèle est retenté tous les 12 messages et dès qu'il est réentraîné (le fil de pensée l'indique).
- **Interface** — panneaux et vues chargés à la demande puis préchargés quand le navigateur est au repos
  (sans le palier de 300 ms de `Suspense`), coloration syntaxique allégée chargée au premier bloc de
  code, messages mémoïsés, sauvegarde locale regroupée (au plus une fois par seconde), historique
  rapatrié par lots de 25 conversations (au lieu d'une requête par conversation), aucun
  rafraîchissement automatique des panneaux Dev quand l'onglet est caché.
- **Serveur et base** — sessions et nombre de comptes en cache (invalidés à chaque écriture), colonnes
  ciblées, `RETURNING` (écriture + relecture en une requête), schéma vérifié en lot, listes allégées
  (`/api/dev/browser` sans le texte des pages, `/api/knowledge?count=1`), et les cycles d'entraînement
  Dev cèdent la main entre deux étapes.

Mesures sur le build de production (machine de test à 2 vCPU — sur Render, compter ~10× pour le calcul) :

| Mesure | Avant | Après |
|---|---|---|
| Démarrage → premier `/api/health` | 22 s | 0,7–0,9 s |
| Réentraînement du classifieur (corpus modifié) | 28,5 s, serveur bloqué | 6,5 s en arrière-plan (tranches de 20–30 ms) |
| JavaScript initial du chat (`/app`) | 3,29 Mo (943 Ko gzip) | 1,14 Mo (325 Ko gzip), −66 % |
| Chat : premier mot / réponse complète | 142–255 ms / 357–442 ms | 8–21 ms / 37–67 ms |
| Pire attente d'une requête pendant un cycle d'entraînement Dev | 858–980 ms | 139–160 ms |
| `/api/dev/browser` (liste des pages) | 1,24 Mo | 6–10 Ko |

Les 4 premiers messages après un démarrage passent encore par le modèle (premier mot en 130–310 ms), le
temps que le garde-fou constate ses refus.

Après une modification de `src/lib/brain/dataset.ts`, du vectoriseur ou des hyperparamètres du
classifieur, régénérez les poids livrés (sinon le serveur réentraîne lui-même au démarrage, en arrière-plan) :

```bash
npx tsx scripts/export-intent-net.ts
```

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
- **Apparence** (*Mon compte → Apparence*, ou bouton de la barre latérale) : **trois modes** (clair,
  sombre, **système**), **trois palettes** neutres (Neutre, Chaud, Froid) et **huit couleurs
  d'accent** (Ardoise, Indigo, Émeraude, Ambre, Terracotta, Rose, Cyan, Violet). Tout s'applique
  instantanément, sans rechargement, et est enregistré **sur le compte** (le choix suit l'utilisateur
  d'un appareil à l'autre) puis mémorisé sur l'appareil (`localStorage` : `theme`, `nexus-palette`,
  `nexus-accent`). En mode système, `prefers-color-scheme` est respecté en direct.

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

L'espace développeur (**Espace Dev**, dans la barre latérale) réunit onze onglets :

| Onglet | Ce qu'il fait |
|---|---|
| **Vue d'ensemble** | Compteurs de la base, poids du code par dossier, fichiers les plus lourds, charge système, et les **sujets mal couverts** détectés dans le journal d'appels |
| **Site** | Personnalisation du site depuis le web : nom, slogan, emoji du logo, deux couleurs d'accent, textes de connexion et d'accueil, pied de page, visibilité des tuiles de l'accueil, **CSS libre** — avec aperçu en direct |
| **Agent Dev** | Discuter avec l'agent qui lit le code |
| **Entraînement** | État du daemon, cycles, couverture de NEXUS, savoirs appris, réglages du modèle |
| **Filtres** | Exclure ou masquer des conversations de l'entraînement |
| **Réglages** | Base libSQL (locale/Turso) et Gardien anti-veille |
| **Webhooks** | Brancher Discord, Slack ou une URL libre et retrouver les **confirmations en attente** |
| **Code** | Explorateur de fichiers + recherche dans tout le projet (avec numéros de ligne) |
| **Correctifs** | Les propositions de l'agent Dev, à relire et à appliquer une par une **ou toutes d'un coup** (sauvegarde automatique) |
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
- **Modifier le code** — il fabrique de vrais correctifs ancrés sur le contenu du disque :
  - « remplace `"ancien"` par `"nouveau"` dans src/lib/fichier.ts » ;
  - « remplace la ligne contenant `"…"` par `"…"` » ;
  - « renomme `oldName` en `newName` » → **un correctif par fichier concerné** ;
  - « supprime la ligne contenant `"…"` », « supprime la fonction `nom` » ;
  - « ajoute `"…"` après `"…"` », « ajoute `"…"` à la fin de src/lib/fichier.ts » ;
  - « crée src/lib/ma-feature.ts » suivi d'un bloc de code ;
  - « mets à jour src/lib/ma-feature.ts avec : ```…``` » (réécriture complète à partir d'un bloc fourni) ;
  - « nettoie les console.log dans tout le projet ».
- **Réparer sans connaître l'ancre** — « corrige les imports inutilisés dans src/lib/devfs.ts »,
  « améliore `safePath` », « sécurise les liens target=\"_blank\" », « corrige
  l'accessibilité des images dans AppShell.tsx ». Il résout le fichier (chemin, symbole ou module),
  puis corrige les défauts **réels et vérifiables** qu'il y trouve : `console.log`/`debugger`
  résiduels, imports nommés jamais utilisés, `parseInt` sans base, `target="_blank"` sans
  `rel="noopener noreferrer"`, `<img>` sans `alt`. S'il ne trouve rien de sûr à corriger, il ne
  fabrique pas de faux correctif : il explique ce qu'il a contrôlé et demande l'ancre exacte.
- **Réparer le thème** — « corrige le thème, il est bloqué en clair » : diagnostic dédié qui lit
  réellement `src/app/globals.css`, `src/app/layout.tsx` et la bascule. Il remet la palette sombre
  après `:root` (sinon le clair l'écrase), élargit la variante Tailwind `dark:` à la racine, retire
  une classe `dark` figée, active le mode « système » (`enableSystem`) et vérifie que les sélecteurs
  `data-accent` existent. Si tout est correct, il le dit et indique où changer d'apparence — il
  n'invente pas de correctif.

Une même demande peut donc produire **plusieurs correctifs** : plusieurs instructions
(« remplace … dans a.ts **puis** supprime … dans a.ts **et** crée b.md ») sont découpées et
planifiées séparément. Les modifications d'un même fichier sont **fusionnées en une écriture
atomique** ; les autres fichiers donnent un correctif chacun. Ajoutez « **et applique** » pour qu'il
écrive lui-même les fichiers (sauvegarde horodatée avant chaque écriture). Sans cette mention, rien
n'est écrit : les correctifs attendent votre validation.

Il fonctionne aussi bien dans l'onglet **Agent Dev** que dans le chat normal (sélectionnez l'agent
**🛠️ Dev**), et en passant par `POST /api/dev/agent`.

### Correctifs : rien n'est écrit sans validation

L'agent ne modifie jamais un fichier sans votre accord explicite (« Appliquer », « Tout appliquer »
ou « et applique » dans la demande). Chaque proposition :

1. est enregistrée avec son **ancre exacte** (un extrait réel du fichier, assez long pour être unique),
2. s'affiche en **diff avant/après** dans l'onglet Correctifs,
3. ne s'écrit qu'après votre clic sur **Appliquer** — ou sur **Tout appliquer** pour une sélection
   entière — avec une **sauvegarde horodatée** du fichier dans `.arena/dev-backups/` avant chaque
   écriture.

Depuis le chat, « **applique** » applique le correctif le plus récent, « **applique le 2e** » un
correctif précis, et « **applique tout** » toute la file. Le résultat de chaque application (succès,
échec, sauvegarde) est renvoyé dans la conversation.

Si le code a changé entre la proposition et l'application, l'ancre n'est plus trouvée et
l'application est **refusée** plutôt que d'écrire au mauvais endroit. Les autres correctifs en
attente sur le même fichier dont l'ancre a disparu passent automatiquement en **« périmé »** : ils
ne bloquent plus « Tout appliquer ».

### 🔔 Webhooks : NEXUS vous tient au courant

L'onglet **Webhooks** de l'espace Dev branche NEXUS sur **Discord**, **Slack** ou n'importe quelle URL
qui accepte un `POST` JSON (n8n, Make, Zapier, script maison…). Les messages sont formatés
automatiquement ; un **secret HMAC** optionnel signe chaque requête (`X-Nexus-Signature`).

Événements disponibles, sélectionnables un par un ou tous :

| Événement | Contenu envoyé |
|---|---|
| `training.started` | Objectif choisi, déclencheur (daemon ou manuel), couverture avant le cycle |
| `training.learned` | **Ce que l'IA a compris** : question, réponse retenue, score, sources, catégorie |
| `training.completed` | Bilan du cycle : pages lues, savoirs produits, couverture avant → après, erreur éventuelle |
| `approval.requested` | **Attente de confirmation** avec deux boutons **✅ Accepter** / **❌ Refuser** |
| `approval.decided` | Qui a tranché (webhook ou dashboard) et dans quel sens |
| `patch.applied` | Fichier modifié et sauvegarde associée |
| `daemon.error` | Incident d'un cycle, nombre d'erreurs consécutives et prochaine tentative |
| `test` | Message de vérification envoyé par le bouton « Envoyer un test » |

Les boutons d'une confirmation sont de **vrais liens signés** (jeton aléatoire de 24 octets, à usage
unique) : un clic applique ou écarte l'action immédiatement, sans ouvrir l'application, et affiche une
petite page de confirmation. L'onglet Webhooks montre les confirmations en attente, le journal des
livraisons (statut HTTP, latence, erreur) et permet de tester ou désactiver chaque webhook.

Le champ **URL publique de NEXUS** (ou les variables `NEXUS_PUBLIC_URL` / `RENDER_EXTERNAL_URL`) sert
à construire ces liens. En développement, une URL locale (`http://localhost:…`) est acceptée ; en
production la protection anti-SSRF refuse les adresses internes, sauf `NEXUS_WEBHOOK_ALLOW_PRIVATE=1`.

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
`DevTask` (file d'améliorations), `DevWebhook` (destinations d'alertes), `DevWebhookLog` (journal des
livraisons), `DevApproval` (confirmations Accepter / Refuser avec jeton), plus les colonnes `role`
sur `User` (`owner` / `dev` / `client`) et `systemKey` sur `AgentProfile` (`'dev'` pour l'agent
système).

## Structure

```
src/
  app/api/         → Routes API (auth, blueprints, clés, v1 publique, outils…)
  components/      → Composants UI (Bureau, Jarvis Brain, IDE, Hub, Blueprints, Clés API…)
  lib/             → Cerveau IA local, orchestrateur multi-agents, auth, blueprints, connecteurs
                     + espace Dev : devbrain.ts (agent), devcode.ts (édition), devpatch.ts (application),
                       devfs.ts (accès code), site-settings.ts
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
  le code (`src/lib/devbrain.ts`, `src/lib/devcode.ts`, `src/lib/devpatch.ts`, `src/lib/devfs.ts`, `src/lib/dev-seed.ts`)
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

**Modèle livré (v2)** : **899 968 paramètres** — dim 128, 4 couches, 8 têtes, contexte 704,
vocabulaire caractère 145 (lexique de 2 345 mots). Corpus d'entraînement : **854 exemples /
241 641 caractères**, au format `chat-v1` :

```
H: <dernier échange, 90 car. max>      ← facultatif
Q: <message de l'utilisateur, 110>
C: <contenu retrouvé, 260 car. max>    ← ce dont la réponse doit parler
R: <réponse, 220>
```

Le contenu retrouvé est placé **juste avant** la réponse : la tâche du modèle est
une copie à courte portée. Le contexte a doublé (352 → 704) et les budgets avec
lui : à 352, une vraie question était coupée à 60 caractères et un passage à 90.

**Entraînement v2** (Python/NumPy, `llm/train_nexus_chat.py`, 2 CPU) : 600 pas de
pré-entraînement sur 364 473 caractères de prose française, puis 2 400 pas de
conversation (lot 2, AdamW, warmup + cosinus, dropout 0,05) — **3 000 pas,
4,2 M de caractères vus, 55 minutes**. La validation (69 exemples tenus à
l'écart, NLL forcée sur les caractères de la réponse) descend de 4,29 à
**2,51** puis remonte (2,61 à la fin) : le modèle surapprend après ~600 pas,
et le meilleur point de contrôle est restauré avant l'export.

**Évaluation honnête** (`scripts/eval-chat.ts`, mêmes 12 exemples de validation
pour les deux modèles) :

| | v1 (178 k, ctx 352) | v2 (900 k, ctx 704) |
|---|---|---|
| NLL forcée de la réponse | 2,426 | **2,407** |
| caractères dans le top-3 | 53 % | **54 %** |
| réponses acceptées par les garde-fous | 0/12 | 0/12 |
| F1 de mots avec l'attendu | 0,08 | 0,06 |
| latence par réponse (2 CPU) | 144 ms | 463 ms |

Autrement dit : **v2 modélise mieux le français (+4 % de top-3, NLL plus basse)
mais n'apprend toujours pas à recopier le contexte** — 900 k paramètres et
3 000 pas restent très loin de ce qu'exige une tête d'induction sur des
séquences de 700 caractères. Un essai contrôlé de tâche de copie pure (230
passages, 1 500 pas) plafonne à 47 % de top-3 : ce n'est pas un réglage, c'est
un budget de calcul. Les garde-fous refusent donc les générations et servent le
contenu retrouvé, exactement comme avant — mais le contenu retrouvé est
désormais **beaucoup mieux choisi** (voir ci-dessous).

**Le retrieval, lui, a réellement progressé** (`scripts/check-dialogue.ts`,
`scripts/check-retrieval.ts`) :

| Mesure | Avant | Après |
|---|---|---|
| Banque de dialogue — question canonique → bonne réponse (top-1) | 63 % (117/186) | **99 % (185/186)** |
| Banque de dialogue — mots-clés seuls (top-1) | — | **100 % (186/186)** |
| Banque de connaissances — question → bonne entrée (top-1) | 91 % (31/34) | **97 % (33/34)** |
| Banque de connaissances — mots-clés seuls (top-1) | — | **100 % (34/34)** |

Cinq causes corrigées, toutes mesurées : les mots-outils comptaient autant que
les mots rares (pondération IDF, puis poids 0,2 pour les mots vides), une entrée
de relance (« Pourquoi ? ») pouvait gagner sans historique, le filtre de bruit
comparait des mots bruts à des radicaux (« fonctionne » vs « fonctionn »),
les traits d'union créaient des pseudo-mots (« sais-tu » ≠ « sais faire »), et
un mot ajouté cassait la question canonique (« Qui es-tu exactement ? » tombait
sur une note interne) — d'où un bonus quand la question de l'entrée est
contenue telle quelle dans le message. Une relance retrouvée passe en plus
avant un passage isolé : « et pourquoi tu dis ça ? » ne répond plus
« Pourquoi TypeScript ? ».

Vérifié de bout en bout sur le serveur de développement (`check-chat-e2e.mjs`) :
les six tours types — salutation, identité, capacités, humeur, relance,
remerciement — donnent la bonne réponse ; 1,85 s au pire pour le premier tour,
puis 29–76 ms une fois le disjoncteur de génération ouvert.

**Garde-fous** (`verdictOn` dans `dialogue.ts`) : une génération n'est servie que si elle passe des
seuils **mesurés** sur le savoir local (≥ 3 mots de contenu, couverture lexicale ≥ 0,55, ancrage
≥ 0,42, ≥ 16 caractères et 4 mots, NLL ≤ 3,5 nats/caractère, unicité ≥ 0,5). Sinon NEXUS répond avec
le contenu retrouvé et **le dit** dans le fil de pensée — jamais de charabia présenté comme une
réponse, jamais de silence trompeur. Sans contenu retrouvé, le modèle ne génère pas du tout. Après
quatre refus d'affilée, un disjoncteur sert directement le texte retrouvé et ne retente le modèle
qu'un message sur douze : la latence reste celle du retrieval.

**Reproduire l'entraînement v2** :

```bash
node --import tsx scripts/export-chat-corpus.ts          # 854 exemples / 241 641 caractères
llm/.venv/bin/python llm/train_nexus_chat.py \
  --pretrain-steps 600 --steps 2400 --batch 2 --eval-every 300 \
  --out public/models/nexus-chat-v2                       # ~55 min sur 2 CPU
node --import tsx scripts/eval-chat.ts --models nexus-chat-v1,nexus-chat-v2
node --import tsx scripts/check-chat-model.ts --seed --model nexus-chat-v2
node --import tsx scripts/calibrate-chat.ts --seed --model nexus-chat-v2
node --import tsx scripts/check-dialogue.ts && node --import tsx scripts/check-retrieval.ts
node scripts/check-chat-e2e.mjs                            # latence réelle du chat (serveur lancé)
```

> Lecture honnête : un modèle de 900 k paramètres entraîné une heure sur 2 CPU n'est pas un
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
