# NEXUS — Système d'agents à cerveau local

Application web Next.js : agents IA autonomes, cerveau Jarvis 3D, Bureau multi-agents (délibérations), IDE, base de connaissances, génération d'images/vidéos, connexions comptes (Gmail, GitHub, TikTok, Discord) et plus.

## Installation

Prérequis : **Node.js 20+** (ou Bun) et **npm**.

```bash
# 1. Installer les dépendances
npm install        # ou: bun install

# 2. Configurer la base de données
npx prisma generate
npx prisma db push

# 3. Lancer en développement
npm run dev
# → http://localhost:3000

# Ou lancer en production
npm run build
npm start
```

## Cerveau neuronal local

NEXUS n'utilise aucun fournisseur de modèle externe. Son modèle déjà présent est un perceptron multicouche local qui classe les intentions; le moteur analytique, la recherche sémantique, la banque de connaissances et les compétences spécialisées produisent ensuite les réponses. Les conversations ne sont pas envoyées à un LLM distant. Les fonctions de recherche web et les connexions de comptes peuvent toutefois accéder à Internet lorsqu'elles sont utilisées.

Cette architecture reste légère et hors ligne pour le raisonnement de base, mais son classifieur n'est pas un grand modèle génératif : il ne peut pas, à lui seul, égaler les capacités générales de génération d'un LLM géant. Les connaissances locales peuvent être enrichies via les missions et la base intégrée.

L’onglet **Paramètres** permet d’ajuster le niveau de détail, la recherche Web (`auto`, `always`, `never`), le maximum de notes personnelles (1 à 5) et l’utilisation de la mémoire personnelle. Ces choix sont enregistrés dans le navigateur et modifient le raisonnement local; `never` désactive la recherche automatique sans bloquer une recherche explicitement demandée.

## Base de données

- Schéma : `prisma/schema.prisma`
- La base SQLite `db/custom.db` est incluse (données existantes : connaissances, agents, connexions…).
- Pour repartir de zéro : supprimez `db/custom.db` puis relancez `npx prisma db push`.

## Structure

```
src/
  app/          → Pages & API routes (Next.js App Router)
  components/   → Composants UI (Bureau, Jarvis Brain, IDE, Hub…)
  lib/          → Cerveau IA local, orchestrateur multi-agents, connecteurs
  hooks/        → Hooks React
prisma/         → Schéma de base de données
db/             → Base SQLite
public/         → Assets statiques
scripts/        → Scripts utilitaires
```

## Modules principaux

- **Cerveau IA local** — raisonnement, mémoire, base de connaissances
- **Bureau** — délibérations multi-agents (Lou, Patrice, Lucas, Thomas, Fabien)
- **Cerveau Jarvis 3D** — visualisation animée connectant les agents
- **IDE** — éditeur de code intégré
- **Génération média** — images & vidéos locales
- **Connexions** — Gmail, GitHub, TikTok, Discord
