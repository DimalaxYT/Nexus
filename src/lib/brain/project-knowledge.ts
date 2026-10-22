// ─── NEXUS — Documentation du projet, interrogeable par le chat ──────────────
// Ces entrées ne servent PAS à entraîner le modèle (le corpus d'entraînement
// reste celui de `knowledge-bank.ts`, gelé pour que les mesures v1/v2 restent
// comparables) : elles alimentent le RETRIEVAL, c'est-à-dire les réponses
// servies quand le modèle n'est pas assez sûr.
//
// Pourquoi les séparer : les questions sur NEXUS lui-même (« c'est quoi Turso »,
// « comment fonctionne le cache ») tombaient sur des passages hors sujet —
// mesuré : Turso 0,01, cache clé-valeur 0,27. Un assistant doit savoir décrire
// son propre fonctionnement.

export interface ProjectEntry {
  keywords: string[]
  question: string
  answer: string
}

export const PROJECT_KNOWLEDGE: ProjectEntry[] = [
  {
    keywords: ['qui a cree', 'createur', 'auteur', 'origine', 'pourquoi nexus', 'histoire du projet'],
    question: 'Qui a créé NEXUS et pourquoi ?',
    answer: `NEXUS a été écrit **dans ce dépôt**, ligne par ligne : le transformeur, le tokenizer, l'autodifférentiation, l'optimiseur et la boucle d'entraînement viennent du code présent ici, sans bibliothèque d'IA ni poids téléchargés.
L'idée de départ est simple : montrer ce que peut faire une IA **lisible de bout en bout**. Chaque réponse peut être expliquée : quel passage a été retrouvé, avec quel score, pourquoi le modèle a rédigé ou non.
Le compte Dev permet de lire le code, de lancer l'entraînement et de vérifier les mesures dans l'espace Dev.`,
  },
  {
    keywords: ['injection', 'injections sql', 'xss', 'csrf', 'securite web', 'requetes preparees', 'echoppe'],
    question: 'Comment NEXUS évite-t-il les injections (SQL, XSS) ?',
    answer: `NEXUS utilise des **requêtes paramétrées** pour la base (jamais de concaténation de chaînes SQL) et échappe le contenu affiché : aucune page n'injecte de HTML brut non assaini, et aucune valeur utilisateur n'atteint une commande système.
Les secrets sont chiffrés ou hachés (scrypt pour les mots de passe, AES-256-GCM pour les jetons de connexion) et ne sont jamais renvoyés au navigateur.
Les appels sortants (lecture de page, webhooks) refusent par défaut les adresses privées, ce qui bloque les attaques SSRF.`,
  },
  {
    keywords: ['turso', 'base de donnees', 'database', 'libsql', 'sqlite', 'persistance'],
    question: 'Qu’est-ce que Turso et comment NEXUS l’utilise ?',
    answer: `**Turso** est une base de données **libSQL** (le moteur de SQLite) accessible par le réseau. NEXUS s'y connecte avec deux variables d'environnement : \`TURSO_DATABASE_URL\` et \`TURSO_AUTH_TOKEN\`.
NEXUS garde une **réplique locale** de cette base : les lectures se font sur place (≈ 0,05 ms) et les écritures partent vers Turso (≈ 60 ms), puis la réplique se resynchronise. Le chat reste donc rapide malgré le réseau.
Une base Turso vide reçoit automatiquement la base locale au premier démarrage — comptes, agents, savoir — sans jamais écraser une base déjà remplie.`,
  },
  {
    keywords: ['cache', 'cle-valeur', 'kv', 'cache kv', 'attention', 'inference'],
    question: 'Comment fonctionne le cache clé-valeur de NEXUS ?',
    answer: `Un **cache clé-valeur** garde les projections clé et valeur de chaque couche d'attention déjà calculées pour les tokens précédents.
Sans lui, générer 200 caractères coûterait 200 passages complets dans le transformeur. Avec lui, le prompt n'est calculé qu'une fois (le *prefill*), puis chaque nouveau caractère ne coûte qu'une passe sur un seul token.
Mesuré dans NEXUS : la génération est **38× plus rapide** et la sortie est identique au calcul naïf (écart 2,4×10⁻⁷).`,
  },
  {
    keywords: ['installer', 'installation', 'lancer nexus', 'demarrer', 'render', 'deploiement'],
    question: 'Comment installer et lancer NEXUS ?',
    answer: `NEXUS est une application **Next.js** : il faut Node 22, puis \`npm ci\` et \`npm run dev\` en développement, ou \`npm run build\` puis \`npm start\` en production.
Aucune clé d'API n'est nécessaire : le modèle de langue, le tokenizer et le retrieval sont écrits dans le dépôt et tournent en local.
Sur Render, les variables importantes sont \`NEXUS_SECRET_KEY\`, le compte Dev (\`NEXUS_DEV_PASSWORD\`) et, pour une base persistante, \`TURSO_DATABASE_URL\` + \`TURSO_AUTH_TOKEN\`.`,
  },
  {
    keywords: ['github', 'depot', 'repo', 'jeton github', 'versioning'],
    question: 'Comment NEXUS se connecte-t-il à GitHub ?',
    answer: `Dans le panneau **Connexions**, un jeton GitHub personnel permet à NEXUS de lire le profil, les dépôts récents et les notifications via l'API officielle.
Le jeton est chiffré en base (AES-256-GCM) et n'est jamais réaffiché après l'enregistrement ; il peut être révoqué à tout moment côté GitHub.
Sans jeton, NEXUS le dit franchement au lieu d'inventer une activité.`,
  },
  {
    keywords: ['memoire longue', 'memoire', 'souvenir', 'retiens', 'profil'],
    question: 'Qu’est-ce que la mémoire longue de NEXUS ?',
    answer: `La **mémoire longue** est une table de la base : quand tu dis « retiens que … », NEXUS y écrit le fait, avec sa date et son origine.
Ces souvenirs sont réinjectés dans le retrieval avant chaque réponse (source « ta mémoire ») et peuvent alimenter l'entraînement du modèle — c'est ce qui permet de te répondre « comme il te connaît » sans rien inventer.
Tu peux consulter et supprimer ces souvenirs depuis l'espace personnel ; ils restent dans ta base, sur ta machine.`,
  },
  {
    keywords: ['comment tu fonctionnes', 'comment ca marche', 'architecture', 'retrieval', 'garde-fous'],
    question: 'Comment NEXUS rédige-t-il une réponse ?',
    answer: `Trois étapes, toutes locales : le **retrieval** retrouve le passage le plus proche dans le savoir (banque de dialogue, connaissances, notes, mémoire), le **modèle** reçoit ce passage et le message puis tente de rédiger la réponse, les **garde-fous** vérifient la confiance, le vocabulaire et l'ancrage dans le passage.
Si la rédaction ne passe pas les seuils, NEXUS sert le texte retrouvé et l'annonce dans le fil de pensée — jamais de charabia présenté comme une réponse.
Après quatre refus d'affilée, un disjoncteur saute et le chat répond directement avec le savoir local, ce qui garde la latence basse.`,
  },
  {
    keywords: ['modele', 'llm', 'transformer', 'parametres', 'entrainement', 'intelligence'],
    question: 'Quel modèle de langue fait tourner NEXUS ?',
    answer: `NEXUS utilise un **transformeur écrit à la main** (NumPy pour l'entraînement, TypeScript pour l'inférence) : aucune bibliothèque d'IA, aucun poids téléchargé.
Le modèle de conversation livré fait **899 968 paramètres**, 4 couches, 8 têtes, un contexte de 704 caractères et un vocabulaire de 145 caractères.
Il est entraîné ici même : pré-entraînement sur de la prose française, puis affinage sur 854 exemples de conversation. À cette échelle il apprend la statistique du français mais reste trop petit pour recopier fidèlement un passage — les garde-fous servent alors le savoir retrouvé.`,
  },
  {
    keywords: ['agents', 'equipe', 'multi-agents', 'bureau', 'missions'],
    question: 'Qu’est-ce que les agents de NEXUS ?',
    answer: `NEXUS peut créer une **équipe d'agents** : chacun a un rôle, une couleur et un état (veille, réflexion, parole), visible dans le Cerveau Jarvis.
Le **Bureau** sert aux délibérations multi-agents : plusieurs agents proposent, comparent et retiennent la meilleure réponse.
Les **missions** tournent en arrière-plan avec un suivi d'étapes, et un rapport peut être synthétisé localement à la fin.`,
  },
  {
    keywords: ['connexions', 'gmail', 'mails', 'tiktok', 'comptes connectes'],
    question: 'À quels comptes NEXUS peut-il se connecter ?',
    answer: `Le panneau **Connexions** relie NEXUS à **Gmail** (lecture IMAP des derniers messages), **GitHub** (profil, dépôts, notifications) et **TikTok** (profil public, sans mot de passe).
Les secrets sont chiffrés en base (AES-256-GCM) et ne sortent jamais du serveur ; chaque utilisateur ne voit que ses propres comptes.
Si un compte n'est pas connecté — ou si le fournisseur refuse l'accès — NEXUS le dit clairement au lieu de simuler.`,
  },
  {
    keywords: ['securite', 'confidentialite', 'donnees', 'secret', 'chiffrement'],
    question: 'Où vont les données de NEXUS ?',
    answer: `Nulle part : NEXUS n'appelle **aucun service d'IA externe**. Le modèle, le tokenizer et le retrieval tournent sur ton serveur, et les conversations restent dans ta base SQLite ou Turso.
Les secrets (mots de passe, jetons de connexion) sont hachés ou chiffrés : mots de passe en scrypt, secrets de connexion en AES-256-GCM.
Chaque route vérifie le propriétaire des données ; sans session, elle ne renvoie rien.`,
  },
]
