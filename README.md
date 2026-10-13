# NEXUS — Système d'agents IA 100 % local

Application web Next.js : agents IA autonomes, **comptes utilisateurs**, **blueprints** (schémas d'agents
dessinés à la main), **clés API pour vendre des chatbots**, cerveau Jarvis 3D, Bureau multi-agents,
base de connaissances, génération d'images/vidéos, connexions de comptes (Gmail, GitHub, Discord) et plus.

> **Aucune dépendance à un service d'IA externe.** NEXUS n'appelle ni OpenAI, ni Ollama, ni aucun
> « géant » : le cerveau (`src/lib/brain`) est entièrement codé à la main (réseau de neurones embarqué,
> moteur mathématique, moteurs de recherche, générateurs d'images/3D/vidéos, synthèse locale).
> Le build et l'exécution fonctionnent **hors ligne**.

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

## Base de données

- Schéma : `prisma/schema.prisma` (référence) — l'accès se fait via la couche légère `src/lib/db.ts`
  (SQLite, migrations automatiques : les colonnes `userId` sont ajoutées sans casse).
- La base SQLite `db/custom.db` est incluse (données existantes : connaissances, agents, connexions…).
- Pour repartir de zéro : supprimez `db/custom.db` puis relancez l'application.

Modèles ajoutés en v2.1 : `User`, `Session`, `Blueprint`, `ApiKey`, `ApiKeyLog`, plus une colonne
`userId` sur `Conversation`, `Knowledge`, `Memory`, `Task`, `AgentProfile`, `AgentGroup`,
`AccountConnection` et un champ `blueprintId` sur `AgentProfile`.

## Structure

```
src/
  app/api/         → Routes API (auth, blueprints, clés, v1 publique, outils…)
  components/      → Composants UI (Bureau, Jarvis Brain, IDE, Hub, Blueprints, Clés API…)
  lib/             → Cerveau IA local, orchestrateur multi-agents, auth, blueprints, connecteurs
  lib/brain/       → Le cerveau : classifieur, neurones, moteurs (maths, code, image, 3D, vidéo…)
  hooks/           → Hooks React
prisma/            → Schéma de base de données
db/                → Base SQLite
public/            → Assets statiques
scripts/           → Scripts utilitaires
```

## Modules principaux

- **Cerveau IA local** — raisonnement, mémoire, base de connaissances (aucun appel externe)
- **Comptes** — connexion, historique et personnalisation par utilisateur
- **Blueprints** — schémas d'agents construits visuellement
- **Clés API** — chatbots configurables et revendables (API publique v1)
- **Bureau** — délibérations multi-agents
- **Cerveau Jarvis 3D** — visualisation animée connectant les agents
- **Studios** — 3D, images, vidéo, code (20 langages)

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
