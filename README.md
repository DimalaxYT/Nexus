# NEXUS — Système d'agents IA 100% local

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
